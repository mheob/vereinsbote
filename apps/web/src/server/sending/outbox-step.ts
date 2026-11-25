/*
 * The tick step of the outbox (Design 8.2 to 8.7). It turns stuck entries `uncertain`, then sends
 * the due entries of every sender in turns, one entry per turn: personal mail first, within the
 * daily limit and its reserve, at most `perMinute` mails per quota scope and minute, and on
 * Cloudflare at most 40 per sender and tick (subrequests). A disturbed connection waits: a Graph
 * connection is checked once per run by fetching a token, a Resend connection (or a refused
 * mailbox) by sending one entry. A scope the provider stopped for its quota waits until its pause
 * ends, then one entry tests it (ruling R5). The step stops starting sends shortly before its
 * deadline, so that the later steps of the tick still run, and reports `moreWork` while due
 * entries are left that hang neither on a limit, a pause nor a disturbance.
 */
import { platformName } from '@/platform/platform';
import type { Platform, PlatformName } from '@/platform/platform';
import { SecretDecryptError } from '@/server/crypto/secrets';
import { errorLabel } from '@/server/error-label';
import type { TickContext, TickStep } from '@/server/tick/tick';

import { SenderNotFoundError } from './errors';
import { openSenderTransport } from './open-transport';
import type { QuotaScope, SenderTransport } from './open-transport';
import {
	claimEntry,
	clearDisturbance,
	disturbConnection,
	dueSenders,
	failOrphans,
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
 * Mails per sender and tick on Cloudflare: each costs one or two of the Worker's subrequests. A
 * cron invocation chains up to `MAX_CHAINED_TICKS + 1` ticks, so this bounds a tick, not the
 * invocation.
 */
const CLOUDFLARE_SENDS_PER_SENDER = 40;
/**
 * No new send starts this long before the deadline, so that the later steps of the tick (bounces,
 * warnings) still run during a long wave; at most a quarter of the step's budget, so that a short
 * run (`KICK_BUDGET_MS`) still sends.
 */
const LATER_STEPS_MS = 20_000;
const LATER_STEPS_SHARE = 4;
/**
 * Disturbance codes of a refused sending mailbox: a token says nothing about them, so one entry
 * tests the connection instead (like Resend).
 */
const MAILBOX_CODES: ReadonlySet<string> = new Set(['graph.mailbox']);
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
	/** The platform of the build unless a test sets one. */
	readonly platform?: PlatformName;
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
 * fetch, so one entry tests it; `closed`: disturbed, its mails wait. `disturbedSince` is the start
 * of a disturbance found at the start of the run; it stays the start when a probe succeeds and
 * the next send is refused anyway (a mailbox the app may not use).
 */
interface ConnectionState {
	readonly mode: 'closed' | 'open' | 'probing';
	readonly disturbedSince: Date | null;
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

/** What a turn did with its entry: the outcome, and the provider's answer when it sent. */
interface Delivery {
	readonly outcome: Readonly<EntryOutcome>;
	readonly result: Readonly<SendResult> | null;
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
 * `uncertain`, never sent again by itself.
 *
 * @param transport The transport.
 * @param mail The mail.
 * @returns The answer.
 */
async function sendSafely(transport: Transport, mail: Readonly<OutgoingMail>): Promise<SendResult> {
	try {
		return await transport.send(mail);
	} catch (error) {
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
	private moreWork = false;
	private readonly windows = new Map<QuotaScope, SendWindow>();
	private readonly scopes = new Map<QuotaScope, ScopeMode>();
	private readonly connections = new Map<string, ConnectionState>();
	private readonly sends = new Map<string, number>();
	private readonly maxSends: number;
	/** No send starts at or after this instant, epoch milliseconds. */
	private readonly stopAt: number;

	/**
	 * @param deps The preparers, `fetch`, `sleep` and the overrides of tests.
	 * @param ctx The tick's database, environment, clock, deadline and storage.
	 */
	public constructor(
		private readonly deps: Readonly<OutboxDeps>,
		private readonly ctx: TickContext,
	) {
		const platform = deps.platform ?? platformName();
		this.maxSends =
			platform === 'cloudflare' ? CLOUDFLARE_SENDS_PER_SENDER : Number.POSITIVE_INFINITY;
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
		return { moreWork: next === 'more' || this.moreWork };
	}

	/**
	 * Turns entries stuck in `sending` uncertain, fails entries without sender and opens a lane for
	 * every sender with due entries.
	 */
	private async openLanes(): Promise<void> {
		const { db } = this.ctx;
		await markUncertain(db, this.ctx.now());
		await failOrphans(db);
		for (const due of await dueSenders(db, this.ctx.now())) {
			// oxlint-disable-next-line no-await-in-loop -- senders open one after another, a probe once per connection
			await this.open(due);
		}
	}

	/**
	 * One step of the loop: a mail for the next lane in turn, or a wait for the next window. Stops
	 * shortly before the deadline (`LATER_STEPS_MS`), and when the next window would open after that.
	 *
	 * @returns Whether to go on, or whether work is left.
	 */
	private async step(): Promise<Next> {
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
		const { fetch } = this.deps;
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
			disturbedSince: due.disturbedSince,
			mode: await this.modeOf(due, transport),
		};
		this.connections.set(due.connectionId, state);
		return state;
	}

	/**
	 * Whether a connection may send: yes when it is not disturbed; a disturbed Graph connection
	 * when a token comes (the disturbance ends); a disturbed Resend connection, or one whose sending
	 * mailbox was refused, by one entry (decision 9).
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
		if (transport.probe === null || MAILBOX_CODES.has(disturbedCode ?? '')) return 'probing';
		const probed = await probeSafely(transport.probe);
		if (probed.ok) {
			await clearDisturbance(this.ctx.db, connectionId);
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
		const prepared = await this.prepare(preparer, claim);
		if (prepared?.kind === 'send') return this.send(lane, claim, prepared);
		return { outcome: unsentOutcome(prepared, { attempts, now: this.ctx.now() }), result: null };
	}

	/**
	 * Runs the preparer. A preparer that throws is logged by name and the entry tried again later.
	 *
	 * @param preparer The preparer of the entry's source.
	 * @param claim The take.
	 * @returns The prepared mail, or null when the preparer threw.
	 */
	private async prepare(
		preparer: EntryPreparer,
		claim: Readonly<Claim>,
	): Promise<PreparedMail | null> {
		const { db, env, storage } = this.ctx;
		try {
			return await preparer.prepare(db, claim.entry, { env, now: this.ctx.now(), storage });
		} catch (error) {
			// oxlint-disable-next-line no-console -- name or code only, the message may carry contact data
			console.error('outbox entry not prepared', errorLabel(error));
			return null;
		}
	}

	/**
	 * Sends the prepared mail with the entry's Message-ID (ruling R4) to the prepared address,
	 * after storing that address and checking that the entry is still this run's.
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
		if (!(await recordRecipient(this.ctx.db, claim, recipient))) return null;
		this.countSend(lane);
		const mail = { ...prepared.mail, messageId: claim.entry.messageId, to: recipient };
		const result = await sendSafely(lane.transport, mail);
		const now = this.ctx.now();
		// Counted when the provider accepts it (decision 4), before the outcome is stored.
		if (result.ok) await countSent(this.ctx.db, lane.scope, now);
		const { attempts } = claim.entry;
		return {
			outcome: outcomeOf(result, { attempts, now }),
			result,
		};
	}

	/**
	 * Counts a request to the provider for the throttle and the Cloudflare limit.
	 *
	 * @param lane The lane.
	 */
	private countSend(lane: Readonly<Lane>): void {
		const window = this.windows.get(lane.scope) ?? EMPTY_WINDOW;
		this.windows.set(lane.scope, withSend(window, this.ctx.now().getTime()));
		this.sends.set(lane.senderId, (this.sends.get(lane.senderId) ?? 0) + 1);
	}

	/**
	 * Acts on a stored outcome: records or ends a disturbance, pauses the scope on a spent quota or
	 * ends its pause, and stops a lane at the Cloudflare limit.
	 *
	 * @param lane The lane.
	 * @param delivery What became of the entry.
	 */
	private async settle(lane: Readonly<Lane>, delivery: Readonly<Delivery>): Promise<void> {
		const { outcome, result } = delivery;
		if (outcome.kind === 'release') {
			await this.disturbLane(lane, outcome.code);
			return;
		}
		if (!(await this.settleProbe(lane, result))) return;
		if (!(await this.settleScope(lane, outcome, result))) return;
		await this.stopAtLimit(lane);
	}

	/**
	 * Pauses the lane's scope on a spent quota (ruling R5); after a pause, the one entry that tested
	 * the scope ends the pause when the provider took it, else the scope waits for the next run.
	 *
	 * @param lane The lane.
	 * @param outcome What became of the entry.
	 * @param result The provider's answer, or null when nothing was sent.
	 * @returns False when the scope's lanes stopped.
	 */
	private async settleScope(
		lane: Readonly<Lane>,
		outcome: Readonly<EntryOutcome>,
		result: Readonly<SendResult> | null,
	): Promise<boolean> {
		if (outcome.kind === 'pause') {
			const { code, until } = outcome;
			await pauseScope(this.ctx.db, { code, scope: lane.scope, until });
			this.closeScope(lane.scope);
			return false;
		}
		if (this.scopes.get(lane.scope) !== 'probing' || result === null) return true;
		return this.endPause(lane, result);
	}

	/**
	 * Ends the pause of a scope when its test entry went out, else stops the scope for this run.
	 *
	 * @param lane The lane.
	 * @param result The provider's answer to the test entry.
	 * @returns Whether the scope sends again.
	 */
	private async endPause(lane: Readonly<Lane>, result: Readonly<SendResult>): Promise<boolean> {
		if (!result.ok) {
			this.closeScope(lane.scope);
			return false;
		}
		await liftPause(this.ctx.db, lane.scope, this.ctx.now());
		this.scopes.set(lane.scope, 'open');
		return true;
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
		await clearDisturbance(this.ctx.db, lane.connectionId);
		this.connections.set(lane.connectionId, { ...connection, mode: 'open' });
		return true;
	}

	/**
	 * Stops a lane at the Cloudflare limit of mails per sender and tick; due entries the scope's
	 * limit lets start ask for the next tick.
	 *
	 * @param lane The lane.
	 */
	private async stopAtLimit(lane: Readonly<Lane>): Promise<void> {
		if ((this.sends.get(lane.senderId) ?? 0) < this.maxSends) return;
		this.dropLane(lane);
		const sendable = await this.hasSendable(lane);
		this.moreWork ||= sendable;
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
		const disturbedSince = this.connections.get(connectionId)?.disturbedSince ?? null;
		this.connections.set(connectionId, { disturbedSince, mode: 'closed' });
		this.lanes = this.lanes.filter((lane) => lane.connectionId !== connectionId);
	}

	private closeScope(scope: QuotaScope): void {
		this.scopes.set(scope, 'closed');
		this.lanes = this.lanes.filter((lane) => lane.scope !== scope);
	}

	private dropLane(dropped: Readonly<Lane>): void {
		this.lanes = this.lanes.filter((lane) => lane !== dropped);
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
 * @param platform The platform.
 * @param run The run, e.g. a tick with the budget `KICK_BUDGET_MS`.
 */
function kickOutbox(platform: Platform, run: () => Promise<unknown>): void {
	platform.waitUntil(started(run));
}

export { KICK_BUDGET_MS, createOutboxStep, kickOutbox };
export type { OutboxDeps };
