/*
 * The tick step of the outbox (Design 8.2 to 8.7). It turns stuck entries `uncertain`, then sends
 * the due entries of every sender in turns, one entry per turn: personal mail first, within the
 * daily limit and its reserve, at most `perMinute` mails per quota scope and minute, and on
 * Cloudflare within the subrequests the invocation has left (`ctx.subrequests`, shared by all
 * senders and all ticks of the invocation). A disturbed connection waits: a Graph connection is
 * checked once per run by fetching a token, a Resend connection (or a refused mailbox or domain)
 * by sending one entry. A scope the provider stopped waits until its pause ends, then one entry
 * tests it (ruling R5).
 *
 * It backs off when the provider is in trouble: after an unclear send the connection stops for the
 * run and the scope pauses for a while, after a transient refusal the scope stops for the run (and
 * pauses for the provider's `Retry-After`), after a preparer that throws the sender stops for the
 * run. So an incident costs one unclear entry per scope and pause, not one per mail.
 *
 * The step stops starting sends shortly before its deadline, so that the later steps of the tick
 * still run, and reports `moreWork` while due entries are left that hang neither on a limit, a
 * pause, a disturbance nor a spent subrequest budget.
 *
 * Each run starts the run of every preparer it uses (`EntryPreparer.startRun`), so what the
 * entries of a run share (a wave's files) is read once per run. A Resend entry whose first attempt
 * is older than its idempotency key is trusted is not retried after an answer that may have sent
 * it: it becomes `uncertain` (ruling R7).
 */
import type { Platform } from '@/platform/platform';
import { budgetedFetch, isSubrequestLimit, SUBREQUEST_LIMIT_CODE } from '@/platform/subrequests';
import type { SubrequestBudget } from '@/platform/subrequests';
import { SecretDecryptError } from '@/server/crypto/secrets';
import type { DbHandle } from '@/server/db/client';
import type { Env } from '@/server/env';
import { errorLabel } from '@/server/error-label';
import type { ObjectStorage } from '@/server/storage/storage';
import { runTick } from '@/server/tick/tick';
import type { TickContext, TickReport, TickStep } from '@/server/tick/tick';

import { disturbanceReason } from './disturbance';
import { SenderNotFoundError } from './errors';
import { openSenderTransport } from './open-transport';
import type { QuotaScope, SenderTransport } from './open-transport';
import {
	askedWait,
	claimEntry,
	clearDisturbance,
	disturbConnection,
	dueSenders,
	failOrphans,
	guardKeyLifetime,
	hasDueEntry,
	markUncertain,
	outcomeOf,
	recentSends,
	recordRecipient,
	retryOrFail,
	storeOutcome,
} from './outbox';
import type {
	Claim,
	ClaimedEntry,
	DueSender,
	EntryOutcome,
	EntryPreparer,
	PrepareEntry,
	PreparedMail,
} from './outbox';
import { countSent, liftPause, mayStart, pauseScope, quotaToday, scopePause } from './quota';
import type { ScopePause } from './quota';
import { newMessageId } from './transport';
import type { OutgoingMail, SendResult, Transport } from './transport';

/**
 * The budget of a run started right after a wave is confirmed ("sofort", Design 8.7): Workers
 * keep work after the response for 30 seconds only. The rest follows with the next tick.
 */
const KICK_BUDGET_MS = 20_000;
/**
 * The most provider requests one mail costs: Graph fetches a token for the first mail of a sender
 * in a run, then one request per mail. A run starts no mail with fewer left in its budget.
 */
const REQUESTS_PER_MAIL = 2;
/**
 * How long a scope pauses after an unclear send: the next run after it tests the scope with one
 * entry, so an incident leaves one unclear entry per scope and pause.
 */
const UNCLEAR_PAUSE_MS = 900_000;
/**
 * No new send starts this long before the deadline, so that the later steps of the tick (bounces,
 * warnings) still run during a long wave; at most a quarter of the step's budget, so that a short
 * run (`KICK_BUDGET_MS`) still sends.
 */
const LATER_STEPS_MS = 20_000;
const LATER_STEPS_SHARE = 4;
/** The throttle counts the mails of a scope per window of this length (decision 6). */
const WINDOW_MS = 60_000;

interface OutboxDeps {
	/** The preparer per source; an entry whose source has none fails (`outbox.noSource`). */
	readonly preparers: Readonly<Partial<Record<ClaimedEntry['source'], EntryPreparer>>>;
	readonly fetch: typeof fetch;
	/** Waits for the throttle; tests move their clock instead. */
	readonly sleep: (ms: number) => Promise<void>;
	/** Opens the transport of a sender; `openSenderTransport` unless a test hands in a double. */
	readonly openTransport?: typeof openSenderTransport;
}

/** A sender this run sends for. */
interface Lane {
	readonly senderId: string;
	readonly senderEmail: string;
	readonly connectionId: string;
	readonly scope: QuotaScope;
	readonly perMinute: number;
	/** Whether the scope has a daily limit. */
	readonly limited: boolean;
	readonly transport: Transport;
}

/**
 * A connection as this run sees it. `open`: its mails go; `probing`: disturbed without a token to
 * fetch, so one entry tests it; `closed`: disturbed, its mails wait. `disturbedSince` and
 * `disturbedCode` are the start and the code of a disturbance found at the start of the run; the
 * start stays when a probe succeeds and the next send is refused anyway (a mailbox the app may not
 * use), and a probe clears only that disturbance.
 */
interface ConnectionState {
	readonly mode: 'closed' | 'open' | 'probing';
	readonly disturbedSince: Date | null;
	readonly disturbedCode: string | null;
}

/**
 * A quota scope as this run sees it: `open`; `probing` after a pause ended, so one entry tests
 * whether the provider takes mails again; `closed` while paused, at the limit or after a failed
 * test.
 */
type ScopeMode = 'closed' | 'open' | 'probing';

/** The throttle window of a scope: when it began and how many mails went in it. */
interface SendWindow {
	readonly start: number;
	readonly sent: number;
}

/**
 * What a turn did with its entry: the outcome, the provider's answer when it sent, and whether
 * the preparer threw.
 */
interface Delivery {
	readonly outcome: Readonly<EntryOutcome>;
	readonly result: Readonly<SendResult> | null;
	readonly preparerThrew?: true;
}

/** What the loop of a run does next. */
type Next = 'continue' | 'done' | 'more';

const EMPTY_WINDOW: SendWindow = { sent: 0, start: Number.NEGATIVE_INFINITY };

/**
 * When the next mail of a scope may go.
 *
 * @param window The window.
 * @param perMinute The mails a window allows.
 * @param now The instant, epoch milliseconds.
 * @returns `now` when it may go at once, else the end of the window.
 */
function openAt(window: Readonly<SendWindow>, perMinute: number, now: number): number {
	if (now - window.start >= WINDOW_MS || window.sent < perMinute) return now;
	return window.start + WINDOW_MS;
}

/**
 * The window after one more mail; a mail after the end of the window starts a new one.
 *
 * @param window The window.
 * @param now The instant, epoch milliseconds.
 * @returns The new window.
 */
function withSend(window: Readonly<SendWindow>, now: number): SendWindow {
	if (now - window.start >= WINDOW_MS) return { sent: 1, start: now };
	return { sent: window.sent + 1, start: window.start };
}

/**
 * Whether an answer shows that the provider took the credentials: it sent, refused the
 * recipient or counted the quota.
 *
 * @param result The answer.
 * @returns True when the credentials work.
 */
function provesCredentials(result: Readonly<SendResult>): boolean {
	return result.ok || result.failure === 'rejected' || result.failure === 'quota';
}

/**
 * What becomes of an entry the preparer does not hand a mail for.
 *
 * @param prepared The skip or the failure, or null when the preparer threw.
 * @param at The attempts before this one and the instant.
 * @returns The outcome: skipped, failed, or retried later when the preparer threw.
 */
function unsentOutcome(
	prepared: Readonly<Exclude<PreparedMail, { kind: 'send' }>> | null,
	at: Readonly<{ attempts: number; now: Date }>,
): EntryOutcome {
	if (prepared === null) {
		const { now } = at;
		return retryOrFail('outbox.prepare', { attempts: at.attempts + 1, now, retryAfterMs: null });
	}
	if (prepared.kind === 'skip') return { kind: 'skipped', reason: prepared.reason };
	return { attempt: false, code: prepared.code, kind: 'failed' };
}

/** A transport that can fetch a token. */
type ProbingTransport = Transport & { readonly probe: NonNullable<Transport['probe']> };

/**
 * Whether a token decides about a disturbed connection: only for a Graph connection whose
 * credentials were refused, not for a refused mailbox or domain.
 *
 * @param transport The transport of a sender of the connection.
 * @param code The code of the disturbance.
 * @returns True when the transport can fetch a token and the code is about the credentials.
 */
function tokenDecides(transport: Transport, code: string | null): transport is ProbingTransport {
	return transport.probe !== null && disturbanceReason(code) === 'credentials';
}

/**
 * How a scope starts the run: open without a pause, closed while paused, probing after it.
 *
 * @param pause The stored pause, or null.
 * @param now The instant.
 * @returns The mode.
 */
function scopeModeOf(pause: Readonly<ScopePause> | null, now: Date): ScopeMode {
	if (pause === null) return 'open';
	return pause.until.getTime() > now.getTime() ? 'closed' : 'probing';
}

/**
 * The lane of an opened sender.
 *
 * @param due The sender and its connection.
 * @param opened The transport with its scope and limits.
 * @returns The lane.
 */
function laneOf(due: Readonly<DueSender>, opened: Readonly<SenderTransport>): Lane {
	return {
		connectionId: due.connectionId,
		limited: opened.dailyLimit !== null,
		perMinute: opened.perMinute,
		scope: opened.scope,
		senderEmail: opened.sender.email,
		senderId: due.senderId,
		transport: opened.transport,
	};
}

/**
 * Sends a mail. A transport that throws instead of answering may have sent: the entry becomes
 * `uncertain`, never sent again by itself; only a throw of the platform's subrequest limit is
 * known to have sent nothing.
 *
 * @param transport The transport.
 * @param mail The mail.
 * @returns The answer.
 */
async function sendSafely(transport: Transport, mail: Readonly<OutgoingMail>): Promise<SendResult> {
	try {
		return await transport.send(mail);
	} catch (error) {
		if (isSubrequestLimit(error)) {
			return { code: SUBREQUEST_LIMIT_CODE, failure: 'transient', ok: false, retryAfterMs: null };
		}
		// oxlint-disable-next-line no-console -- name or code only, the message may carry the address
		console.error('outbox send failed', errorLabel(error));
		return { code: 'outbox.send', failure: 'uncertain', ok: false, retryAfterMs: null };
	}
}

/**
 * Checks a disturbed connection by fetching a token.
 *
 * @param probe The token check of the transport.
 * @returns The answer; a throw counts as a transient failure.
 */
async function probeSafely(probe: () => Promise<SendResult>): Promise<SendResult> {
	try {
		return await probe();
	} catch (error) {
		// oxlint-disable-next-line no-console -- name or code only
		console.error('outbox probe failed', errorLabel(error));
		return { code: 'outbox.probe', failure: 'transient', ok: false, retryAfterMs: null };
	}
}

/** One run of the step: its lanes, throttle windows and connections. */
class OutboxRun {
	private lanes: Lane[] = [];
	private turn = 0;
	private readonly windows = new Map<QuotaScope, SendWindow>();
	private readonly scopes = new Map<QuotaScope, ScopeMode>();
	private readonly connections = new Map<string, ConnectionState>();
	/** The prepare function of each source for this run (`EntryPreparer.startRun`). */
	private readonly prepares = new Map<ClaimedEntry['source'], PrepareEntry>();
	/** The `fetch` of the transports: it takes every request from the invocation's budget. */
	private readonly fetch: typeof fetch;
	/** No send starts at or after this instant, epoch milliseconds. */
	private readonly stopAt: number;

	/**
	 * @param deps The preparers, `fetch`, `sleep` and the overrides of tests.
	 * @param ctx The tick's database, environment, clock, deadline, storage and subrequests.
	 */
	public constructor(
		private readonly deps: Readonly<OutboxDeps>,
		private readonly ctx: TickContext,
	) {
		this.fetch = budgetedFetch(deps.fetch, ctx.subrequests);
		const budget = Math.max(0, ctx.deadline - ctx.now().getTime());
		this.stopAt = ctx.deadline - Math.min(LATER_STEPS_MS, budget / LATER_STEPS_SHARE);
	}

	/**
	 * Runs the step once.
	 *
	 * @returns Whether due entries are left that the next run can send.
	 */
	public async run(): Promise<{ moreWork: boolean }> {
		await this.openLanes();
		let next: Next = 'continue';
		while (next === 'continue' && this.lanes.length > 0) {
			// oxlint-disable-next-line no-await-in-loop -- the turns follow one another
			next = await this.step();
		}
		return { moreWork: next === 'more' };
	}

	/**
	 * Turns entries stuck in `sending` uncertain, fails entries without sender and opens a lane for
	 * every sender with due entries, unless the invocation's subrequests are spent.
	 */
	private async openLanes(): Promise<void> {
		const { db } = this.ctx;
		await markUncertain(db, this.ctx.now());
		await failOrphans(db);
		if (this.subrequestsSpent()) return;
		for (const due of await dueSenders(db, this.ctx.now())) {
			// oxlint-disable-next-line no-await-in-loop -- senders open one after another, a probe once per connection
			await this.open(due);
		}
	}

	/**
	 * One step of the loop: a mail for the next lane in turn, or a wait for the next window. Stops
	 * shortly before the deadline (`LATER_STEPS_MS`), and when the next window would open after that.
	 * Stops without more work when the invocation's subrequests are spent: no later tick of the
	 * invocation could send either, the next invocation goes on.
	 *
	 * @returns Whether to go on, or whether work is left.
	 */
	private async step(): Promise<Next> {
		if (this.subrequestsSpent()) {
			this.endRun();
			return 'done';
		}
		const now = this.ctx.now().getTime();
		if (now >= this.stopAt) return (await this.anyLeft()) ? 'more' : 'done';
		const lane = this.readyLane(now);
		if (lane !== undefined) {
			await this.sendNext(lane);
			return 'continue';
		}
		return this.waitForWindow(now);
	}

	/**
	 * Waits until the first full window ends, unless no lane has anything left or the window would
	 * end after the step stops starting sends.
	 *
	 * @param now The instant, epoch milliseconds.
	 * @returns Whether to go on, or whether work is left.
	 */
	private async waitForWindow(now: number): Promise<Next> {
		if (!(await this.anyLeft())) return 'done';
		const wake = Math.min(...this.lanes.map((each) => this.openAtFor(each, now)));
		if (wake >= this.stopAt) return 'more';
		await this.deps.sleep(wake - now);
		return 'continue';
	}

	/**
	 * The next lane in turn whose throttle lets a mail go now.
	 *
	 * @param now The instant, epoch milliseconds.
	 * @returns The lane, or undefined when every window is full.
	 */
	private readyLane(now: number): Lane | undefined {
		const { length } = this.lanes;
		for (let offset = 0; offset < length; offset += 1) {
			const index = (this.turn + offset) % length;
			const lane = this.lanes[index];
			if (lane !== undefined && this.openAtFor(lane, now) <= now) {
				this.turn = index + 1;
				return lane;
			}
		}
		return undefined;
	}

	/**
	 * Whether the invocation has too few subrequests left for another mail.
	 *
	 * @returns True on Cloudflare once the budget is (nearly) spent; never elsewhere.
	 */
	private subrequestsSpent(): boolean {
		const { subrequests } = this.ctx;
		return subrequests !== null && subrequests.left() < REQUESTS_PER_MAIL;
	}

	private openAtFor(lane: Readonly<Lane>, now: number): number {
		return openAt(this.windows.get(lane.scope) ?? EMPTY_WINDOW, lane.perMinute, now);
	}

	/**
	 * Drops the lanes that have nothing due they may send.
	 *
	 * @returns Whether a lane is left.
	 */
	private async anyLeft(): Promise<boolean> {
		for (const lane of this.lanes) {
			// oxlint-disable-next-line no-await-in-loop -- one small query per lane
			if (this.lanes.includes(lane)) await this.dropIfIdle(lane);
		}
		return this.lanes.length > 0;
	}

	/**
	 * Drops a lane whose scope is at its limit or that has nothing due it may send.
	 *
	 * @param lane The lane.
	 */
	private async dropIfIdle(lane: Readonly<Lane>): Promise<void> {
		if (!(await this.hasSendable(lane))) this.dropLane(lane);
	}

	/**
	 * Whether a lane has a due entry its scope's limit lets start (decision 5).
	 *
	 * @param lane The lane.
	 * @returns True when one may go.
	 */
	private async hasSendable(lane: Readonly<Lane>): Promise<boolean> {
		const admission = await this.admit(lane);
		if (admission === 'closed') return false;
		const { personalOnly } = admission;
		const now = this.ctx.now();
		return hasDueEntry(this.ctx.db, { now, personalOnly, senderId: lane.senderId });
	}

	/**
	 * Opens the transport of a sender with due entries and adds its lane, unless its connection is
	 * disturbed. A disturbed Graph connection gets its token check here, once per run.
	 *
	 * @param due The sender and its connection.
	 */
	private async open(due: Readonly<DueSender>): Promise<void> {
		const known = this.connections.get(due.connectionId);
		if (known?.mode === 'closed') return;
		const opened = await this.openTransport(due);
		if (opened === null || (await this.scopeMode(opened.scope)) === 'closed') return;
		const connection = known ?? (await this.check(due, opened.transport));
		if (connection.mode === 'closed') return;
		this.lanes.push(laneOf(due, opened));
		await this.startWindow(opened.scope);
	}

	/**
	 * The mode of a scope, read from its stored pause the first time the run meets it.
	 *
	 * @param scope The scope.
	 * @returns The mode.
	 */
	private async scopeMode(scope: QuotaScope): Promise<ScopeMode> {
		const known = this.scopes.get(scope);
		if (known !== undefined) return known;
		const mode = scopeModeOf(await scopePause(this.ctx.db, scope), this.ctx.now());
		this.scopes.set(scope, mode);
		return mode;
	}

	/**
	 * Starts the throttle window of a scope with the mails of the last minute, so that this run
	 * continues where the run before it stopped (decision 6).
	 *
	 * @param scope The scope.
	 */
	private async startWindow(scope: QuotaScope): Promise<void> {
		if (this.windows.has(scope)) return;
		const recent = await recentSends(this.ctx.db, scope, this.ctx.now());
		const start = recent.oldest?.getTime() ?? Number.NEGATIVE_INFINITY;
		this.windows.set(scope, { sent: recent.count, start });
	}

	/**
	 * Opens the transport of a sender. A secret that does not decrypt (another app secret) disturbs
	 * the connection, so that its entries wait and the admins learn of it; any other failure (the
	 * database) ends the step, and the entries wait for the next tick.
	 *
	 * @param due The sender and its connection.
	 * @returns The transport with its scope and limits, or null.
	 * @throws {Error} Whatever opening threw, but a missing sender or a secret that does not decrypt.
	 */
	private async openTransport(due: Readonly<DueSender>): Promise<SenderTransport | null> {
		const openTransport = this.deps.openTransport ?? openSenderTransport;
		const { fetch } = this;
		try {
			return await openTransport(this.ctx.db, this.ctx.env, due.senderId, {
				fetch,
				now: this.ctx.now,
			});
		} catch (error) {
			if (error instanceof SenderNotFoundError) return null;
			if (!(error instanceof SecretDecryptError)) throw error;
			// oxlint-disable-next-line no-console -- name or code only, the message may carry details
			console.error('outbox transport not opened', errorLabel(error));
			await this.disturb(due.connectionId, 'outbox.credentials', due.disturbedSince);
			return null;
		}
	}

	/**
	 * Finds and stores the state of a connection at the start of the run.
	 *
	 * @param due The sender and its connection.
	 * @param transport The transport of the sender.
	 * @returns The state, also for the other senders of the connection.
	 */
	private async check(due: Readonly<DueSender>, transport: Transport): Promise<ConnectionState> {
		const state: ConnectionState = {
			disturbedCode: due.disturbedCode,
			disturbedSince: due.disturbedSince,
			mode: await this.modeOf(due, transport),
		};
		this.connections.set(due.connectionId, state);
		return state;
	}

	/**
	 * Whether a connection may send: yes when it is not disturbed; a disturbed Graph connection
	 * when a token comes (the disturbance ends); a disturbed Resend connection, or one whose sending
	 * mailbox or domain was refused (a token says nothing about those), by one entry (decision 9).
	 *
	 * @param due The sender and its connection.
	 * @param transport The transport of the sender.
	 * @returns The mode.
	 */
	private async modeOf(
		due: Readonly<DueSender>,
		transport: Transport,
	): Promise<ConnectionState['mode']> {
		const { connectionId, disturbedCode, disturbedSince } = due;
		if (disturbedSince === null) return 'open';
		if (!tokenDecides(transport, disturbedCode)) return 'probing';
		const probed = await probeSafely(transport.probe);
		if (probed.ok) {
			await clearDisturbance(this.ctx.db, connectionId, {
				code: disturbedCode,
				since: disturbedSince,
			});
			return 'open';
		}
		if (probed.failure === 'unauthorized') {
			await disturbConnection(this.ctx.db, connectionId, probed.code, disturbedSince);
		}
		return 'closed';
	}

	/**
	 * Whether the scope of a lane may send now, and what (decision 5).
	 *
	 * @param lane The lane.
	 * @returns `closed` at the limit, else whether only personal mail may start.
	 */
	private async admit(lane: Readonly<Lane>): Promise<'closed' | { personalOnly: boolean }> {
		if (!lane.limited) return { personalOnly: false };
		const state = await quotaToday(this.ctx.db, lane.scope, this.ctx.now());
		if (!mayStart(state, 'personal')) return 'closed';
		return { personalOnly: !mayStart(state, 'group') };
	}

	/**
	 * One turn of a lane: takes its next entry, prepares and sends it, stores the outcome and acts
	 * on what it says about the scope or the connection.
	 *
	 * @param lane The lane.
	 */
	private async sendNext(lane: Readonly<Lane>): Promise<void> {
		const claim = await this.take(lane);
		if (claim === null) return;
		const delivery = await this.deliver(lane, claim);
		if (delivery === null) return;
		const stored = await storeOutcome(this.ctx.db, claim, delivery.outcome, this.ctx.now());
		// oxlint-disable-next-line no-console -- the kind of outcome only; the state another run or a person set stays
		if (!stored) console.warn('outbox entry changed while sending', delivery.outcome.kind);
		await this.settle(lane, delivery);
	}

	/**
	 * Takes the next entry of a lane that its scope's limit allows. A lane at the limit stops with
	 * its scope, a lane with nothing due on its own.
	 *
	 * @param lane The lane.
	 * @returns The take, or null.
	 */
	private async take(lane: Readonly<Lane>): Promise<Claim | null> {
		const admission = await this.admit(lane);
		if (admission === 'closed') {
			this.closeScope(lane.scope);
			return null;
		}
		const claim = await claimEntry(this.ctx.db, {
			messageId: newMessageId(lane.senderEmail),
			now: this.ctx.now(),
			personalOnly: admission.personalOnly,
			senderId: lane.senderId,
		});
		if (claim === null) this.dropLane(lane);
		return claim;
	}

	/**
	 * Prepares the entry and, when the preparer hands a mail, sends it.
	 *
	 * @param lane The lane.
	 * @param claim The take.
	 * @returns What became of the entry, or null when it was no longer this run's.
	 */
	private async deliver(lane: Readonly<Lane>, claim: Readonly<Claim>): Promise<Delivery | null> {
		const { attempts, source } = claim.entry;
		const preparer = this.deps.preparers[source];
		if (preparer === undefined) {
			return { outcome: { attempt: false, code: 'outbox.noSource', kind: 'failed' }, result: null };
		}
		const prepared = await this.prepare(this.preparerOfRun(source, preparer), claim);
		if (prepared?.kind === 'send') return this.send(lane, claim, prepared);
		const outcome = unsentOutcome(prepared, { attempts, now: this.ctx.now() });
		return prepared === null
			? { outcome, preparerThrew: true, result: null }
			: { outcome, result: null };
	}

	/**
	 * The prepare function of a source for this run: started once per run when the preparer keeps
	 * what its entries share (`startRun`), its plain `prepare` otherwise.
	 *
	 * @param source The source.
	 * @param preparer Its preparer.
	 * @returns The prepare function.
	 */
	private preparerOfRun(source: ClaimedEntry['source'], preparer: EntryPreparer): PrepareEntry {
		const known = this.prepares.get(source);
		if (known !== undefined) return known;
		const prepare = preparer.startRun?.() ?? preparer.prepare;
		this.prepares.set(source, prepare);
		return prepare;
	}

	/**
	 * Runs the preparer. A preparer that throws is logged by its code or name; the entry is tried
	 * again later.
	 *
	 * @param prepare The prepare function of the entry's source for this run.
	 * @param claim The take.
	 * @returns The prepared mail, or null when the preparer threw.
	 */
	private async prepare(
		prepare: PrepareEntry,
		claim: Readonly<Claim>,
	): Promise<PreparedMail | null> {
		const { db, env, storage } = this.ctx;
		try {
			return await prepare(db, claim.entry, { env, now: this.ctx.now(), storage });
		} catch (error) {
			// oxlint-disable-next-line no-console -- name or code only, the message may carry contact data
			console.error('outbox entry not prepared', errorLabel(error));
			return null;
		}
	}

	/**
	 * Sends the prepared mail with the entry's Message-ID (ruling R4) and its id as idempotency key
	 * to the prepared address, after storing that address and checking that the entry is still this
	 * run's. Both stay the same for every attempt of the entry, whatever the preparer hands. A retry
	 * that the provider's key no longer protects becomes `uncertain` (ruling R7).
	 *
	 * @param lane The lane.
	 * @param claim The take.
	 * @param prepared The mail and its recipient.
	 * @returns What became of the entry, or null when it was no longer this run's.
	 */
	private async send(
		lane: Readonly<Lane>,
		claim: Readonly<Claim>,
		prepared: Readonly<Extract<PreparedMail, { kind: 'send' }>>,
	): Promise<Delivery | null> {
		const { recipient } = prepared;
		const firstAttemptAt = await recordRecipient(this.ctx.db, claim, recipient);
		if (firstAttemptAt === null) return null;
		this.countSend(lane);
		const { id, messageId } = claim.entry;
		const mail = { ...prepared.mail, idempotencyKey: id, messageId, to: recipient };
		const result = await sendSafely(lane.transport, mail);
		const { attempts } = claim.entry;
		return { outcome: await this.answered(lane, result, { attempts, firstAttemptAt }), result };
	}

	/**
	 * What the provider's answer makes of the entry. An accepted mail counts against the daily
	 * limit (decision 4) before the outcome is stored; a retry the provider's key no longer protects
	 * becomes `uncertain` (ruling R7).
	 *
	 * @param lane The lane.
	 * @param result The answer.
	 * @param entry The attempts before this one and when the entry's mail first went out.
	 * @returns The outcome.
	 */
	private async answered(
		lane: Readonly<Lane>,
		result: Readonly<SendResult>,
		entry: Readonly<{ attempts: number; firstAttemptAt: Date }>,
	): Promise<EntryOutcome> {
		const now = this.ctx.now();
		if (result.ok) await countSent(this.ctx.db, lane.scope, now);
		const outcome = outcomeOf(result, { attempts: entry.attempts, now });
		const idempotency = lane.transport.idempotency ?? null;
		const { firstAttemptAt } = entry;
		return guardKeyLifetime(outcome, { firstAttemptAt, idempotency, now, result });
	}

	/**
	 * Counts a mail of a scope for the throttle.
	 *
	 * @param lane The lane.
	 */
	private countSend(lane: Readonly<Lane>): void {
		const window = this.windows.get(lane.scope) ?? EMPTY_WINDOW;
		this.windows.set(lane.scope, withSend(window, this.ctx.now().getTime()));
	}

	/**
	 * Acts on a stored outcome: records a disturbance, ends the run when the platform refused a
	 * request, stops a sender whose preparer threw, backs off after trouble at the provider, ends a
	 * disturbance a test entry disproved, and pauses or opens the scope.
	 *
	 * @param lane The lane.
	 * @param delivery What became of the entry.
	 */
	private async settle(lane: Readonly<Lane>, delivery: Readonly<Delivery>): Promise<void> {
		if (await this.stopsAtOnce(lane, delivery)) return;
		const { outcome, result } = delivery;
		if (await this.backOff(lane, result)) return;
		if (!(await this.settleProbe(lane, result))) return;
		await this.settleScope(lane, outcome, result);
	}

	/**
	 * Stops what an outcome stops whatever else the answer says: a refusal of the credentials
	 * disturbs the connection, a request the platform refused ends the run, a preparer that threw
	 * drops the sender for the run (the storage or the database: its next entries would fail too).
	 *
	 * @param lane The lane.
	 * @param delivery What became of the entry.
	 * @returns True when something stopped.
	 */
	private async stopsAtOnce(lane: Readonly<Lane>, delivery: Readonly<Delivery>): Promise<boolean> {
		const { outcome } = delivery;
		if (outcome.kind === 'release') {
			await this.disturbLane(lane, outcome.code);
			return true;
		}
		if (outcome.kind === 'requeue') this.endRun();
		else if (delivery.preparerThrew === true) this.dropLane(lane);
		else return false;
		return true;
	}

	/**
	 * Backs off after an answer that shows trouble at the provider. An unclear send stops the
	 * connection for the run and pauses the scope for `UNCLEAR_PAUSE_MS`; a transient refusal stops
	 * the scope for the run and, when the provider named a wait, pauses it until then.
	 *
	 * @param lane The lane.
	 * @param result The provider's answer, or null when nothing was sent.
	 * @returns True when the lane stopped.
	 */
	private async backOff(
		lane: Readonly<Lane>,
		result: Readonly<SendResult> | null,
	): Promise<boolean> {
		if (result === null || result.ok) return false;
		if (result.failure === 'uncertain') {
			await this.pauseFor(lane, result.code, UNCLEAR_PAUSE_MS);
			this.closeConnection(lane.connectionId);
			return true;
		}
		if (result.failure !== 'transient') return false;
		await this.pauseFor(lane, result.code, askedWait(result.retryAfterMs));
		this.closeScope(lane.scope);
		return true;
	}

	/**
	 * Pauses the scope of a lane for a while (persisted, so the next runs wait too).
	 *
	 * @param lane The lane.
	 * @param code The code of the answer that caused it.
	 * @param ms How long; nothing happens for 0.
	 */
	private async pauseFor(lane: Readonly<Lane>, code: string, ms: number): Promise<void> {
		if (ms <= 0) return;
		const until = new Date(this.ctx.now().getTime() + ms);
		await pauseScope(this.ctx.db, { code, scope: lane.scope, until });
	}

	/**
	 * Pauses the lane's scope on a spent quota (ruling R5); after a pause, the one entry that tested
	 * the scope ends the pause when the provider took it, else the scope waits for the next run.
	 *
	 * @param lane The lane.
	 * @param outcome What became of the entry.
	 * @param result The provider's answer, or null when nothing was sent.
	 */
	private async settleScope(
		lane: Readonly<Lane>,
		outcome: Readonly<EntryOutcome>,
		result: Readonly<SendResult> | null,
	): Promise<void> {
		if (outcome.kind === 'pause') {
			const { code, until } = outcome;
			await pauseScope(this.ctx.db, { code, scope: lane.scope, until });
			this.closeScope(lane.scope);
			return;
		}
		if (this.scopes.get(lane.scope) !== 'probing' || result === null) return;
		await this.endPause(lane, result);
	}

	/**
	 * Ends the pause of a scope when its test entry went out, else stops the scope for this run.
	 *
	 * @param lane The lane.
	 * @param result The provider's answer to the test entry.
	 */
	private async endPause(lane: Readonly<Lane>, result: Readonly<SendResult>): Promise<void> {
		if (!result.ok) {
			this.closeScope(lane.scope);
			return;
		}
		await liftPause(this.ctx.db, lane.scope, this.ctx.now());
		this.scopes.set(lane.scope, 'open');
	}

	/**
	 * Records that the provider refused the credentials of a lane's connection; a disturbance found
	 * at the start of the run keeps its start.
	 *
	 * @param lane The lane.
	 * @param code The code of the refusal.
	 */
	private async disturbLane(lane: Readonly<Lane>, code: string): Promise<void> {
		const since = this.connections.get(lane.connectionId)?.disturbedSince ?? null;
		await this.disturb(lane.connectionId, code, since);
	}

	/**
	 * Ends the disturbance of a connection when its one test entry of the run shows that the
	 * credentials (or the mailbox) work, else stops its lanes.
	 *
	 * @param lane The lane.
	 * @param result The provider's answer, or null when nothing was sent.
	 * @returns False when the connection's lanes stopped.
	 */
	private async settleProbe(
		lane: Readonly<Lane>,
		result: Readonly<SendResult> | null,
	): Promise<boolean> {
		const connection = this.connections.get(lane.connectionId);
		if (connection?.mode !== 'probing' || result === null) return true;
		if (!provesCredentials(result)) {
			this.closeConnection(lane.connectionId);
			return false;
		}
		const { disturbedCode, disturbedSince } = connection;
		if (disturbedSince !== null) {
			await clearDisturbance(this.ctx.db, lane.connectionId, {
				code: disturbedCode,
				since: disturbedSince,
			});
		}
		this.connections.set(lane.connectionId, { ...connection, mode: 'open' });
		return true;
	}

	/**
	 * Records a refusal of the credentials and stops the connection's lanes for this run.
	 *
	 * @param connectionId The connection.
	 * @param code The code of the refusal.
	 * @param since When a disturbance found at the start of the run began, or null.
	 */
	private async disturb(connectionId: string, code: string, since: Date | null): Promise<void> {
		await disturbConnection(this.ctx.db, connectionId, code, since ?? this.ctx.now());
		this.closeConnection(connectionId);
	}

	private closeConnection(connectionId: string): void {
		const known = this.connections.get(connectionId);
		this.connections.set(connectionId, {
			disturbedCode: known?.disturbedCode ?? null,
			disturbedSince: known?.disturbedSince ?? null,
			mode: 'closed',
		});
		this.lanes = this.lanes.filter((lane) => lane.connectionId !== connectionId);
	}

	private closeScope(scope: QuotaScope): void {
		this.scopes.set(scope, 'closed');
		this.lanes = this.lanes.filter((lane) => lane.scope !== scope);
	}

	private dropLane(dropped: Readonly<Lane>): void {
		this.lanes = this.lanes.filter((lane) => lane !== dropped);
	}

	/** Stops every lane: the invocation may make no more requests. */
	private endRun(): void {
		if (this.lanes.length === 0) return;
		this.lanes = [];
		// oxlint-disable-next-line no-console -- no details; the next invocation goes on
		console.warn('outbox stopped at the subrequest limit');
	}
}

/**
 * Builds the outbox step.
 *
 * @param deps The preparers per source, `fetch` and `sleep`.
 * @returns The step `outbox`.
 */
function createOutboxStep(deps: Readonly<OutboxDeps>): TickStep {
	return {
		name: 'outbox',
		async run(ctx) {
			return new OutboxRun(deps, ctx).run();
		},
	};
}

/**
 * Runs the work in an async function, so that a function that throws at once still hands over a
 * promise.
 *
 * @param run The work.
 * @returns Its promise.
 */
async function started(run: () => Promise<unknown>): Promise<unknown> {
	return run();
}

/**
 * Starts a short run in the background ("sofort", Design 8.7): the caller hands over a run with
 * `KICK_BUDGET_MS`, and the platform keeps it alive after the response.
 *
 * The run must not use the request's database: on Cloudflare it ends with the response
 * (`requestDbReleaser`), and an entry the run took then would stay `sending` and later turn
 * `uncertain`. The caller passes `kickRun`, which opens a database of its own and ends it
 * afterwards, as the cron handler does (`cloudflare-worker.ts`), and gives its tick the subrequest
 * budget of the request's invocation (`invocationBudget`).
 *
 * @param platform The platform.
 * @param run The run: `kickRun` with the outbox step.
 */
function kickOutbox(platform: Platform, run: () => Promise<unknown>): void {
	platform.waitUntil(started(run));
}

/** What a run of `kickOutbox` needs: its steps, and a database and a budget of its own. */
interface KickRunDeps {
	readonly env: Env;
	readonly storage: ObjectStorage | null;
	/** The steps to run: the outbox step. */
	readonly steps: readonly TickStep[];
	/** Opens a database that only the run uses; the run ends it when it is done. */
	readonly openDb: () => Promise<DbHandle>;
	/** The provider requests the invocation may still make (`invocationBudget`). */
	readonly subrequests: SubrequestBudget | null;
}

/**
 * The run that `kickOutbox` keeps alive after the response: a tick with the budget
 * `KICK_BUDGET_MS` on a database it opens when it starts and ends when it is done, never the
 * request's. It takes the tick lock like every tick, so a tick that runs already sends instead. It
 * does not ping the heartbeat: the monitor watches the scheduler, and a kick is none of its runs.
 *
 * @param deps The environment, the storage, the steps, the database and the budget.
 * @returns The run.
 */
function kickRun(deps: KickRunDeps): () => Promise<TickReport> {
	return async () => {
		const { db, end } = await deps.openDb();
		try {
			return await runTick({
				budgetMs: KICK_BUDGET_MS,
				db,
				env: { ...deps.env, heartbeatUrl: null },
				steps: deps.steps,
				storage: deps.storage,
				subrequests: deps.subrequests,
			});
		} finally {
			await end();
		}
	};
}

export { KICK_BUDGET_MS, createOutboxStep, kickOutbox, kickRun };
export type { KickRunDeps, OutboxDeps };
