import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { getContact } from '@/server/contacts/contacts';
import { getImportState } from '@/server/contacts/import-state';
import { getFieldAreas, listCustomFields, setFieldAreas } from '@/server/contacts/settings';
import type { CustomFieldRecord } from '@/server/contacts/settings';
import { setOptOut, setSuppression } from '@/server/contacts/suppressions';
import { setUpClub, userWith } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { auditLog, contacts, protectedFieldAreas } from '@/server/db/schema';
import type { ContactRecord } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { savedMappingSchema } from './mapping';
import type { MappedTarget, SavedMapping } from './mapping';
import { confirmMemberImport, needsSafetyConfirmation, previewMemberImport } from './members';
import type { MemberImportPreview } from './members';
import type { ImportPayload } from './payload';
import { WRITE_BATCH_SIZE } from './plan';
import type { ConfirmImportResult } from './plan';
import { memberPayload, partnerPayload } from './testing';

const NOW = new Date('2026-11-24T10:00:00Z');

/** A club with an importer (`edit` in the members area) and its setup admin. */
interface Club {
	readonly db: Db;
	readonly admin: Principal;
	readonly importer: Principal;
	readonly membersAreaId: string;
	readonly partnersAreaId: string;
}

/** Cells of a member row that differ from the defaults of `memberRow`. */
type RowChanges = Readonly<
	Partial<
		Record<
			| 'birthday'
			| 'departments'
			| 'email'
			| 'firstName'
			| 'gender'
			| 'lastName'
			| 'status'
			| 'until',
			string
		>
	>
>;

/** How a test previews: by default as the importer at `NOW`. */
type PreviewOptions = Readonly<{ now?: Date; principal?: Principal }>;

/**
 * Sets a club up with an importer.
 *
 * @returns The club.
 */
async function setUp(): Promise<Club> {
	const db = await createTestDb();
	const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
	const importer = await userWith(db, { [membersAreaId]: 'edit' });
	return { admin, db, importer, membersAreaId, partnersAreaId };
}

/**
 * The cells of one member in the columns of `memberPayload`: Nr., Vorname, Nachname, E-Mail,
 * Geburtstag, Mitglied bis, Abteilungen, Status, Geschlecht. All data is invented.
 *
 * @param number The member number.
 * @param changes Cells that differ from the defaults.
 * @returns The cells.
 */
function memberRow(number: number, changes: RowChanges = {}): string[] {
	return [
		String(number),
		changes.firstName ?? 'Anna',
		changes.lastName ?? `Beispiel ${number}`,
		changes.email ?? `anna.${number}@example.org`,
		changes.birthday ?? '17.05.1980',
		changes.until ?? '-',
		changes.departments ?? 'Fußball',
		changes.status ?? 'Aktiv',
		changes.gender ?? 'weiblich',
	];
}

/**
 * The rows of the members `from` to `to`.
 *
 * @param from The first number.
 * @param to The last number.
 * @param changes Cells that differ from the defaults, in every row.
 * @returns The rows.
 */
function numbers(from: number, to: number, changes: RowChanges = {}): string[][] {
	return Array.from({ length: to - from + 1 }, (_unused, index) =>
		memberRow(from + index, changes),
	);
}

/**
 * The payload of the members `from` to `to`.
 *
 * @param from The first number.
 * @param to The last number.
 * @param changes Cells that differ from the defaults, in every row.
 * @returns The payload.
 */
function membersFile(from: number, to: number, changes: RowChanges = {}): ImportPayload {
	return memberPayload(numbers(from, to, changes));
}

/**
 * Previews an import.
 *
 * @param club The club.
 * @param payload The payload.
 * @param options Who previews when; by default the importer at `NOW`.
 * @returns The preview.
 */
async function preview(
	club: Club,
	payload: ImportPayload,
	options: PreviewOptions = {},
): Promise<MemberImportPreview> {
	return previewMemberImport(
		club.db,
		options.principal ?? club.importer,
		payload,
		options.now ?? NOW,
	);
}

/**
 * Confirms an import as the importer at `NOW`.
 *
 * @param club The club.
 * @param payload The payload.
 * @param input The stock version of the preview and the confirmed deletions.
 * @returns The result.
 */
async function confirm(
	club: Club,
	payload: ImportPayload,
	input: Readonly<{ stockVersion: number; confirmedDeletions: number | null }>,
): Promise<ConfirmImportResult> {
	return confirmMemberImport(club.db, club.importer, payload, input, NOW);
}

/**
 * Previews and confirms an import, confirming the deletions the preview names.
 *
 * @param club The club.
 * @param payload The payload.
 * @param now The instant of the import.
 * @returns The result of the confirm.
 */
async function importMembers(
	club: Club,
	payload: ImportPayload,
	now: Date = NOW,
): Promise<ConfirmImportResult> {
	const previewed = await preview(club, payload, { now });
	return confirmMemberImport(
		club.db,
		club.importer,
		payload,
		{ confirmedDeletions: previewed.confirmation.deletions, stockVersion: previewed.stockVersion },
		now,
	);
}

/**
 * Imports the members 1 to `count`.
 *
 * @param club The club.
 * @param count How many members.
 */
async function stock(club: Club, count: number): Promise<void> {
	const result = await importMembers(club, membersFile(1, count));
	if (!result.ok) throw new Error('The stock import failed.');
}

/**
 * The stored members by number: number and last name.
 *
 * @param db The database.
 * @returns The members.
 */
async function storedMembers(db: Db): Promise<[string | null, string | null][]> {
	const rows = await db
		.select({ lastName: contacts.lastName, memberNumber: contacts.memberNumber })
		.from(contacts)
		.where(eq(contacts.kind, 'member'))
		.orderBy(asc(contacts.memberNumber));
	return rows.map((row) => [row.memberNumber, row.lastName]);
}

/**
 * The stored member with a number.
 *
 * @param db The database.
 * @param number The member number.
 * @returns The row.
 */
async function storedMember(db: Db, number: string): Promise<ContactRecord> {
	const [row] = await db.select().from(contacts).where(eq(contacts.memberNumber, number));
	if (row === undefined) throw new Error(`Member ${number} is missing.`);
	return row;
}

/**
 * The ids of stored members.
 *
 * @param db The database.
 * @param memberNumbers The member numbers.
 * @returns The ids in the order of the numbers.
 */
async function memberIds(db: Db, memberNumbers: readonly string[]): Promise<string[]> {
	const rows = await Promise.all(memberNumbers.map(async (number) => storedMember(db, number)));
	return rows.map((row) => row.id);
}

/**
 * The custom values of stored members.
 *
 * @param db The database.
 * @param memberNumbers The member numbers.
 * @returns The custom values in the order of the numbers.
 */
async function customValuesOf(
	db: Db,
	memberNumbers: readonly string[],
): Promise<Record<string, string>[]> {
	const rows = await Promise.all(memberNumbers.map(async (number) => storedMember(db, number)));
	return rows.map((row) => row.customValues);
}

/**
 * The only custom field of the members.
 *
 * @param db The database.
 * @returns The field.
 */
async function onlyMemberField(db: Db): Promise<CustomFieldRecord> {
	const fields = await listCustomFields(db, 'member');
	const [field] = fields;
	if (field === undefined || fields.length > 1) throw new Error('Expected one custom field.');
	return field;
}

/**
 * The saved mapping of the members.
 *
 * @param db The database.
 * @returns The mapping, checked by its schema.
 */
async function savedMemberMapping(db: Db): Promise<SavedMapping> {
	const state = await getImportState(db, 'member');
	return savedMappingSchema.parse(state.mapping);
}

/**
 * Adds a column `Spind` at the end of a payload.
 *
 * @param payload The payload.
 * @param target The target of the column.
 * @param cells The cell per row; missing cells are null.
 * @returns The wider payload.
 */
function withSpind(
	payload: ImportPayload,
	target: MappedTarget,
	cells: readonly string[],
): ImportPayload {
	return {
		...payload,
		columns: [...payload.columns, { header: 'Spind', target }],
		rows: payload.rows.map((row, index) => ({
			...row,
			cells: [...row.cells, cells[index] ?? null],
		})),
	};
}

/**
 * Tells whether a call is refused as forbidden.
 *
 * @param attempt The pending call.
 * @returns True when it rejects with a `ForbiddenError`.
 */
async function isForbidden(attempt: Promise<unknown>): Promise<boolean> {
	try {
		await attempt;
		return false;
	} catch (error) {
		return error instanceof ForbiddenError;
	}
}

/** The counts of a preview that compared nothing. */
const NO_COUNTS: MemberImportPreview['counts'] = {
	changed: 0,
	created: 0,
	futureExit: 0,
	removed: 0,
	removedExited: 0,
	unchanged: 0,
	withoutEmail: 0,
};

/** The flags of a change that is not `changed`. */
const PLAIN = { exited: false, fields: [], hiddenFields: false };

/**
 * The display name of an invented member without organization.
 *
 * @param primary The name.
 * @returns The display name.
 */
function nameOf(primary: string): { primary: string; secondary: null } {
	return { primary, secondary: null };
}

describe(needsSafetyConfirmation, () => {
	it.each([
		{ deletions: 0, expected: false, size: 0 },
		{ deletions: 5, expected: false, size: 0 },
		{ deletions: 0, expected: false, size: 10 },
		{ deletions: 2, expected: false, size: 10 },
		{ deletions: 3, expected: true, size: 10 },
		{ deletions: 1, expected: false, size: 5 },
		{ deletions: 2, expected: true, size: 5 },
		{ deletions: 1, expected: true, size: 1 },
		{ deletions: 87, expected: false, size: 437 },
		{ deletions: 88, expected: true, size: 437 },
	])('answers $expected for $deletions deletions of $size', ({ deletions, expected, size }) => {
		expect(needsSafetyConfirmation(size, deletions)).toBe(expected);
	});
});

describe('the member import', () => {
	it('creates all members on the first import without a safety check', async () => {
		const club = await setUp();
		const payload = membersFile(1, 3);
		const p = await preview(club, payload);
		expect(p).toMatchObject({
			confirmation: { deletions: 0, required: false },
			counts: { ...NO_COUNTS, created: 3 },
			stockVersion: 0,
		});
		await expect(
			confirm(club, payload, { confirmedDeletions: null, stockVersion: p.stockVersion }),
		).resolves.toStrictEqual({
			counts: { changed: 0, created: 3, removed: 0, warnings: 0 },
			ok: true,
		});
		await expect(storedMembers(club.db)).resolves.toStrictEqual([
			['1', 'Beispiel 1'],
			['2', 'Beispiel 2'],
			['3', 'Beispiel 3'],
		]);
		// Fields without a column are NULL, never ''.
		await expect(storedMember(club.db, '1')).resolves.toMatchObject({
			birthDate: '1980-05-17',
			city: null,
			contactKey: 'nr:1',
			customValues: {},
			customerNumber: null,
			email: 'anna.1@example.org',
			entryDate: null,
			exitDate: null,
			firstName: 'Anna',
			gender: 'female',
			groups: ['Fußball', 'Aktiv'],
			kind: 'member',
			lastName: 'Beispiel 1',
			organization: null,
			postalCode: null,
			street: null,
			tags: [],
		});
	});

	it('replaces the stock: deletes missing, updates changed, keeps unchanged', async () => {
		const club = await setUp();
		await stock(club, 3);
		const before = await memberIds(club.db, ['1', '2']);
		const payload = memberPayload([
			memberRow(1),
			memberRow(2, { lastName: 'Neumann' }),
			memberRow(4),
		]);
		const p = await preview(club, payload);
		expect(p).toMatchObject({
			confirmation: { deletions: 1, required: true },
			counts: { ...NO_COUNTS, changed: 1, created: 1, removed: 1, unchanged: 1 },
			moreChanges: 0,
		});
		expect(p.changes).toStrictEqual([
			{ ...PLAIN, name: nameOf('Anna Beispiel 3'), number: '3', type: 'removed' },
			{
				...PLAIN,
				fields: ['lastName'],
				name: nameOf('Anna Neumann'),
				number: '2',
				type: 'changed',
			},
			{ ...PLAIN, name: nameOf('Anna Beispiel 4'), number: '4', type: 'created' },
		]);
		await expect(
			confirm(club, payload, { confirmedDeletions: 1, stockVersion: p.stockVersion }),
		).resolves.toStrictEqual({
			counts: { changed: 1, created: 1, removed: 1, warnings: 0 },
			ok: true,
		});
		await expect(storedMembers(club.db)).resolves.toStrictEqual([
			['1', 'Beispiel 1'],
			['2', 'Neumann'],
			['4', 'Beispiel 4'],
		]);
		// Updated in place: the contacts keep their ids.
		await expect(memberIds(club.db, ['1', '2'])).resolves.toStrictEqual(before);
	});

	it('deletes members whose exit date is reached and counts them as exited', async () => {
		const club = await setUp();
		await stock(club, 3);
		const payload = memberPayload([
			memberRow(1),
			memberRow(2),
			memberRow(3, { until: '24.11.2026' }),
			// Left before and not in the stock: neither created nor counted.
			memberRow(5, { until: '01.01.2026' }),
		]);
		await expect(preview(club, payload)).resolves.toMatchObject({
			changes: [
				{ ...PLAIN, exited: true, name: nameOf('Anna Beispiel 3'), number: '3', type: 'removed' },
			],
			confirmation: { deletions: 1, required: true },
			counts: { ...NO_COUNTS, removed: 1, removedExited: 1, unchanged: 2 },
		});
		await expect(importMembers(club, payload)).resolves.toStrictEqual({
			counts: { changed: 0, created: 0, removed: 1, warnings: 0 },
			ok: true,
		});
		await expect(storedMembers(club.db)).resolves.toStrictEqual([
			['1', 'Beispiel 1'],
			['2', 'Beispiel 2'],
		]);
	});

	it('reaches the exit date by the Berlin calendar', async () => {
		const club = await setUp();
		const payload = memberPayload([memberRow(1), memberRow(2, { until: '01.04.2026' })]);
		// 23:30 on 31 March in Berlin: the exit date is tomorrow.
		const evening = new Date('2026-03-31T21:30:00Z');
		await expect(preview(club, payload, { now: evening })).resolves.toMatchObject({
			counts: { created: 2, futureExit: 1 },
		});
		// 00:30 on 1 April in Berlin, still 31 March in UTC: the exit date is reached.
		const midnight = new Date('2026-03-31T22:30:00Z');
		await expect(preview(club, payload, { now: midnight })).resolves.toMatchObject({
			counts: { created: 1, futureExit: 0 },
		});
		await expect(importMembers(club, payload, midnight)).resolves.toMatchObject({
			counts: { created: 1 },
			ok: true,
		});
		await expect(storedMembers(club.db)).resolves.toStrictEqual([['1', 'Beispiel 1']]);
	});

	it('imports members with a future exit date', async () => {
		const club = await setUp();
		const payload = memberPayload([memberRow(1, { until: '2027-06-30' }), memberRow(2)]);
		await expect(preview(club, payload)).resolves.toMatchObject({
			counts: { ...NO_COUNTS, created: 2, futureExit: 1 },
		});
		await importMembers(club, payload);
		await expect(storedMember(club.db, '1')).resolves.toMatchObject({ exitDate: '2027-06-30' });
		await expect(storedMember(club.db, '2')).resolves.toMatchObject({ exitDate: null });
	});

	it('asks for confirmation when more than 20 % would be deleted', async () => {
		const club = await setUp();
		await stock(club, 10);
		await expect(preview(club, membersFile(1, 8))).resolves.toMatchObject({
			confirmation: { deletions: 2, required: false },
		});
		const seven = membersFile(1, 7);
		const p = await preview(club, seven);
		expect(p.confirmation).toStrictEqual({ deletions: 3, required: true });
		const confirmWith = async (n: number | null): Promise<ConfirmImportResult> =>
			confirm(club, seven, { confirmedDeletions: n, stockVersion: p.stockVersion });
		const refused = [await confirmWith(null), await confirmWith(2)];
		const kept = await storedMembers(club.db);
		expect({ kept: kept.length, refused }).toStrictEqual({
			kept: 10,
			refused: [
				{ failure: 'confirmationRequired', ok: false },
				{ failure: 'confirmationRequired', ok: false },
			],
		});
		await expect(confirmWith(3)).resolves.toMatchObject({ counts: { removed: 3 }, ok: true });
		await expect(storedMembers(club.db)).resolves.toHaveLength(7);
	});

	it('asks for confirmation when a file of the same size replaces most members', async () => {
		const club = await setUp();
		await stock(club, 10);
		await expect(preview(club, membersFile(101, 110))).resolves.toMatchObject({
			confirmation: { deletions: 10, required: true },
		});
	});

	it('ignores the confirmed deletions when no confirmation is needed', async () => {
		const club = await setUp();
		await stock(club, 10);
		const payload = membersFile(1, 9);
		const p = await preview(club, payload);
		expect(p.confirmation).toStrictEqual({ deletions: 1, required: false });
		await expect(
			confirm(club, payload, { confirmedDeletions: null, stockVersion: p.stockVersion }),
		).resolves.toMatchObject({ counts: { removed: 1 }, ok: true });
	});

	it('refuses to confirm after the stock changed', async () => {
		const club = await setUp();
		await stock(club, 3);
		const payload = memberPayload([
			memberRow(1, { lastName: 'Neumann' }),
			memberRow(2),
			memberRow(3),
		]);
		const p = await preview(club, payload);
		const [firstId = ''] = await memberIds(club.db, ['1']);
		await setSuppression(club.db, club.admin, firstId, true);
		await expect(
			confirm(club, payload, { confirmedDeletions: null, stockVersion: p.stockVersion }),
		).resolves.toStrictEqual({ failure: 'stockChanged', ok: false });
		await expect(storedMember(club.db, '1')).resolves.toMatchObject({ lastName: 'Beispiel 1' });
		// A new preview carries the new stock version and goes through.
		const again = await preview(club, payload);
		expect(again.stockVersion).toBe(p.stockVersion + 1);
		await expect(
			confirm(club, payload, { confirmedDeletions: null, stockVersion: again.stockVersion }),
		).resolves.toMatchObject({ counts: { changed: 1 }, ok: true });
	});

	it('refuses to confirm with blocking issues and changes nothing', async () => {
		const club = await setUp();
		await stock(club, 2);
		const stateBefore = await getImportState(club.db, 'member');
		const payload = memberPayload([
			memberRow(1, { lastName: 'Neumann' }),
			memberRow(2),
			memberRow(2, { lastName: 'Zweimal' }),
		]);
		const p = await preview(club, payload);
		// Without a reliable key the preview does not compare the file with the stock.
		expect(p).toMatchObject({
			blocking: [{ firstLine: 3, line: 4, reason: 'numberDuplicate' }],
			changes: [],
			confirmation: { deletions: 0, required: false },
			counts: NO_COUNTS,
		});
		await expect(
			confirm(club, payload, { confirmedDeletions: null, stockVersion: p.stockVersion }),
		).resolves.toStrictEqual({ failure: 'blocked', ok: false });
		await expect(storedMembers(club.db)).resolves.toStrictEqual([
			['1', 'Beispiel 1'],
			['2', 'Beispiel 2'],
		]);
		await expect(getImportState(club.db, 'member')).resolves.toStrictEqual(stateBefore);
	});

	it('keeps suppressions and opt-outs of a deleted member and applies them on return', async () => {
		const club = await setUp();
		const { db, importer, partnersAreaId } = club;
		await stock(club, 3);
		const [secondId = ''] = await memberIds(db, ['2']);
		await setSuppression(db, importer, secondId, true);
		await setOptOut(db, importer, { areaId: partnersAreaId, contactId: secondId, optedOut: true });
		const withoutSecond = memberPayload([memberRow(1), memberRow(3)]);
		await expect(importMembers(club, withoutSecond)).resolves.toMatchObject({
			counts: { removed: 1 },
		});
		await expect(importMembers(club, membersFile(1, 3))).resolves.toMatchObject({
			counts: { created: 1 },
		});
		const [backId = ''] = await memberIds(db, ['2']);
		expect(backId).not.toBe(secondId);
		const detail = await getContact(db, importer, backId);
		expect(detail?.suppression).not.toBeNull();
		expect(detail?.optOuts.map((optOut) => optOut.areaId)).toStrictEqual([partnersAreaId]);
	});

	it('saves the mapping and the import time only on confirm', async () => {
		const club = await setUp();
		const payload = { ...membersFile(1, 2), discardedHeaders: ['Typ'] };
		const p = await preview(club, payload);
		await expect(getImportState(club.db, 'member')).resolves.toStrictEqual({
			kind: 'member',
			lastConfirmedAt: null,
			mapping: null,
			stockVersion: 0,
		});
		await confirm(club, payload, { confirmedDeletions: null, stockVersion: p.stockVersion });
		await expect(getImportState(club.db, 'member')).resolves.toMatchObject({
			lastConfirmedAt: NOW,
			stockVersion: 1,
		});
		const mapping = await savedMemberMapping(club.db);
		expect(mapping.columns).toMatchObject({
			Abteilungen: { type: 'groups' },
			'Nr.': { field: 'memberNumber', type: 'field' },
			Typ: { type: 'discard' },
		});
		expect(mapping.options).toStrictEqual(payload.options);
	});

	it('records a repeated import of the same file without changing members', async () => {
		const club = await setUp();
		await stock(club, 3);
		const later = new Date('2026-12-01T10:00:00Z');
		await expect(preview(club, membersFile(1, 3), { now: later })).resolves.toMatchObject({
			changes: [],
			counts: { ...NO_COUNTS, unchanged: 3 },
		});
		await expect(importMembers(club, membersFile(1, 3), later)).resolves.toStrictEqual({
			counts: { changed: 0, created: 0, removed: 0, warnings: 0 },
			ok: true,
		});
		await expect(getImportState(club.db, 'member')).resolves.toMatchObject({
			lastConfirmedAt: later,
			stockVersion: 2,
		});
	});

	it('creates a new custom field as protected, for the members area', async () => {
		const club = await setUp();
		const { db, membersAreaId } = club;
		const newField: MappedTarget = { name: ' Spind ', type: 'newCustomField', valueType: 'text' };
		const payload = withSpind(membersFile(1, 2), newField, ['A-12', '-']);
		await preview(club, payload);
		await expect(listCustomFields(db, 'member')).resolves.toStrictEqual([]);
		await expect(importMembers(club, payload)).resolves.toMatchObject({ ok: true });
		const field = await onlyMemberField(db);
		expect(field).toMatchObject({
			kind: 'member',
			name: 'Spind',
			placeholderKey: 'spind',
			protection: 'protected',
			type: 'text',
		});
		const fieldAreas = await getFieldAreas(db, 'member');
		const ownAreas = await db.select().from(protectedFieldAreas);
		expect({ areas: fieldAreas.get(`custom:${field.id}`), ownAreas }).toStrictEqual({
			areas: [membersAreaId],
			ownAreas: [],
		});
		const mapping = await savedMemberMapping(db);
		expect(mapping.columns.Spind).toStrictEqual({ customFieldId: field.id, type: 'customField' });
	});

	it('keeps the values of a new custom field', async () => {
		const club = await setUp();
		const { db, importer } = club;
		const newField: MappedTarget = { name: 'Spind', type: 'newCustomField', valueType: 'text' };
		await importMembers(club, withSpind(membersFile(1, 2), newField, ['A-12', '-']));
		const { id } = await onlyMemberField(db);
		await expect(customValuesOf(db, ['1', '2'])).resolves.toStrictEqual([{ [id]: 'A-12' }, {}]);
		const [firstId = ''] = await memberIds(db, ['1']);
		const detail = await getContact(db, importer, firstId);
		expect(detail?.customValues).toStrictEqual([
			{ id, name: 'Spind', type: 'text', value: 'A-12' },
		]);

		// The next import maps the column to the saved field.
		const savedField: MappedTarget = { customFieldId: id, type: 'customField' };
		const next = withSpind(membersFile(1, 2), savedField, ['A-12', 'B-7']);
		await expect(preview(club, next)).resolves.toMatchObject({
			changes: [{ fields: [`custom:${id}`], number: '2', type: 'changed' }],
		});
		await importMembers(club, next);
		await expect(customValuesOf(db, ['1', '2'])).resolves.toStrictEqual([
			{ [id]: 'A-12' },
			{ [id]: 'B-7' },
		]);
	});

	it('names a new custom field of a stored member in its changes', async () => {
		const club = await setUp();
		await stock(club, 1);
		const newField: MappedTarget = { name: 'Spind', type: 'newCustomField', valueType: 'text' };
		const payload = withSpind(membersFile(1, 1), newField, ['A-12']);
		await expect(preview(club, payload)).resolves.toMatchObject({
			changes: [
				{ fields: ['custom:new:Spind'], hiddenFields: false, number: '1', type: 'changed' },
			],
		});
	});

	it('lists changed protected fields only for users who may see them', async () => {
		const club = await setUp();
		const { admin, db, membersAreaId, partnersAreaId } = club;
		await stock(club, 1);
		await setFieldAreas(db, admin, {
			areaIds: [partnersAreaId],
			fieldKey: 'birthDate',
			kind: 'member',
		});
		const seer = await userWith(db, { [membersAreaId]: 'edit', [partnersAreaId]: 'read' });
		const payload = memberPayload([memberRow(1, { birthday: '18.05.1980', lastName: 'Neumann' })]);
		const name = nameOf('Anna Neumann');
		await expect(preview(club, payload)).resolves.toMatchObject({
			changes: [
				{
					exited: false,
					fields: ['lastName'],
					hiddenFields: true,
					name,
					number: '1',
					type: 'changed',
				},
			],
		});
		await expect(preview(club, payload, { principal: seer })).resolves.toMatchObject({
			changes: [{ fields: ['lastName', 'birthDate'], hiddenFields: false, type: 'changed' }],
		});
		// A change of a hidden field alone still counts, without naming the field.
		const onlyHidden = memberPayload([memberRow(1, { birthday: '18.05.1980' })]);
		await expect(preview(club, onlyHidden)).resolves.toMatchObject({
			changes: [{ fields: [], hiddenFields: true, type: 'changed' }],
			counts: { changed: 1 },
		});
	});

	it('hides exits from users who may not see the exit date', async () => {
		const club = await setUp();
		const { admin, db, membersAreaId, partnersAreaId } = club;
		await stock(club, 3);
		await setFieldAreas(db, admin, {
			areaIds: [partnersAreaId],
			fieldKey: 'exitDate',
			kind: 'member',
		});
		const seer = await userWith(db, { [membersAreaId]: 'edit', [partnersAreaId]: 'read' });
		const payload = memberPayload([
			memberRow(1, { until: '2027-06-30' }),
			memberRow(2),
			memberRow(3, { until: '24.11.2026' }),
		]);
		await expect(preview(club, payload)).resolves.toMatchObject({
			changes: [
				{ exited: false, fields: [], hiddenFields: false, number: '3', type: 'removed' },
				{ exited: false, fields: [], hiddenFields: true, number: '1', type: 'changed' },
			],
			counts: {
				...NO_COUNTS,
				changed: 1,
				futureExit: null,
				removed: 1,
				removedExited: null,
				unchanged: 1,
			},
		});
		await expect(preview(club, payload, { principal: seer })).resolves.toMatchObject({
			changes: [
				{ exited: true, fields: [], number: '3', type: 'removed' },
				{ exited: false, fields: ['exitDate'], hiddenFields: false, number: '1', type: 'changed' },
			],
			counts: { futureExit: 1, removedExited: 1 },
		});
	});

	it('requires edit in the members area', async () => {
		const club = await setUp();
		const { db, importer, membersAreaId, partnersAreaId } = club;
		const reader = await userWith(db, { [membersAreaId]: 'read' });
		const financeEditor = await userWith(db, { [partnersAreaId]: 'edit' });
		const adminWithoutArea = await userWith(db, {}, { isAdmin: true });
		const members = membersFile(1, 2);
		// A partner payload is no member import, whoever sends it.
		const partners = partnerPayload([['100001', 'Bäckerei Körner GmbH', '-', '-', 'keine Angabe']]);
		const input = { confirmedDeletions: null, stockVersion: 0 };
		const attempts = [
			...[reader, financeEditor, adminWithoutArea].flatMap((principal) => [
				previewMemberImport(db, principal, members, NOW),
				confirmMemberImport(db, principal, members, input, NOW),
			]),
			previewMemberImport(db, importer, partners, NOW),
			confirmMemberImport(db, importer, partners, input, NOW),
		];
		const outcomes = attempts.map(async (attempt) => isForbidden(attempt));
		await expect(Promise.all(outcomes)).resolves.toStrictEqual(attempts.map(() => true));
		await expect(db.select().from(contacts)).resolves.toStrictEqual([]);
		await expect(getImportState(db, 'member')).resolves.toMatchObject({
			lastConfirmedAt: null,
			stockVersion: 0,
		});
	});

	it('writes an audit entry with counts and without names', async () => {
		const club = await setUp();
		const { db, importer } = club;
		const payload = memberPayload([memberRow(1), memberRow(2, { email: 'anna@' }), memberRow(3)]);
		await expect(importMembers(club, payload)).resolves.toStrictEqual({
			counts: { changed: 0, created: 3, removed: 0, warnings: 1 },
			ok: true,
		});
		const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'import.members'));
		expect(entries.map((entry) => [entry.actorUserId, entry.target, entry.details])).toStrictEqual([
			[importer.userId, null, { changed: 0, created: 3, removed: 0, warnings: 1 }],
		]);
		expect(JSON.stringify(entries)).not.toMatch(/Anna|Beispiel|example\.org/u);
	});

	it('stores empty values as NULL and an unknown gender as unspecified', async () => {
		const club = await setUp();
		const payload = memberPayload([
			memberRow(1, {
				departments: '-',
				email: '-',
				firstName: '   ',
				gender: 'unbekannt',
				status: '',
			}),
		]);
		await expect(preview(club, payload)).resolves.toMatchObject({
			changes: [{ name: nameOf('Beispiel 1'), type: 'created' }],
			counts: { created: 1, withoutEmail: 1 },
			fieldIssues: [{ column: 'Geschlecht', line: 2, reason: 'unknownGender' }],
		});
		await importMembers(club, payload);
		await expect(storedMember(club.db, '1')).resolves.toMatchObject({
			email: null,
			firstName: null,
			gender: 'unspecified',
			groups: [],
		});
	});

	it('caps the lists of the preview at 1 000 entries', async () => {
		const club = await setUp();
		const p = await preview(club, membersFile(1, 1005, { email: 'kein-at' }));
		expect({
			changes: p.changes.length,
			counts: p.counts,
			fieldIssues: p.fieldIssues.length,
			last: p.changes.at(-1)?.number,
			moreChanges: p.moreChanges,
			moreIssues: p.moreIssues,
		}).toStrictEqual({
			changes: 1000,
			counts: { ...NO_COUNTS, created: 1005, withoutEmail: 1005 },
			fieldIssues: 1000,
			last: '1000',
			moreChanges: 5,
			moreIssues: 5,
		});
	});

	it('writes more rows than fit into one statement', async () => {
		const club = await setUp();
		// Three statements per kind of write: two full batches and one row.
		const many = 2 * WRITE_BATCH_SIZE + 1;
		await stock(club, many);
		await expect(storedMembers(club.db)).resolves.toHaveLength(many);
		await expect(
			importMembers(club, membersFile(1, many, { lastName: 'Neu' })),
		).resolves.toMatchObject({
			counts: { changed: many, created: 0, removed: 0 },
		});
		const renamed = await storedMembers(club.db);
		const lastNames = new Set(renamed.map(([, lastName]) => lastName));
		expect([...lastNames]).toStrictEqual(['Neu']);
		await expect(importMembers(club, membersFile(1, 1))).resolves.toMatchObject({
			counts: { changed: 1, removed: many - 1 },
		});
		await expect(storedMembers(club.db)).resolves.toStrictEqual([['1', 'Beispiel 1']]);
	});
});
