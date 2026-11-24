/*
 * The member import: the export of the member administration replaces the whole stock of
 * members. Rows whose exit date is reached are deleted like missing ones; a confirm that would
 * delete more than 20 % of the stock needs the count of deletions confirmed.
 */
import { eq } from 'drizzle-orm';

import { todayInClubZone } from '@/server/contacts/calendar';
import type { FieldKey } from '@/server/contacts/fields';
import { getImportState } from '@/server/contacts/import-state';
import type { Db } from '@/server/db/client';
import { contacts } from '@/server/db/schema';
import type { Principal } from '@/server/permissions/principal';

import type { ImportPayload } from './payload';
import {
	authorizeImport,
	changedFields,
	confirmImport,
	deleteContacts,
	firstOf,
	insertContacts,
	MAX_LISTED_CHANGES,
	MAX_LISTED_ISSUES,
	NUMBER_ORDER,
	readImportRows,
	replacedValues,
	storedValues,
	toImportChange,
	updateContacts,
} from './plan';
import type {
	ChangedField,
	ConfirmImportResult,
	ContactValues,
	ImportChange,
	StoredContact,
	WithFieldIds,
	WrittenCounts,
} from './plan';
import type { BlockingIssue, FieldIssue, ImportedRow } from './rows';

/** A confirm that deletes more than this share of the stock must name the deletions. */
const SAFETY_THRESHOLD = 0.2;

/** What a member import does, in numbers. */
interface MemberImportCounts {
	created: number;
	changed: number;
	unchanged: number;
	/** Deleted: missing from the file or exited. */
	removed: number;
	/** Of `removed`, those whose exit date is reached; null without the right to see it. */
	removedExited: number | null;
	/** Imported members without an address. */
	withoutEmail: number;
	/** Imported members with an exit date after today; null without the right to see it. */
	futureExit: number | null;
}

/** What the preview of a member import shows. */
interface MemberImportPreview {
	/** The stock version the confirm must still find. */
	stockVersion: number;
	counts: MemberImportCounts;
	/** Removed first, then changed, then created; at most `MAX_LISTED_CHANGES`. */
	changes: ImportChange[];
	moreChanges: number;
	/** At most `MAX_LISTED_ISSUES`. */
	fieldIssues: FieldIssue[];
	moreIssues: number;
	blocking: BlockingIssue[];
	confirmation: { required: boolean; deletions: number };
}

/** A stored member the file changes. */
interface ChangedMember {
	readonly stored: StoredContact;
	readonly values: ContactValues;
	readonly fields: readonly ChangedField[];
}

/** A stored member the import deletes. */
interface RemovedMember {
	readonly stored: StoredContact;
	/** The file lists the member with a reached exit date. */
	readonly exited: boolean;
}

/** The comparison of the file with the stock. */
interface MemberPlan {
	/** The number of stored members. */
	readonly stock: number;
	readonly created: readonly ContactValues[];
	readonly changed: readonly ChangedMember[];
	readonly unchanged: number;
	/** By member number. */
	readonly removed: readonly RemovedMember[];
	readonly withoutEmail: number;
	readonly futureExit: number;
}

/** A row the import takes over. */
interface TakenRow {
	readonly row: ImportedRow;
	readonly values: ContactValues;
	readonly memberNumber: string;
}

/** The plan of a file that is not compared with the stock, because it has blocking issues. */
const NO_PLAN: MemberPlan = {
	changed: [],
	created: [],
	futureExit: 0,
	removed: [],
	stock: 0,
	unchanged: 0,
	withoutEmail: 0,
};

/**
 * Tells whether a confirm must name its deletions: more than 20 % of the stock would go. Never
 * for an empty stock, so the first import needs no confirmation.
 *
 * @param stock The number of stored members.
 * @param deletions The number of members the import deletes.
 * @returns True when the deletions must be confirmed.
 */
function needsSafetyConfirmation(stock: number, deletions: number): boolean {
	return stock > 0 && deletions > stock * SAFETY_THRESHOLD;
}

/**
 * Splits the rows into those the import takes over and the numbers of those whose exit date is
 * reached (they are deleted like missing rows).
 *
 * @param rows The rows, free of blocking issues.
 * @param today Today in the club's time zone.
 * @returns The taken rows and the exited numbers.
 * @throws {Error} For a row without member number, which the blocking check excludes.
 */
function splitExited(
	rows: readonly ImportedRow[],
	today: string,
): { taken: TakenRow[]; exited: Set<string> } {
	const taken: TakenRow[] = [];
	const exited = new Set<string>();
	for (const row of rows) {
		const values = replacedValues('member', row);
		const { exitDate, memberNumber } = values;
		// Never skip such a row: a skipped row would delete a stored member.
		if (memberNumber === null) throw new Error('A row without member number reached the plan.');
		if (exitDate !== null && exitDate <= today) exited.add(memberNumber);
		else taken.push({ memberNumber, row, values });
	}
	return { exited, taken };
}

/**
 * Sorts the taken rows into new and changed members by member number.
 *
 * @param taken The rows the import takes over.
 * @param stored The stored members.
 * @returns The new and the changed members; the rest is unchanged.
 */
function compareWithStock(
	taken: readonly TakenRow[],
	stored: readonly StoredContact[],
): { created: ContactValues[]; changed: ChangedMember[] } {
	const byNumber = new Map(stored.map((record) => [record.memberNumber, record]));
	const created: ContactValues[] = [];
	const changed: ChangedMember[] = [];
	for (const { memberNumber, row, values } of taken) {
		const record = byNumber.get(memberNumber);
		const fields = record === undefined ? [] : changedFields(record, row, 'replace');
		if (record === undefined) created.push(values);
		else if (fields.length > 0) changed.push({ fields, stored: record, values });
	}
	return { changed, created };
}

/**
 * The stored members no taken row names, by member number.
 *
 * @param stored The stored members.
 * @param taken The rows the import takes over.
 * @param exited The numbers of the rows whose exit date is reached.
 * @returns The members to delete.
 */
function removedMembers(
	stored: readonly StoredContact[],
	taken: readonly TakenRow[],
	exited: ReadonlySet<string>,
): RemovedMember[] {
	const takenNumbers = new Set(taken.map(({ memberNumber }) => memberNumber));
	return stored
		.filter((record) => !takenNumbers.has(record.memberNumber ?? ''))
		.toSorted((a, b) => NUMBER_ORDER.compare(a.memberNumber ?? '', b.memberNumber ?? ''))
		.map((record) => ({ exited: exited.has(record.memberNumber ?? ''), stored: record }));
}

/**
 * Compares the rows with the stored members by member number.
 *
 * @param db The database or a transaction.
 * @param rows The rows, free of blocking issues.
 * @param today Today in the club's time zone.
 * @returns The plan.
 */
async function planMembers(
	db: Db,
	rows: readonly ImportedRow[],
	today: string,
): Promise<MemberPlan> {
	const stored = await db.select().from(contacts).where(eq(contacts.kind, 'member'));
	const { exited, taken } = splitExited(rows, today);
	const { changed, created } = compareWithStock(taken, stored);
	return {
		changed,
		created,
		futureExit: taken.filter(({ values }) => values.exitDate !== null).length,
		removed: removedMembers(stored, taken, exited),
		stock: stored.length,
		unchanged: taken.length - created.length - changed.length,
		withoutEmail: taken.filter(({ values }) => values.email === null).length,
	};
}

/**
 * The counts and changes of a plan as one user may see them.
 *
 * @param plan The plan.
 * @param visible The member fields the user sees.
 * @returns The counts and the full change list.
 */
function describePlan(
	plan: MemberPlan,
	visible: ReadonlySet<FieldKey>,
): { counts: MemberImportCounts; changes: ImportChange[] } {
	const canSeeExit = visible.has('exitDate');
	const changes = [
		...plan.removed.map(({ exited, stored }) =>
			toImportChange(
				{ exited: canSeeExit && exited, type: 'removed', values: storedValues(stored) },
				visible,
			),
		),
		...plan.changed.map(({ fields, values }) =>
			toImportChange({ fields, type: 'changed', values }, visible),
		),
		...plan.created.map((values) => toImportChange({ type: 'created', values }, visible)),
	];
	return {
		changes,
		counts: {
			changed: plan.changed.length,
			created: plan.created.length,
			futureExit: canSeeExit ? plan.futureExit : null,
			removed: plan.removed.length,
			removedExited: canSeeExit ? plan.removed.filter(({ exited }) => exited).length : null,
			unchanged: plan.unchanged,
			withoutEmail: plan.withoutEmail,
		},
	};
}

/**
 * Previews a member import: what the file changes in the stock. With blocking issues the file
 * is not compared (its numbers are not reliable), the preview names the issues only. Nothing is
 * stored.
 *
 * @param db The database.
 * @param principal Who imports; needs `edit` in the members area.
 * @param payload The rows of the file.
 * @param now The instant; exits are compared with today in the club's time zone.
 * @returns The preview.
 * @throws {ForbiddenError} For a payload of another kind or without the right.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function previewMemberImport(
	db: Db,
	principal: Principal,
	payload: ImportPayload,
	now: Date,
): Promise<MemberImportPreview> {
	const access = await authorizeImport(db, principal, { kind: 'member', payload });
	// The version is read before the stock: a change in between makes the confirm refuse, it can
	// never accept a preview of an older stock.
	const { stockVersion } = await getImportState(db, 'member');
	const rows = await readImportRows(db, payload);
	const plan =
		rows.blocking.length > 0 ? NO_PLAN : await planMembers(db, rows.rows, todayInClubZone(now));
	const { changes, counts } = describePlan(plan, access.visible.member);
	const listed = firstOf(changes, MAX_LISTED_CHANGES);
	const issues = firstOf(rows.fieldIssues, MAX_LISTED_ISSUES);
	const deletions = plan.removed.length;
	return {
		blocking: [...rows.blocking],
		changes: listed.listed,
		confirmation: { deletions, required: needsSafetyConfirmation(plan.stock, deletions) },
		counts,
		fieldIssues: issues.listed,
		moreChanges: listed.more,
		moreIssues: issues.more,
		stockVersion,
	};
}

/**
 * Writes a member plan: deletes, inserts, then updates.
 *
 * @param tx The transaction.
 * @param plan The plan.
 * @param withFieldIds Keys the custom values by field id.
 * @returns The counts, also the audit details.
 */
async function writeMembers(
	tx: Db,
	plan: MemberPlan,
	withFieldIds: WithFieldIds,
): Promise<WrittenCounts> {
	await deleteContacts(
		tx,
		plan.removed.map(({ stored }) => stored.id),
	);
	await insertContacts(tx, plan.created.map(withFieldIds));
	await updateContacts(
		tx,
		plan.changed.map(({ stored, values }) => ({ id: stored.id, values: withFieldIds(values) })),
	);
	const counts = {
		changed: plan.changed.length,
		created: plan.created.length,
		removed: plan.removed.length,
	};
	return { counts, details: counts };
}

/**
 * Confirms a member import: replaces the stock of members in one transaction. Suppressions and
 * opt-outs stay; they hang on the member number. Refuses without writing when the stock changed
 * since the preview, the rows have blocking issues, or more than 20 % of the stock would be
 * deleted and `confirmedDeletions` is not their number.
 *
 * @param db The database.
 * @param principal Who imports; needs `edit` in the members area.
 * @param payload The rows of the file, as previewed.
 * @param input The stock version of the preview and the confirmed number of deletions.
 * @param now The instant of the import.
 * @returns The counts, or why nothing was written.
 * @throws {ForbiddenError} For a payload of another kind or without the right.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function confirmMemberImport(
	db: Db,
	principal: Principal,
	payload: ImportPayload,
	input: Readonly<{ stockVersion: number; confirmedDeletions: number | null }>,
	now: Date,
): Promise<ConfirmImportResult> {
	const today = todayInClubZone(now);
	return confirmImport<MemberPlan>(
		db,
		{
			auditAction: 'import.members',
			kind: 'member',
			now,
			payload,
			principal,
			stockVersion: input.stockVersion,
		},
		{
			plan: async (tx, rows) => planMembers(tx, rows.rows, today),
			refuse: (plan) => {
				const deletions = plan.removed.length;
				const unconfirmed =
					needsSafetyConfirmation(plan.stock, deletions) && input.confirmedDeletions !== deletions;
				return unconfirmed ? 'confirmationRequired' : null;
			},
			write: writeMembers,
		},
	);
}

export { confirmMemberImport, needsSafetyConfirmation, previewMemberImport, SAFETY_THRESHOLD };
export type { MemberImportCounts, MemberImportPreview };
