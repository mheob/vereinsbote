import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { createSubrequestBudget } from '@/platform/subrequests';
import type { SubrequestBudget } from '@/platform/subrequests';
import type { Db } from '@/server/db/client';
import {
	contactBounces,
	mailConnections,
	outboxEntries,
	processedReports,
	senders,
	systemState,
} from '@/server/db/schema';
import { resendConnection, senderOn, testEnv } from '@/server/sending/testing';

import { createGraphBouncesStep, GRAPH_BOUNCES_PER_RUN } from './graph-step';
import { setUpSentWave } from './testing';

/** A tick after the wave went out. */
const NOW = new Date('2026-11-26T10:00:00.000Z');
const BUDGET_MS = 60_000;
const SENDER = 'verein@example.org';
const SECOND_SENDER = 'zweites@example.org';
/** When the sender was made: before the wave went out. */
const SENDER_MADE_AT = new Date('2026-11-20T08:00:00.000Z');
const REPORTED_AT = '2026-11-26T09:05:00.000Z';
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const TOKEN_PATH = '/oauth2/v2.0/token';
const INBOX = /\/users\/(?<mailbox>[^/]+)\/mailFolders\/inbox\/messages/u;

/** A message of a Graph inbox, as the bounce query selects it. */
interface GraphMessage {
	readonly id: string;
	readonly receivedDateTime: string;
	readonly internetMessageHeaders: readonly Readonly<{ name: string; value: string }>[];
	readonly body: Readonly<{ content: string }>;
}

/** One inbox read: the mailbox, the filter and the limit of the query. */
interface InboxRead {
	readonly mailbox: string;
	readonly filter: string;
	readonly top: string;
}

/**
 * A bounce report of Exchange (NDR) as the step assumes it: the original Message-ID in
 * `In-Reply-To` and a DSN status line in the body. Not verified against a real tenant (4a
 * follow-up): when a real report looks otherwise, `parseNdr` and this shape change together.
 *
 * @param id The id of the report message.
 * @param originalMessageId The Message-ID of the mail that bounced.
 * @param status The DSN status: `5.x.x` is hard, `4.x.x` soft.
 * @returns The message, received at `REPORTED_AT`.
 */
function ndr(id: string, originalMessageId: string, status = '5.1.1'): GraphMessage {
	return {
		body: { content: `Delivery has failed to these recipients.\nStatus: ${status}` },
		id,
		internetMessageHeaders: [{ name: 'In-Reply-To', value: originalMessageId }],
		receivedDateTime: REPORTED_AT,
	};
}

/**
 * The address of a request.
 *
 * @param input What `fetch` got.
 * @returns The URL.
 */
function urlOf(input: Parameters<typeof fetch>[0]): string {
	if (input instanceof Request) return input.url;
	return input instanceof URL ? input.href : input;
}

/**
 * The answer of the fake Graph: a token for every app, the inbox of each mailbox, 403 for the
 * refused mailboxes.
 *
 * @param url The address.
 * @param inboxes The messages per mailbox.
 * @param refused The mailboxes Graph refuses.
 * @returns The response.
 */
function graphAnswer(
	url: string,
	inboxes: Readonly<Record<string, readonly GraphMessage[]>>,
	refused: ReadonlySet<string>,
): Response {
	if (url.includes(TOKEN_PATH)) return Response.json({ access_token: 'token-1', expires_in: 3600 });
	const mailbox = decodeURIComponent(INBOX.exec(url)?.groups?.mailbox ?? '');
	if (mailbox === '') return new Response(null, { status: HTTP_NOT_FOUND });
	if (refused.has(mailbox)) {
		return Response.json({ error: { code: 'ErrorAccessDenied' } }, { status: HTTP_FORBIDDEN });
	}
	return Response.json({ value: inboxes[mailbox] ?? [] });
}

/**
 * A `fetch` double for Graph. It records the address of every request.
 *
 * @param inboxes The messages per mailbox.
 * @param refused The mailboxes Graph refuses with 403.
 * @returns The `fetch` and the addresses it saw.
 */
function fakeGraph(
	inboxes: Readonly<Record<string, readonly GraphMessage[]>>,
	refused: readonly string[] = [],
): { fetch: typeof fetch; urls: string[] } {
	const urls: string[] = [];
	const refusedSet = new Set(refused);
	// oxlint-disable-next-line typescript/require-await -- `fetch` returns a promise; the fake answers at once
	const answer: typeof fetch = async (input) => {
		const url = urlOf(input);
		urls.push(url);
		return graphAnswer(url, inboxes, refusedSet);
	};
	return { fetch: answer, urls };
}

/**
 * Runs the step once.
 *
 * @param db The database.
 * @param fetchFn The `fetch` of the step.
 * @param options The time budget and the subrequests left.
 * @returns What the step reports.
 */
async function runStep(
	db: Db,
	fetchFn: typeof fetch,
	options: Readonly<{ budgetMs?: number; subrequests?: SubrequestBudget | null }> = {},
): Promise<{ moreWork: boolean }> {
	return createGraphBouncesStep({ fetch: fetchFn }).run({
		db,
		deadline: NOW.getTime() + (options.budgetMs ?? BUDGET_MS),
		env: testEnv(),
		now: () => NOW,
		storage: null,
		subrequests: options.subrequests ?? null,
	});
}

/**
 * One inbox read of a request.
 *
 * @param url The address of the request.
 * @returns The mailbox and the query.
 */
function inboxRead(url: string): InboxRead {
	const { searchParams } = new URL(url);
	return {
		filter: searchParams.get('$filter') ?? '',
		mailbox: decodeURIComponent(INBOX.exec(url)?.groups?.mailbox ?? ''),
		top: searchParams.get('$top') ?? '',
	};
}

/**
 * The inbox reads among some requests.
 *
 * @param urls The addresses of the requests.
 * @returns The reads, in their order.
 */
function inboxReads(urls: readonly string[]): InboxRead[] {
	return urls.filter((url) => INBOX.test(url)).map((url) => inboxRead(url));
}

/**
 * The time condition of a read's filter.
 *
 * @param read The read.
 * @returns `receivedDateTime ge …`.
 */
function startOfRead(read: InboxRead): string {
	return read.filter.split(' and ')[0] ?? '';
}

/**
 * The status of an entry.
 *
 * @param db The database.
 * @param entryId The entry.
 * @returns The status.
 */
async function statusOf(db: Db, entryId: string): Promise<string | undefined> {
	const [row] = await db
		.select({ status: outboxEntries.status })
		.from(outboxEntries)
		.where(eq(outboxEntries.id, entryId));
	return row?.status;
}

/**
 * The reports the step has processed, by id.
 *
 * @param db The database.
 * @returns Their ids.
 */
async function processedIds(db: Db): Promise<string[]> {
	const rows = await db
		.select({ id: processedReports.reportId })
		.from(processedReports)
		.orderBy(processedReports.reportId);
	return rows.map(({ id }) => id);
}

/**
 * Whether a request is a token request or an inbox read; nothing else may be made.
 *
 * @param url The address.
 * @returns True for a read.
 */
function onlyReads(url: string): boolean {
	return url.includes(TOKEN_PATH) || INBOX.test(url);
}

describe(createGraphBouncesStep, () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('processes a graph report once', async () => {
		const wave = await setUpSentWave();
		const { db } = wave.club;
		const hard = ndr('ndr-1', wave.family.messageId);
		const soft = ndr('ndr-2', wave.single.messageId, '4.4.7');
		const graph = fakeGraph({ [SENDER]: [hard, soft] });

		await expect(runStep(db, graph.fetch)).resolves.toStrictEqual({ moreWork: false });
		const after = {
			family: await statusOf(db, wave.family.id),
			marks: await db.$count(contactBounces),
			single: await statusOf(db, wave.single.id),
		};
		expect(after).toStrictEqual({ family: 'bounced', marks: 2, single: 'sent' });

		// The markings are cleared; Graph lists the same reports again (the boundary second of the
		// query): they were processed and mark nobody a second time.
		await db.delete(contactBounces);
		await runStep(db, graph.fetch);
		await expect(db.$count(contactBounces)).resolves.toBe(0);
		await expect(processedIds(db)).resolves.toStrictEqual(['ndr-1', 'ndr-2']);
	});

	it('reads only the mailbox of each Graph sender, from its last check, at most 50 reports', async () => {
		const wave = await setUpSentWave();
		const { admin, connectionId, db } = wave.club;
		await senderOn(db, admin, connectionId, SECOND_SENDER);
		await senderOn(db, admin, await resendConnection(db, admin), 'resend@example.org');
		await db.update(senders).set({ createdAt: SENDER_MADE_AT });
		const graph = fakeGraph({ [SENDER]: [ndr('ndr-1', wave.family.messageId)] });

		await runStep(db, graph.fetch);
		await runStep(db, graph.fetch);

		const reads = inboxReads(graph.urls);
		expect(reads.map(({ mailbox }) => mailbox).toSorted()).toStrictEqual([
			SENDER,
			SENDER,
			SECOND_SENDER,
			SECOND_SENDER,
		]);
		// First from the time the sender was made, then from the last report seen; 50 at most.
		const ofSender = reads.filter(({ mailbox }) => mailbox === SENDER);
		expect(ofSender.map((read) => [startOfRead(read), read.top])).toStrictEqual([
			[`receivedDateTime ge ${SENDER_MADE_AT.toISOString()}`, String(GRAPH_BOUNCES_PER_RUN)],
			[`receivedDateTime ge ${REPORTED_AT}`, String(GRAPH_BOUNCES_PER_RUN)],
		]);
		// Nothing but tokens and inbox reads: the step changes nothing in the mailboxes.
		expect(graph.urls.every((url) => onlyReads(url))).toBe(true);
		await expect(
			db
				.select({ value: systemState.value })
				.from(systemState)
				.where(eq(systemState.key, `graph_bounces_since:${wave.club.senderId}`)),
		).resolves.toStrictEqual([{ value: { since: REPORTED_AT } }]);
	});

	it('skips a sender whose connection is disturbed or whose secret does not decrypt', async () => {
		const wave = await setUpSentWave();
		const { connectionId, db } = wave.club;
		const errors = vi.spyOn(console, 'error').mockReturnValue();
		const report = ndr('ndr-1', wave.family.messageId);

		await db
			.update(mailConnections)
			.set({ disturbedCode: 'graph.unauthorized', disturbedSince: NOW })
			.where(eq(mailConnections.id, connectionId));
		const disturbed = fakeGraph({ [SENDER]: [report] });
		await runStep(db, disturbed.fetch);
		await db
			.update(mailConnections)
			.set({ disturbedCode: null, disturbedSince: null, secretCiphertext: 'v2.AAAA.AAAA' })
			.where(eq(mailConnections.id, connectionId));
		const undecryptable = fakeGraph({ [SENDER]: [report] });
		await runStep(db, undecryptable.fetch);

		expect([...disturbed.urls, ...undecryptable.urls]).toStrictEqual([]);
		await expect(statusOf(db, wave.family.id)).resolves.toBe('sent');
		// Logged by code, never with an address.
		expect(errors.mock.calls).toStrictEqual([
			['graph bounces skipped', 'connection.disturbed'],
			['graph bounces skipped', 'SecretDecryptError'],
		]);
	});

	it('goes on with the next sender when Graph refuses a mailbox', async () => {
		const wave = await setUpSentWave();
		const { admin, connectionId, db } = wave.club;
		await senderOn(db, admin, connectionId, SECOND_SENDER);
		const errors = vi.spyOn(console, 'error').mockReturnValue();
		const graph = fakeGraph({ [SECOND_SENDER]: [ndr('ndr-1', wave.family.messageId)] }, [SENDER]);

		await runStep(db, graph.fetch);

		await expect(statusOf(db, wave.family.id)).resolves.toBe('bounced');
		expect(errors.mock.calls).toStrictEqual([['graph bounces skipped', 'graph.mailbox']]);
	});

	it('stops at the deadline and within the subrequests left', async () => {
		const wave = await setUpSentWave();
		const { db } = wave.club;
		const inbox = { [SENDER]: [ndr('ndr-1', wave.family.messageId)] };
		const late = fakeGraph(inbox);
		// A sender needs two requests (token and inbox); one is left.
		const spent = fakeGraph(inbox);
		const budget = createSubrequestBudget(1);
		const counted = fakeGraph(inbox);
		const enough = createSubrequestBudget(10);

		const outcomes = [
			await runStep(db, late.fetch, { budgetMs: -1 }),
			await runStep(db, spent.fetch, { subrequests: budget }),
		];
		await runStep(db, counted.fetch, { subrequests: enough });

		expect(outcomes).toStrictEqual([{ moreWork: true }, { moreWork: false }]);
		expect([...late.urls, ...spent.urls]).toStrictEqual([]);
		expect({ enough: enough.left(), spent: budget.left() }).toStrictEqual({
			enough: 10 - counted.urls.length,
			spent: 1,
		});
		await expect(statusOf(db, wave.family.id)).resolves.toBe('bounced');
	});

	it('keeps a report it could not record for the next check', async () => {
		const wave = await setUpSentWave();
		const { db } = wave.club;
		await db.update(senders).set({ createdAt: SENDER_MADE_AT });
		const graph = fakeGraph({ [SENDER]: [ndr('ndr-1', wave.family.messageId)] });
		// The marks cannot be written: recording the hard bounce fails.
		await db.execute(sql`alter table contact_bounces rename to contact_bounces_away`);

		await expect(runStep(db, graph.fetch)).rejects.toBeInstanceOf(AggregateError);
		await expect(processedIds(db)).resolves.toStrictEqual([]);

		await db.execute(sql`alter table contact_bounces_away rename to contact_bounces`);
		await runStep(db, graph.fetch);
		await expect(statusOf(db, wave.family.id)).resolves.toBe('bounced');
		// The second check starts at the report the first one stopped at.
		expect(inboxReads(graph.urls).map((read) => startOfRead(read))).toStrictEqual([
			`receivedDateTime ge ${SENDER_MADE_AT.toISOString()}`,
			`receivedDateTime ge ${REPORTED_AT}`,
		]);
	});

	it('asks for another run when a sender has a full page of reports', async () => {
		const wave = await setUpSentWave();
		const reports = Array.from({ length: GRAPH_BOUNCES_PER_RUN }, (_, index) =>
			ndr(`ndr-${index}`, `<unbekannt-${index}@example.org>`),
		);
		const graph = fakeGraph({ [SENDER]: reports });
		await expect(runStep(wave.club.db, graph.fetch)).resolves.toStrictEqual({ moreWork: true });
		await expect(processedIds(wave.club.db)).resolves.toHaveLength(GRAPH_BOUNCES_PER_RUN);
	});
});
