/*
 * The sending overview (Design 16): per area its waves with their state and the number of entries
 * in each status, per wave its entries with the recipient's base fields, status and code, and the
 * bounce marks of the area; and the number of marks the navigation shows. Nothing of a mail's
 * content leaves here. Reading needs `read` in the area; the admin role alone gives nothing. A code
 * that tells about a protected field (a reached exit date) reaches only users who see that field
 * (ruling R10).
 */
import { asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

import { listAreas } from '@/server/areas/areas';
import { bounceOfContact } from '@/server/bounces/bounces';
import { assertCanList, loadContactAccess } from '@/server/contacts/access';
import { displayName } from '@/server/contacts/display-name';
import type { ContactKind } from '@/server/contacts/fields';
import { CONTACTS_PAGE_SIZE } from '@/server/contacts/list-query';
import type { Db } from '@/server/db/client';
import {
	areas,
	contactBounces,
	contacts,
	contactSettings,
	occasions,
	outboxEntries,
	waveContacts,
	waves,
} from '@/server/db/schema';
import { levelAtLeast } from '@/server/permissions/levels';
import { assertArea, canAccessArea } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import type { EntryStatus } from '@/server/sending/outbox';

import { WaveNotFoundError } from './errors';
import { exitDateSight, shownReason } from './shown-reasons';
import type { ExitDateSight } from './shown-reasons';

/** Where a wave stands (Design 16): planned, running, done or stopped. */
type WaveState = 'done' | 'planned' | 'running' | 'stopped';

/** A wave of an area as the overview lists it. */
interface WaveRow {
	readonly id: string;
	readonly occasionName: string;
	/** When the wave starts: its planned time, or when it was confirmed for one sent at once. */
	readonly notBefore: Date;
	readonly state: WaveState;
	/** The number of its entries in each status. */
	readonly counts: Readonly<Record<EntryStatus, number>>;
}

/** A wave with its area, for the page of the wave. */
interface WaveDetail extends WaveRow {
	readonly areaId: string;
	readonly areaName: string;
	readonly occasionId: string;
	/** Whether the user may stop the wave and send its uncertain entries again: `send`. */
	readonly canSend: boolean;
}

/** An entry of a wave as the overview lists it: who it went to, never what. */
interface EntryRow {
	readonly id: string;
	/**
	 * The contact whose name the row shows: the first contact of the entry that still exists; null
	 * when none does.
	 */
	readonly contactId: string | null;
	/** Its display name (base fields); null when no contact of the entry exists any more. */
	readonly recipientName: string | null;
	/** The address the mail went to, else the address of the entry at the confirmation. */
	readonly recipientEmail: string;
	readonly status: EntryStatus;
	/** The code of a skip, a failure or a bounce, as the user may see it; null without one. */
	readonly code: string | null;
	/** The number of contacts of the entry: more than one for a circular to a shared address. */
	readonly merged: number;
}

/** A contact whose current address is marked invalid (Design 13). */
interface BounceRow {
	readonly contactId: string;
	readonly name: string;
	readonly email: string;
	/** When the mark was made. */
	readonly at: Date;
}

/** One page of a list and the number of items of all pages. */
interface OverviewPage<Item> {
	readonly items: readonly Item[];
	readonly total: number;
}

/** An area the user may read, with the actions the overview offers there. */
interface OverviewArea {
	readonly id: string;
	readonly name: string;
	/** `edit`: clearing a bounce mark. */
	readonly canEdit: boolean;
	/** `send`: stopping a wave and sending an uncertain entry again. */
	readonly canSend: boolean;
}

/** The overview of one area: a page of its waves and its bounce marks. */
interface AreaOverview {
	readonly areaId: string;
	readonly page: number;
	readonly waves: OverviewPage<WaveRow>;
	readonly bounces: readonly BounceRow[];
}

/** The page of a wave: the wave and a page of its entries. */
interface WavePage {
	readonly wave: WaveDetail;
	readonly page: number;
	readonly entries: OverviewPage<EntryRow>;
}

/** What the entries of a wave tell about its state. */
interface WaveTally {
	readonly counts: Readonly<Record<EntryStatus, number>>;
	/** Whether a run has taken one of its entries (it then has a Message-ID, which stays). */
	readonly taken: boolean;
}

/** The order of the entries: the ones that need a look first, then by address. */
const STATUS_ORDER = sql`case ${outboxEntries.status} when 'uncertain' then 0 when 'failed' then 1 when 'bounced' then 2 when 'skipped' then 3 when 'cancelled' then 4 when 'sending' then 5 when 'planned' then 6 else 7 end`;

/** The address of an entry's first contact at the confirmation. */
const FIRST_ADDRESS = sql<string>`(select ${waveContacts.email} from ${waveContacts} where ${waveContacts.entryId} = ${outboxEntries.id} order by ${waveContacts.position} limit 1)`;

/**
 * The area of a bounce mark, whose readers see it and whose editors clear it (`readMark` in
 * `bounces.ts`): the area of the wave it came from, else the area of the contact's kind. Needs the
 * mark joined to its entry and that entry's wave.
 */
const MARK_AREA = sql<
	string | null
>`coalesce(${waves.areaId}, (select case when ${contactBounces.kind} = 'member' then ${contactSettings.membersAreaId} else ${contactSettings.partnersAreaId} end from ${contactSettings} limit 1))`;

/**
 * No entry in any status.
 *
 * @returns A zero per status.
 */
function noEntries(): Record<EntryStatus, number> {
	return {
		bounced: 0,
		cancelled: 0,
		failed: 0,
		planned: 0,
		sending: 0,
		sent: 0,
		skipped: 0,
		uncertain: 0,
	};
}

/**
 * The state of a wave (Design 16, ruling R17). A stopped wave is `stopped`, whatever its entries;
 * one whose start lies ahead and of which no run has taken an entry yet is `planned`; one with an
 * entry `planned` or `sending` is `running` (also when its start has passed and no run came yet);
 * anything else is `done`: every entry has a final status (an `uncertain` one waits for a person,
 * not for the outbox).
 *
 * @param wave Its entries per status, whether a run took one of them, whether it was stopped, its
 *   start and the instant to judge it at.
 * @param wave.counts The entries per status.
 * @param wave.taken Whether a run took one of them.
 * @param wave.stopped Whether the wave was stopped.
 * @param wave.notBefore When the wave starts.
 * @param wave.now The instant of the request.
 * @returns The state.
 */
function waveState(
	wave: Readonly<{
		counts: Readonly<Record<EntryStatus, number>>;
		taken: boolean;
		stopped: boolean;
		notBefore: Date;
		now: Date;
	}>,
): WaveState {
	const { counts, notBefore, now, stopped, taken } = wave;
	if (stopped) return 'stopped';
	if (!taken && notBefore.getTime() > now.getTime()) return 'planned';
	return counts.planned + counts.sending > 0 ? 'running' : 'done';
}

/**
 * Requires a page number from 1.
 *
 * @param page The page.
 * @throws {Error} When it is no whole number from 1.
 */
function assertPage(page: number): void {
	if (!Number.isInteger(page) || page < 1) throw new Error('The page is a whole number from 1.');
}

/**
 * The entries of some waves per status, and whether a run took one of them.
 *
 * @param db The database.
 * @param waveIds The waves.
 * @returns The tally per wave; a wave without entries is missing.
 */
async function entryTallies(
	db: Db,
	waveIds: readonly string[],
): Promise<ReadonlyMap<string, WaveTally>> {
	if (waveIds.length === 0) return new Map();
	const rows = await db
		.select({
			entries: count(),
			status: outboxEntries.status,
			taken: count(outboxEntries.messageId),
			waveId: outboxEntries.waveId,
		})
		.from(outboxEntries)
		.where(inArray(outboxEntries.waveId, [...waveIds]))
		.groupBy(outboxEntries.waveId, outboxEntries.status);
	const tallies = new Map<string, { counts: Record<EntryStatus, number>; taken: boolean }>();
	for (const { entries, status, taken, waveId } of rows) {
		// The condition keeps out entries without a wave; `?? ''` only satisfies the type.
		const key = waveId ?? '';
		const tally = tallies.get(key) ?? { counts: noEntries(), taken: false };
		tally.counts[status] = entries;
		tally.taken ||= taken > 0;
		tallies.set(key, tally);
	}
	return tallies;
}

/**
 * A wave as the overview lists it.
 *
 * @param wave Its row with the occasion's name.
 * @param tally Its entries; undefined for a wave without entries.
 * @param now The instant of the request, which the state is judged at.
 * @returns The listed wave.
 */
function waveRowOf(
	wave: Readonly<{
		id: string;
		occasionName: string;
		notBefore: Date | null;
		createdAt: Date;
		stoppedAt: Date | null;
	}>,
	tally: Readonly<WaveTally> | undefined,
	now: Date,
): WaveRow {
	const counts = tally?.counts ?? noEntries();
	const notBefore = wave.notBefore ?? wave.createdAt;
	const stopped = wave.stoppedAt !== null;
	return {
		counts,
		id: wave.id,
		notBefore,
		occasionName: wave.occasionName,
		state: waveState({ counts, notBefore, now, stopped, taken: tally?.taken ?? false }),
	};
}

/** The columns of a wave the overview reads. */
const WAVE_COLUMNS = {
	createdAt: waves.createdAt,
	id: waves.id,
	notBefore: waves.notBefore,
	occasionName: occasions.name,
	stoppedAt: waves.stoppedAt,
};

/**
 * Lists one page of the waves of an area, newest first, with their state and counts.
 *
 * @param db The database.
 * @param actor Who asks; needs `read` in the area.
 * @param areaId The area.
 * @param page The page, from 1.
 * @param now The instant of the request, which the states are judged at.
 * @returns The waves of the page and the number of all.
 * @throws {ForbiddenError} Without `read` in the area.
 * @throws {Error} When the page is no whole number from 1.
 */
// oxlint-disable-next-line max-params -- the plan's interface and the instant of the state
async function listWaves(
	db: Db,
	actor: Principal,
	areaId: string,
	page: number,
	now: Date,
): Promise<OverviewPage<WaveRow>> {
	assertArea(actor, areaId, 'read');
	assertPage(page);
	const where = eq(waves.areaId, areaId);
	const [counted] = await db.select({ total: count() }).from(waves).where(where);
	const rows = await db
		.select(WAVE_COLUMNS)
		.from(waves)
		.innerJoin(occasions, eq(occasions.id, waves.occasionId))
		.where(where)
		.orderBy(desc(waves.createdAt), desc(waves.id))
		.limit(CONTACTS_PAGE_SIZE)
		.offset((page - 1) * CONTACTS_PAGE_SIZE);
	const tallies = await entryTallies(
		db,
		rows.map(({ id }) => id),
	);
	return {
		items: rows.map((row) => waveRowOf(row, tallies.get(row.id), now)),
		total: counted?.total ?? 0,
	};
}

/**
 * Loads a wave with its area, for its page.
 *
 * @param db The database.
 * @param actor Who asks; needs `read` in the wave's area.
 * @param waveId The wave.
 * @param now The instant of the request, which the state is judged at.
 * @returns The wave.
 * @throws {WaveNotFoundError} When no wave has the id.
 * @throws {ForbiddenError} Without `read` in the wave's area.
 */
// oxlint-disable-next-line max-params -- the database, the user, the wave and the instant
async function loadWave(db: Db, actor: Principal, waveId: string, now: Date): Promise<WaveDetail> {
	const [row] = await db
		.select({
			...WAVE_COLUMNS,
			areaId: waves.areaId,
			areaName: areas.name,
			occasionId: waves.occasionId,
		})
		.from(waves)
		.innerJoin(occasions, eq(occasions.id, waves.occasionId))
		.innerJoin(areas, eq(areas.id, waves.areaId))
		.where(eq(waves.id, waveId));
	if (row === undefined) throw new WaveNotFoundError();
	assertArea(actor, row.areaId, 'read');
	const tallies = await entryTallies(db, [waveId]);
	return {
		...waveRowOf(row, tallies.get(waveId), now),
		areaId: row.areaId,
		areaName: row.areaName,
		canSend: canAccessArea(actor, row.areaId, 'send'),
		occasionId: row.occasionId,
	};
}

/** A contact of an entry as the confirmation recorded it. */
interface RecordedContact {
	readonly entryId: string;
	readonly contactId: string | null;
	readonly kind: ContactKind;
	readonly email: string;
}

/**
 * The contacts of some entries as the confirmation recorded them, per entry in their order.
 *
 * @param db The database.
 * @param entryIds The entries.
 * @returns The contacts per entry.
 */
async function recordedContacts(
	db: Db,
	entryIds: readonly string[],
): Promise<ReadonlyMap<string, readonly RecordedContact[]>> {
	if (entryIds.length === 0) return new Map();
	const rows = await db
		.select({
			contactId: waveContacts.contactId,
			email: waveContacts.email,
			entryId: waveContacts.entryId,
			kind: waveContacts.kind,
		})
		.from(waveContacts)
		.where(inArray(waveContacts.entryId, [...entryIds]))
		.orderBy(asc(waveContacts.entryId), asc(waveContacts.position));
	const byEntry = new Map<string, RecordedContact[]>();
	for (const row of rows) byEntry.set(row.entryId, [...(byEntry.get(row.entryId) ?? []), row]);
	return byEntry;
}

/**
 * The display names of the contacts that still exist, from their base fields only.
 *
 * @param db The database.
 * @param contactIds The contacts.
 * @returns The names by id; a deleted contact is missing.
 */
async function contactNames(
	db: Db,
	contactIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
	if (contactIds.length === 0) return new Map();
	const rows = await db
		.select({
			customerNumber: contacts.customerNumber,
			email: contacts.email,
			firstName: contacts.firstName,
			id: contacts.id,
			lastName: contacts.lastName,
			memberNumber: contacts.memberNumber,
			organization: contacts.organization,
		})
		.from(contacts)
		.where(inArray(contacts.id, [...contactIds]));
	return new Map(rows.map((row) => [row.id, displayName(row).primary]));
}

/**
 * The code of an entry as the user may see it (ruling R10): a skip for a reached exit date tells
 * about a protected field, so a user who does not see the exit date of the contact's kind gets
 * `unavailable`. The skip code of an entry is the reason of its first contact (`pickRecipients`).
 *
 * @param code The stored code.
 * @param kind The kind of the entry's first contact; undefined when it has none.
 * @param sight Whether the user sees the exit date, per kind.
 * @returns The code to show.
 */
function shownCode(
	code: string | null,
	kind: ContactKind | undefined,
	sight: ExitDateSight,
): string | null {
	if (code === null) return null;
	if (kind === undefined) return code === 'exited' ? 'unavailable' : code;
	return shownReason(code, kind, sight);
}

/**
 * The rows of some entries: each names the first of its contacts that still exists, by the base
 * fields of the contact as it is now.
 *
 * @param db The database.
 * @param entries The entries: their id, address, status and code.
 * @param sight Whether the user sees the exit date, per kind.
 * @returns The rows, in the order of the entries.
 */
async function entryRowsOf(
	db: Db,
	entries: readonly Readonly<{
		id: string;
		code: string | null;
		recipient: string | null;
		status: EntryStatus;
	}>[],
	sight: ExitDateSight,
): Promise<EntryRow[]> {
	const recorded = await recordedContacts(
		db,
		entries.map(({ id }) => id),
	);
	const contactIds = [...recorded.values()].flatMap((list) =>
		list.flatMap(({ contactId }) => (contactId === null ? [] : [contactId])),
	);
	const names = await contactNames(db, contactIds);
	return entries.map((entry): EntryRow => {
		const entryContacts = recorded.get(entry.id) ?? [];
		const shown = entryContacts.find(({ contactId }) => contactId !== null && names.has(contactId));
		const contactId = shown?.contactId ?? null;
		return {
			code: shownCode(entry.code, entryContacts[0]?.kind, sight),
			contactId,
			id: entry.id,
			merged: entryContacts.length,
			recipientEmail: entry.recipient ?? entryContacts[0]?.email ?? '',
			recipientName: contactId === null ? null : (names.get(contactId) ?? null),
			status: entry.status,
		};
	});
}

/**
 * Lists one page of the entries of a wave: the ones that need a look first (uncertain, failed,
 * bounced, skipped), then by address. A row names the recipient by the base fields of the first
 * contact of the entry that still exists and gives the address, the status and the code; nothing
 * of the mail.
 *
 * @param db The database.
 * @param actor Who asks; needs `read` in the wave's area.
 * @param waveId The wave.
 * @param page The page, from 1.
 * @returns The entries of the page and the number of all.
 * @throws {WaveNotFoundError} When no wave has the id.
 * @throws {ForbiddenError} Without `read` in the wave's area.
 * @throws {Error} When the page is no whole number from 1.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function listEntries(
	db: Db,
	actor: Principal,
	waveId: string,
	page: number,
): Promise<OverviewPage<EntryRow>> {
	const [wave] = await db.select({ areaId: waves.areaId }).from(waves).where(eq(waves.id, waveId));
	if (wave === undefined) throw new WaveNotFoundError();
	assertArea(actor, wave.areaId, 'read');
	assertPage(page);
	// Not inside a transaction: the access loads its parts in parallel.
	const access = await loadContactAccess(db, actor);
	assertCanList(access);
	const where = eq(outboxEntries.waveId, waveId);
	const [counted] = await db.select({ total: count() }).from(outboxEntries).where(where);
	const rows = await db
		.select({
			code: outboxEntries.lastErrorCode,
			id: outboxEntries.id,
			recipient: outboxEntries.recipient,
			status: outboxEntries.status,
		})
		.from(outboxEntries)
		.where(where)
		.orderBy(
			STATUS_ORDER,
			sql`coalesce(${outboxEntries.recipient}, ${FIRST_ADDRESS})`,
			outboxEntries.id,
		)
		.limit(CONTACTS_PAGE_SIZE)
		.offset((page - 1) * CONTACTS_PAGE_SIZE);
	return {
		items: await entryRowsOf(db, rows, exitDateSight(access)),
		total: counted?.total ?? 0,
	};
}

/**
 * The marks of an area (`MARK_AREA`) whose address is still the contact's current one, with the
 * contact's base fields, the newest first.
 *
 * @param db The database.
 * @param actor Who asks; needs `read` in the area.
 * @param areaId The area.
 * @returns The marked contacts.
 * @throws {ForbiddenError} Without `read` in the area.
 */
async function listBounces(db: Db, actor: Principal, areaId: string): Promise<BounceRow[]> {
	assertArea(actor, areaId, 'read');
	// Not inside a transaction: the access loads its parts in parallel.
	assertCanList(await loadContactAccess(db, actor));
	const rows = await db
		.select({
			at: contactBounces.createdAt,
			customerNumber: contacts.customerNumber,
			email: contacts.email,
			firstName: contacts.firstName,
			id: contacts.id,
			lastName: contacts.lastName,
			memberNumber: contacts.memberNumber,
			organization: contacts.organization,
		})
		.from(contactBounces)
		.innerJoin(contacts, bounceOfContact)
		.leftJoin(outboxEntries, eq(outboxEntries.id, contactBounces.entryId))
		.leftJoin(waves, eq(waves.id, outboxEntries.waveId))
		.where(eq(MARK_AREA, areaId))
		.orderBy(
			desc(contactBounces.createdAt),
			sql`lower(coalesce(${contacts.organization}, ${contacts.lastName}, ${contacts.firstName}, ${contacts.email}, ${contacts.memberNumber}, ${contacts.customerNumber}))`,
			contacts.id,
		);
	return rows.map((row) => ({
		at: row.at,
		contactId: row.id,
		email: row.email ?? '',
		name: displayName(row).primary,
	}));
}

/**
 * The number of bounce marks the user sees in the overview, over every area the user reads: what
 * the navigation shows at „Versand“. One query; none without an area.
 *
 * @param db The database.
 * @param principal Who asks.
 * @returns The number of marked contacts.
 */
async function bounceCount(db: Db, principal: Principal): Promise<number> {
	const readable = [...principal.areas]
		.filter(([, level]) => levelAtLeast(level, 'read'))
		.map(([areaId]) => areaId);
	if (readable.length === 0) return 0;
	const [row] = await db
		.select({ total: count() })
		.from(contactBounces)
		.innerJoin(contacts, bounceOfContact)
		.leftJoin(outboxEntries, eq(outboxEntries.id, contactBounces.entryId))
		.leftJoin(waves, eq(waves.id, outboxEntries.waveId))
		.where(inArray(MARK_AREA, readable));
	return row?.total ?? 0;
}

/**
 * The areas whose overview the user may see, with the actions it offers there.
 *
 * @param db The database.
 * @param actor Who asks.
 * @returns The areas the user reads, by name.
 */
async function overviewAreas(db: Db, actor: Principal): Promise<OverviewArea[]> {
	const listed = await listAreas(db, actor);
	return listed.flatMap(({ id, level, name }) =>
		levelAtLeast(level, 'read')
			? [{ canEdit: levelAtLeast(level, 'edit'), canSend: levelAtLeast(level, 'send'), id, name }]
			: [],
	);
}

/**
 * The overview of an area: a page of its waves and its bounce marks.
 *
 * @param db The database.
 * @param actor Who asks; needs `read` in the area.
 * @param areaId The area.
 * @param page The page of the waves, from 1.
 * @param now The instant of the request, which the states are judged at.
 * @returns The overview.
 * @throws {ForbiddenError} Without `read` in the area.
 */
// oxlint-disable-next-line max-params -- the database, the user, the area, the page and the instant
async function areaOverview(
	db: Db,
	actor: Principal,
	areaId: string,
	page: number,
	now: Date,
): Promise<AreaOverview> {
	return {
		areaId,
		bounces: await listBounces(db, actor, areaId),
		page,
		waves: await listWaves(db, actor, areaId, page, now),
	};
}

/**
 * The page of a wave: the wave and a page of its entries.
 *
 * @param db The database.
 * @param actor Who asks; needs `read` in the wave's area.
 * @param waveId The wave.
 * @param page The page of the entries, from 1.
 * @param now The instant of the request, which the state is judged at.
 * @returns The page.
 * @throws {WaveNotFoundError} When no wave has the id.
 * @throws {ForbiddenError} Without `read` in the wave's area.
 */
// oxlint-disable-next-line max-params -- the database, the user, the wave, the page and the instant
async function wavePage(
	db: Db,
	actor: Principal,
	waveId: string,
	page: number,
	now: Date,
): Promise<WavePage> {
	const wave = await loadWave(db, actor, waveId, now);
	return { entries: await listEntries(db, actor, waveId, page), page, wave };
}

export {
	areaOverview,
	bounceCount,
	listBounces,
	listEntries,
	listWaves,
	loadWave,
	overviewAreas,
	wavePage,
	waveState,
};
export type {
	AreaOverview,
	BounceRow,
	EntryRow,
	OverviewArea,
	OverviewPage,
	WaveDetail,
	WavePage,
	WaveRow,
	WaveState,
};
