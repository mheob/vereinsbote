import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import type { Gender } from '@/server/contacts/fields';
import { getImportState } from '@/server/contacts/import-state';
import { listCustomFields, setFieldAreas } from '@/server/contacts/settings';
import type { CustomFieldRecord } from '@/server/contacts/settings';
import { setOptOut, setSuppression } from '@/server/contacts/suppressions';
import { insertContact, setUpClub, userWith } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { auditLog, contactOptOuts, contacts, contactSuppressions } from '@/server/db/schema';
import type { ContactRecord } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { savedMappingSchema } from './mapping';
import type { MappedTarget } from './mapping';
import { confirmPartnerImport, previewPartnerImport } from './partners';
import type { PartnerImportPreview } from './partners';
import type { ImportPayload } from './payload';
import type { ConfirmImportResult } from './plan';
import { memberPayload, partnerPayload } from './testing';

const NOW = new Date('2026-11-24T10:00:00Z');

/** The rule of the club's partner export: without a first name, the last name is the company. */
const ORGANIZATION_RULE = { organizationFromLastName: true };

/** A club with an importer (`edit` in the partners area) and its setup admin. */
interface Club {
	readonly db: Db;
	readonly admin: Principal;
	readonly importer: Principal;
	readonly membersAreaId: string;
	readonly partnersAreaId: string;
}

/** The columns of a stored partner a test sets. */
type PartnerFields = Readonly<
	Partial<
		Record<
			'birthDate' | 'customerNumber' | 'email' | 'firstName' | 'lastName' | 'organization',
			string
		>
	>
> &
	Readonly<{ gender?: Gender; customValues?: Readonly<Record<string, string>> }> &
	Readonly<{ tags?: readonly string[] }>;

/** What a confirm is asked to do. */
type ConfirmInput = Readonly<{ stockVersion: number; deleteIds: readonly string[] }>;

/** The counts of a preview that matched nothing. */
const NO_COUNTS: PartnerImportPreview['counts'] = {
	created: 0,
	skipped: 0,
	takenOver: 0,
	unchanged: 0,
	updated: 0,
};

/** The flags of a change without hidden fields. */
const PLAIN = { exited: false, fields: [], hiddenFields: false };

/**
 * Sets a club up with an importer.
 *
 * @returns The club.
 */
async function setUp(): Promise<Club> {
	const db = await createTestDb();
	const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
	const importer = await userWith(db, { [partnersAreaId]: 'edit' });
	return { admin, db, importer, membersAreaId, partnersAreaId };
}

/**
 * Stores a partner, as the app or an earlier import would have. All data is invented.
 *
 * @param db The test database.
 * @param fields The columns to set.
 * @returns The id of the partner.
 */
async function addPartner(db: Db, fields: PartnerFields): Promise<string> {
	const { customValues, tags, ...columns } = fields;
	return insertContact(db, {
		...columns,
		customValues: { ...customValues },
		kind: 'partner',
		tags: [...(tags ?? [])],
	});
}

/**
 * The cells of an organization in the columns of `partnerPayload` (Nr., Nachname, Vorname,
 * E-Mail, Geschlecht), as the club's export has them: the name in Nachname, Vorname "-".
 *
 * @param number The customer number, '' for none.
 * @param name The name of the organization.
 * @param email The address, '-' for none.
 * @returns The cells.
 */
function organizationRow(number: string, name: string, email: string): string[] {
	return [number, name, '-', email, 'keine Angabe'];
}

/**
 * Adds a column at the end of a payload.
 *
 * @param payload The payload.
 * @param column The header and target of the column.
 * @param cells The cell per row; missing cells are null.
 * @returns The wider payload.
 */
function withColumn(
	payload: ImportPayload,
	column: Readonly<{ header: string; target: MappedTarget }>,
	cells: readonly string[],
): ImportPayload {
	return {
		...payload,
		columns: [...payload.columns, column],
		rows: payload.rows.map((row, index) => ({
			...row,
			cells: [...row.cells, cells[index] ?? null],
		})),
	};
}

/**
 * Previews an import.
 *
 * @param club The club.
 * @param payload The payload.
 * @param principal Who previews; by default the importer.
 * @returns The preview.
 */
async function preview(
	club: Club,
	payload: ImportPayload,
	principal: Principal = club.importer,
): Promise<PartnerImportPreview> {
	return previewPartnerImport(club.db, principal, payload, NOW);
}

/**
 * Confirms an import as the importer at `NOW`.
 *
 * @param club The club.
 * @param payload The payload.
 * @param input The stock version of the preview and the partners to delete.
 * @returns The result.
 */
async function confirm(
	club: Club,
	payload: ImportPayload,
	input: ConfirmInput,
): Promise<ConfirmImportResult> {
	return confirmPartnerImport(club.db, club.importer, payload, input, NOW);
}

/**
 * Previews and confirms an import.
 *
 * @param club The club.
 * @param payload The payload.
 * @param deleteIds The partners missing from the export to delete.
 * @returns The result of the confirm.
 */
async function importPartners(
	club: Club,
	payload: ImportPayload,
	deleteIds: readonly string[] = [],
): Promise<ConfirmImportResult> {
	const { stockVersion } = await preview(club, payload);
	return confirm(club, payload, { deleteIds, stockVersion });
}

/**
 * A stored partner.
 *
 * @param db The test database.
 * @param id The partner.
 * @returns The row.
 */
async function storedPartner(db: Db, id: string): Promise<ContactRecord> {
	const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
	if (row === undefined) throw new Error('The partner does not exist.');
	return row;
}

/**
 * The stored partners: customer number and organization, by customer number (none last).
 *
 * @param db The test database.
 * @returns The partners.
 */
async function storedPartners(db: Db): Promise<[string | null, string | null][]> {
	const rows = await db
		.select({ customerNumber: contacts.customerNumber, organization: contacts.organization })
		.from(contacts)
		.where(eq(contacts.kind, 'partner'))
		.orderBy(asc(contacts.customerNumber), asc(contacts.organization));
	return rows.map((row) => [row.customerNumber, row.organization]);
}

/**
 * The suppression keys of the partners, sorted.
 *
 * @param db The test database.
 * @returns The keys.
 */
async function suppressedKeys(db: Db): Promise<string[]> {
	const rows = await db
		.select({ key: contactSuppressions.contactKey })
		.from(contactSuppressions)
		.where(eq(contactSuppressions.kind, 'partner'));
	return rows.map((row) => row.key).toSorted();
}

/**
 * The opt-outs of the partners as `<key> <areaId>`, sorted.
 *
 * @param db The test database.
 * @returns The opt-outs.
 */
async function optOutKeys(db: Db): Promise<string[]> {
	const rows = await db
		.select({ areaId: contactOptOuts.areaId, key: contactOptOuts.contactKey })
		.from(contactOptOuts)
		.where(eq(contactOptOuts.kind, 'partner'));
	return rows.map((row) => `${row.key} ${row.areaId ?? ''}`).toSorted();
}

/**
 * The audit entries of partner imports: actor, target and details.
 *
 * @param db The test database.
 * @returns The entries, oldest first.
 */
async function importAudit(db: Db): Promise<[string | null, string | null, unknown][]> {
	const entries = await db
		.select()
		.from(auditLog)
		.where(eq(auditLog.action, 'import.partners'))
		.orderBy(auditLog.id);
	return entries.map((entry) => [entry.actorUserId, entry.target, entry.details]);
}

/**
 * The only custom field of the partners.
 *
 * @param db The test database.
 * @returns The field.
 */
async function onlyPartnerField(db: Db): Promise<CustomFieldRecord> {
	const fields = await listCustomFields(db, 'partner');
	const [field] = fields;
	if (field === undefined || fields.length > 1) throw new Error('Expected one custom field.');
	return field;
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

/**
 * The display name of an organization or person without a second line.
 *
 * @param primary The name.
 * @returns The display name.
 */
function nameOf(primary: string): { primary: string; secondary: null } {
	return { primary, secondary: null };
}

describe('the partner import', () => {
	it('updates a partner found by customer number and keeps its tags', async () => {
		const club = await setUp();
		const id = await addPartner(club.db, {
			customerNumber: '100001',
			email: 'info@baeckerei-koerner.example',
			organization: 'Bäckerei Körner GmbH',
			tags: ['Sponsor'],
		});
		const payload = partnerPayload(
			[organizationRow('100001', 'Bäckerei Körner GmbH', 'Kontakt@Baeckerei-Koerner.example')],
			ORGANIZATION_RULE,
		);
		const p = await preview(club, payload);
		expect(p).toMatchObject({
			blocking: [],
			counts: { ...NO_COUNTS, updated: 1 },
			keptValues: [],
			moreChanges: 0,
			notInExport: [],
			rowIssues: [],
			stockVersion: 0,
		});
		expect(p.changes).toStrictEqual([
			{
				...PLAIN,
				fields: ['email'],
				name: nameOf('Bäckerei Körner GmbH'),
				number: '100001',
				type: 'changed',
			},
		]);
		await expect(
			confirm(club, payload, { deleteIds: [], stockVersion: p.stockVersion }),
		).resolves.toStrictEqual({
			counts: { changed: 1, created: 0, removed: 0, warnings: 0 },
			ok: true,
		});
		await expect(storedPartner(club.db, id)).resolves.toMatchObject({
			contactKey: 'nr:100001',
			customerNumber: '100001',
			email: 'kontakt@baeckerei-koerner.example',
			firstName: null,
			lastName: null,
			organization: 'Bäckerei Körner GmbH',
			tags: ['Sponsor'],
		});
		// The same file again changes nothing.
		await expect(preview(club, payload)).resolves.toMatchObject({
			changes: [],
			counts: { ...NO_COUNTS, unchanged: 1 },
		});
	});

	it('updates a partner without number found by email', async () => {
		const club = await setUp();
		const id = await addPartner(club.db, {
			email: 'presse@stadtwerke.example',
			organization: 'Stadtwerke',
		});
		const payload = partnerPayload(
			[organizationRow('', 'Stadtwerke Beispielstadt', 'Presse@Stadtwerke.example')],
			ORGANIZATION_RULE,
		);
		const p = await preview(club, payload);
		expect(p).toMatchObject({
			changes: [
				{
					...PLAIN,
					fields: ['organization'],
					name: nameOf('Stadtwerke Beispielstadt'),
					number: null,
					type: 'changed',
				},
			],
			counts: { ...NO_COUNTS, updated: 1 },
			keptValues: [],
			rowIssues: [],
		});
		await expect(importPartners(club, payload)).resolves.toMatchObject({
			counts: { changed: 1, created: 0, removed: 0 },
		});
		await expect(storedPartners(club.db)).resolves.toStrictEqual([
			[null, 'Stadtwerke Beispielstadt'],
		]);
		await expect(storedPartner(club.db, id)).resolves.toMatchObject({
			contactKey: 'email:presse@stadtwerke.example',
			customerNumber: null,
		});
	});

	it('skips a row whose email matches several partners', async () => {
		const club = await setUp();
		await addPartner(club.db, {
			customerNumber: '100005',
			email: 'info@sportpark.example',
			organization: 'Sportpark Nord',
		});
		await addPartner(club.db, { email: 'info@sportpark.example', organization: 'Sportpark Süd' });
		const payload = partnerPayload(
			[
				organizationRow('', 'Sportpark', 'info@sportpark.example'),
				organizationRow('100005', 'Sportpark Nord', 'info@sportpark.example'),
			],
			ORGANIZATION_RULE,
		);
		await expect(preview(club, payload)).resolves.toMatchObject({
			changes: [],
			counts: { ...NO_COUNTS, skipped: 1, unchanged: 1 },
			moreRowIssues: 0,
			rowIssues: [{ line: 2, reason: 'emailAmbiguous' }],
		});
		await expect(importPartners(club, payload)).resolves.toStrictEqual({
			counts: { changed: 0, created: 0, removed: 0, warnings: 0 },
			ok: true,
		});
		await expect(storedPartners(club.db)).resolves.toStrictEqual([
			['100005', 'Sportpark Nord'],
			[null, 'Sportpark Süd'],
		]);
	});

	it('skips a repeated email among rows without customer number', async () => {
		const club = await setUp();
		const payload = partnerPayload(
			[
				organizationRow('', 'Bäckerei Körner GmbH', 'info@baeckerei-koerner.example'),
				organizationRow('', 'Körner Backstube', 'info@baeckerei-koerner.example'),
			],
			ORGANIZATION_RULE,
		);
		await expect(preview(club, payload)).resolves.toMatchObject({
			changes: [{ ...PLAIN, name: nameOf('Bäckerei Körner GmbH'), number: null, type: 'created' }],
			counts: { ...NO_COUNTS, created: 1, skipped: 1 },
			rowIssues: [{ line: 3, reason: 'emailRepeated' }],
		});
		await expect(importPartners(club, payload)).resolves.toMatchObject({
			counts: { changed: 0, created: 1, removed: 0 },
		});
		await expect(storedPartners(club.db)).resolves.toStrictEqual([[null, 'Bäckerei Körner GmbH']]);
	});

	it('takes over a manual partner and rekeys its suppression and opt-outs', async () => {
		const club = await setUp();
		const { db, importer, partnersAreaId } = club;
		const id = await addPartner(db, {
			email: 'kontakt@autohaus-weber.example',
			organization: 'Autohaus Weber',
			tags: ['Sponsor'],
		});
		await setSuppression(db, importer, id, true);
		await setOptOut(db, importer, { areaId: partnersAreaId, contactId: id, optedOut: true });
		const payload = partnerPayload(
			[organizationRow('100007', 'Autohaus Weber', 'kontakt@autohaus-weber.example')],
			ORGANIZATION_RULE,
		);
		const p = await preview(club, payload);
		expect(p).toMatchObject({
			changes: [
				{
					...PLAIN,
					fields: ['customerNumber'],
					name: nameOf('Autohaus Weber'),
					number: '100007',
					type: 'changed',
				},
			],
			counts: { ...NO_COUNTS, takenOver: 1 },
			notInExport: [],
		});
		await expect(
			confirm(club, payload, { deleteIds: [], stockVersion: p.stockVersion }),
		).resolves.toStrictEqual({
			counts: { changed: 1, created: 0, removed: 0, warnings: 0 },
			ok: true,
		});
		const { contactKey, tags } = await storedPartner(db, id);
		expect({
			contactKey,
			optOuts: await optOutKeys(db),
			partners: await storedPartners(db),
			suppressed: await suppressedKeys(db),
			tags,
		}).toStrictEqual({
			contactKey: 'nr:100007',
			optOuts: [`nr:100007 ${partnersAreaId}`],
			partners: [['100007', 'Autohaus Weber']],
			suppressed: ['nr:100007'],
			tags: ['Sponsor'],
		});
	});

	it('takes over only the one partner without number that has the address', async () => {
		const club = await setUp();
		const { db } = club;
		// A partner with a customer number does not count; two without one are no clear match.
		await addPartner(db, {
			customerNumber: '100001',
			email: 'info@gaertnerei-lind.example',
			organization: 'Gärtnerei Lind',
		});
		const branchId = await addPartner(db, {
			email: 'info@gaertnerei-lind.example',
			organization: 'Gärtnerei Lind Filiale',
		});
		await addPartner(db, { email: 'team@turnverein.example', organization: 'Turnverein Ost' });
		await addPartner(db, { email: 'team@turnverein.example', organization: 'Turnverein West' });
		const payload = partnerPayload(
			[
				organizationRow('100001', 'Gärtnerei Lind', 'info@gaertnerei-lind.example'),
				organizationRow('100009', 'Gärtnerei Lind Filiale', 'info@gaertnerei-lind.example'),
				organizationRow('100010', 'Turnverein', 'team@turnverein.example'),
			],
			ORGANIZATION_RULE,
		);
		await expect(preview(club, payload)).resolves.toMatchObject({
			counts: { ...NO_COUNTS, created: 1, takenOver: 1, unchanged: 1 },
		});
		await expect(importPartners(club, payload)).resolves.toMatchObject({
			counts: { changed: 1, created: 1, removed: 0 },
		});
		await expect(storedPartners(db)).resolves.toStrictEqual([
			['100001', 'Gärtnerei Lind'],
			['100009', 'Gärtnerei Lind Filiale'],
			['100010', 'Turnverein'],
			[null, 'Turnverein Ost'],
			[null, 'Turnverein West'],
		]);
		await expect(storedPartner(db, branchId)).resolves.toMatchObject({
			customerNumber: '100009',
		});
	});

	it('merges two rows of one partner and keeps matched partners out of the missing ones', async () => {
		const club = await setUp();
		const { db } = club;
		const manualId = await addPartner(db, {
			email: 'kontakt@autohaus-weber.example',
			organization: 'Autohaus Weber',
		});
		await addPartner(db, {
			customerNumber: '100002',
			email: 'info@gaertnerei-lind.example',
			organization: 'Gärtnerei Lind',
		});
		const payload = partnerPayload(
			[
				// Takes the manual partner over …
				organizationRow('100007', 'Autohaus Weber', 'kontakt@autohaus-weber.example'),
				// … and this row, without number, finds it again by its address.
				organizationRow('', 'Autohaus Weber GmbH', 'kontakt@autohaus-weber.example'),
				// Found by address: the partner is in the export, though its number is not.
				organizationRow('', 'Gärtnerei Lind', 'info@gaertnerei-lind.example'),
			],
			ORGANIZATION_RULE,
		);
		await expect(preview(club, payload)).resolves.toMatchObject({
			changes: [
				{
					...PLAIN,
					fields: ['customerNumber', 'organization'],
					name: nameOf('Autohaus Weber GmbH'),
					number: '100007',
					type: 'changed',
				},
			],
			counts: { ...NO_COUNTS, takenOver: 1, unchanged: 1 },
			notInExport: [],
			rowIssues: [],
		});
		await expect(importPartners(club, payload)).resolves.toMatchObject({
			counts: { changed: 1, created: 0, removed: 0 },
			ok: true,
		});
		await expect(storedPartners(db)).resolves.toStrictEqual([
			['100002', 'Gärtnerei Lind'],
			['100007', 'Autohaus Weber GmbH'],
		]);
		await expect(storedPartner(db, manualId)).resolves.toMatchObject({
			customerNumber: '100007',
		});
	});

	it('never overwrites stored values with empty cells or field errors and lists them', async () => {
		const club = await setUp();
		const id = await addPartner(club.db, {
			customerNumber: '100001',
			email: 'lena.berger@example.org',
			firstName: 'Lena',
			gender: 'female',
			lastName: 'Berger',
		});
		const payload = partnerPayload([['100001', 'Berger', '-', 'lena@', 'weiblich']]);
		const p = await preview(club, payload);
		expect(p).toMatchObject({
			changes: [],
			counts: { ...NO_COUNTS, unchanged: 1 },
			fieldIssues: [{ column: 'E-Mail', line: 2, reason: 'invalidEmail' }],
			keptValues: [
				{ column: 'Vorname', line: 2 },
				{ column: 'E-Mail', line: 2 },
			],
			moreKeptValues: 0,
		});
		await expect(
			confirm(club, payload, { deleteIds: [], stockVersion: p.stockVersion }),
		).resolves.toStrictEqual({
			counts: { changed: 0, created: 0, removed: 0, warnings: 1 },
			ok: true,
		});
		await expect(storedPartner(club.db, id)).resolves.toMatchObject({
			email: 'lena.berger@example.org',
			firstName: 'Lena',
			gender: 'female',
			lastName: 'Berger',
		});
	});

	it('keeps a stored custom value for an empty cell and merges the others', async () => {
		const club = await setUp();
		const { db } = club;
		const newField: MappedTarget = { name: 'Branche', type: 'newCustomField', valueType: 'text' };
		const rows = [
			organizationRow('100001', 'Bäckerei Körner GmbH', 'info@baeckerei-koerner.example'),
			organizationRow('100002', 'Gasthof Linde', 'info@gasthof-linde.example'),
		];
		const first = withColumn(
			partnerPayload(rows, ORGANIZATION_RULE),
			{ header: 'Branche', target: newField },
			['Handwerk', 'Handel'],
		);
		await expect(importPartners(club, first)).resolves.toMatchObject({ counts: { created: 2 } });
		const field = await onlyPartnerField(db);
		expect(field).toMatchObject({ kind: 'partner', name: 'Branche', protection: 'protected' });

		const savedField: MappedTarget = { customFieldId: field.id, type: 'customField' };
		const next = withColumn(
			partnerPayload(rows, ORGANIZATION_RULE),
			{ header: 'Branche', target: savedField },
			['', 'Gastronomie'],
		);
		await expect(preview(club, next)).resolves.toMatchObject({
			changes: [{ fields: [`custom:${field.id}`], number: '100002', type: 'changed' }],
			counts: { ...NO_COUNTS, unchanged: 1, updated: 1 },
			keptValues: [{ column: 'Branche', line: 2 }],
		});
		await importPartners(club, next);
		const values = await db
			.select({ customValues: contacts.customValues })
			.from(contacts)
			.orderBy(asc(contacts.customerNumber));
		expect(values.map((row) => row.customValues)).toStrictEqual([
			{ [field.id]: 'Handwerk' },
			{ [field.id]: 'Gastronomie' },
		]);
	});

	it('lists kept values only for fields the user may see', async () => {
		const club = await setUp();
		const { admin, db, membersAreaId, partnersAreaId } = club;
		await setFieldAreas(db, admin, {
			areaIds: [membersAreaId],
			fieldKey: 'birthDate',
			kind: 'partner',
		});
		await addPartner(db, {
			birthDate: '1975-03-02',
			customerNumber: '100001',
			email: 'lena.berger@example.org',
			firstName: 'Lena',
			lastName: 'Berger',
		});
		const birthday: MappedTarget = { field: 'birthDate', type: 'field' };
		const payload = withColumn(
			partnerPayload([['100001', 'Berger', 'Lena', '-', 'keine Angabe']]),
			{ header: 'Geburtstag', target: birthday },
			[''],
		);
		const seer = await userWith(db, { [membersAreaId]: 'read', [partnersAreaId]: 'edit' });
		await expect(preview(club, payload)).resolves.toMatchObject({
			keptValues: [{ column: 'E-Mail', line: 2 }],
		});
		await expect(preview(club, payload, seer)).resolves.toMatchObject({
			keptValues: [
				{ column: 'E-Mail', line: 2 },
				{ column: 'Geburtstag', line: 2 },
			],
		});
	});

	it('skips a row that would create a partner without a name', async () => {
		const club = await setUp();
		const payload = partnerPayload([
			['100001', '', '', 'info@ohne-namen.example', 'keine Angabe'],
			['', '-', '-', 'kontakt@ohne-namen.example', ''],
			['100002', 'Berger', 'Lena', 'lena.berger@example.org', 'weiblich'],
		]);
		await expect(preview(club, payload)).resolves.toMatchObject({
			changes: [{ ...PLAIN, name: nameOf('Lena Berger'), number: '100002', type: 'created' }],
			counts: { ...NO_COUNTS, created: 1, skipped: 2 },
			rowIssues: [
				{ line: 2, reason: 'nameMissing' },
				{ line: 3, reason: 'nameMissing' },
			],
		});
		await expect(importPartners(club, payload)).resolves.toStrictEqual({
			counts: { changed: 0, created: 1, removed: 0, warnings: 0 },
			ok: true,
		});
		await expect(storedPartners(club.db)).resolves.toStrictEqual([['100002', null]]);
	});

	it('updates a stored partner from a row without a name and keeps its name', async () => {
		const club = await setUp();
		const { db } = club;
		const bakeryId = await addPartner(db, {
			customerNumber: '100001',
			email: 'info@baeckerei-koerner.example',
			organization: 'Bäckerei Körner GmbH',
		});
		const personId = await addPartner(db, {
			email: 'lena.berger@example.org',
			firstName: 'Lena',
			lastName: 'Berger',
		});
		const payload = partnerPayload(
			[
				['100001', '', '-', 'kontakt@baeckerei-koerner.example', 'keine Angabe'],
				['', '-', '-', 'lena.berger@example.org', 'weiblich'],
			],
			ORGANIZATION_RULE,
		);
		await expect(preview(club, payload)).resolves.toMatchObject({
			changes: [
				{ fields: ['email'], name: nameOf('Bäckerei Körner GmbH'), type: 'changed' },
				{ fields: ['gender'], name: nameOf('Lena Berger'), type: 'changed' },
			],
			counts: { ...NO_COUNTS, updated: 2 },
			keptValues: [
				{ column: 'Nachname', line: 3 },
				{ column: 'Vorname', line: 3 },
			],
			rowIssues: [],
		});
		await expect(importPartners(club, payload)).resolves.toMatchObject({
			counts: { changed: 2, created: 0, removed: 0 },
		});
		const [bakery, person] = [await storedPartner(db, bakeryId), await storedPartner(db, personId)];
		expect(
			[bakery, person].map(({ firstName, lastName, organization }) => [
				organization,
				firstName,
				lastName,
			]),
		).toStrictEqual([
			['Bäckerei Körner GmbH', null, null],
			[null, 'Lena', 'Berger'],
		]);
	});

	it('applies the organization rule', async () => {
		const club = await setUp();
		const { db } = club;
		const storedId = await addPartner(db, {
			customerNumber: '100002',
			email: 'info@metzgerei-koerner.example',
			lastName: 'Körner',
		});
		const payload = partnerPayload(
			[
				organizationRow('100001', 'Bäckerei Körner GmbH', 'info@baeckerei-koerner.example'),
				organizationRow('100002', 'Metzgerei Körner', '-'),
				['100003', 'Berger', 'Lena', 'lena.berger@example.org', ''],
			],
			ORGANIZATION_RULE,
		);
		await expect(preview(club, payload)).resolves.toMatchObject({
			changes: [
				{
					...PLAIN,
					fields: ['organization', 'lastName'],
					name: nameOf('Metzgerei Körner'),
					number: '100002',
					type: 'changed',
				},
				{ ...PLAIN, name: nameOf('Bäckerei Körner GmbH'), number: '100001', type: 'created' },
				{ ...PLAIN, name: nameOf('Lena Berger'), number: '100003', type: 'created' },
			],
			counts: { ...NO_COUNTS, created: 2, updated: 1 },
			keptValues: [{ column: 'E-Mail', line: 3 }],
		});
		await expect(importPartners(club, payload)).resolves.toMatchObject({
			counts: { changed: 1, created: 2, removed: 0 },
		});
		const rows = await db
			.select()
			.from(contacts)
			.where(eq(contacts.kind, 'partner'))
			.orderBy(asc(contacts.customerNumber));
		expect(
			rows.map(({ customerNumber, email, firstName, gender, lastName, organization }) => ({
				customerNumber,
				email,
				firstName,
				gender,
				lastName,
				organization,
			})),
		).toStrictEqual([
			{
				customerNumber: '100001',
				email: 'info@baeckerei-koerner.example',
				firstName: null,
				gender: 'unspecified',
				lastName: null,
				organization: 'Bäckerei Körner GmbH',
			},
			{
				customerNumber: '100002',
				email: 'info@metzgerei-koerner.example',
				firstName: null,
				gender: 'unspecified',
				lastName: null,
				organization: 'Metzgerei Körner',
			},
			// A person keeps the names; a gender without value is `unspecified`.
			{
				customerNumber: '100003',
				email: 'lena.berger@example.org',
				firstName: 'Lena',
				gender: 'unspecified',
				lastName: 'Berger',
				organization: null,
			},
		]);
		expect(rows[1]?.id).toBe(storedId);
	});

	it('lists partners missing from the export and deletes only the ticked ones', async () => {
		const club = await setUp();
		const { db } = club;
		/**
		 * Stores a partner of the export.
		 *
		 * @param number Its customer number.
		 * @returns Its id.
		 */
		const exported = async (number: string): Promise<string> =>
			addPartner(db, {
				customerNumber: number,
				email: `partner.${number}@example.org`,
				organization: `Partner ${number}`,
			});
		// Stored out of order: the list is sorted by number.
		await exported('100001');
		const thirdId = await exported('100003');
		const secondId = await exported('100002');
		await addPartner(db, { email: 'hand@example.org', organization: 'Von Hand' });
		const payload = partnerPayload(
			[organizationRow('100001', 'Partner 100001', 'partner.100001@example.org')],
			ORGANIZATION_RULE,
		);
		const p = await preview(club, payload);
		expect(p).toMatchObject({ changes: [], counts: { ...NO_COUNTS, unchanged: 1 } });
		expect(p.notInExport).toStrictEqual([
			{ customerNumber: '100002', id: secondId, name: nameOf('Partner 100002') },
			{ customerNumber: '100003', id: thirdId, name: nameOf('Partner 100003') },
		]);
		await expect(
			confirm(club, payload, { deleteIds: [secondId], stockVersion: p.stockVersion }),
		).resolves.toStrictEqual({
			counts: { changed: 0, created: 0, removed: 1, warnings: 0 },
			ok: true,
		});
		await expect(storedPartners(db)).resolves.toStrictEqual([
			['100001', 'Partner 100001'],
			['100003', 'Partner 100003'],
			[null, 'Von Hand'],
		]);
	});

	it('refuses a delete selection outside the list', async () => {
		const club = await setUp();
		const { db } = club;
		const listedId = await addPartner(db, {
			customerNumber: '100002',
			email: 'partner.100002@example.org',
			organization: 'Partner 100002',
		});
		const inFileId = await addPartner(db, {
			customerNumber: '100001',
			email: 'partner.100001@example.org',
			organization: 'Partner 100001',
		});
		const manualId = await addPartner(db, { email: 'hand@example.org', organization: 'Von Hand' });
		const payload = partnerPayload(
			[organizationRow('100001', 'Partner 100001 neu', 'partner.100001@example.org')],
			ORGANIZATION_RULE,
		);
		const p = await preview(club, payload);
		expect(p.notInExport.map((partner) => partner.id)).toStrictEqual([listedId]);
		const unknownId = '00000000-0000-4000-8000-000000000000';
		const outcomes = [
			await confirm(club, payload, { deleteIds: [manualId], stockVersion: p.stockVersion }),
			await confirm(club, payload, {
				deleteIds: [listedId, inFileId],
				stockVersion: p.stockVersion,
			}),
			await confirm(club, payload, { deleteIds: [unknownId], stockVersion: p.stockVersion }),
		];
		expect(outcomes).toStrictEqual(outcomes.map(() => ({ failure: 'stockChanged', ok: false })));
		await expect(storedPartners(db)).resolves.toStrictEqual([
			['100001', 'Partner 100001'],
			['100002', 'Partner 100002'],
			[null, 'Von Hand'],
		]);
		await expect(importAudit(db)).resolves.toStrictEqual([]);
	});

	it('blocks duplicate customer numbers and rows without number and email', async () => {
		const club = await setUp();
		await addPartner(club.db, {
			customerNumber: '100005',
			email: 'info@sportpark.example',
			organization: 'Sportpark Nord',
		});
		const payload = partnerPayload(
			[
				organizationRow('100001', 'Bäckerei Körner GmbH', 'info@baeckerei-koerner.example'),
				organizationRow('100001', 'Metzgerei Körner', 'info@metzgerei-koerner.example'),
				organizationRow('', 'Ohne Schlüssel', '-'),
			],
			ORGANIZATION_RULE,
		);
		const p = await preview(club, payload);
		// Without reliable keys the preview does not compare the file with the stock.
		expect(p).toMatchObject({
			blocking: [
				{ firstLine: 2, line: 3, reason: 'numberDuplicate' },
				{ line: 4, reason: 'partnerKeyMissing' },
			],
			changes: [],
			counts: NO_COUNTS,
			keptValues: [],
			notInExport: [],
			rowIssues: [],
		});
		await expect(
			confirm(club, payload, { deleteIds: [], stockVersion: p.stockVersion }),
		).resolves.toStrictEqual({ failure: 'blocked', ok: false });
		await expect(storedPartners(club.db)).resolves.toStrictEqual([['100005', 'Sportpark Nord']]);
	});

	it('writes nothing when a confirm is refused', async () => {
		const club = await setUp();
		const { db, importer } = club;
		const storedId = await addPartner(db, {
			customerNumber: '100001',
			email: 'info@baeckerei-koerner.example',
			organization: 'Bäckerei Körner GmbH',
		});
		const newField: MappedTarget = { name: 'Branche', type: 'newCustomField', valueType: 'text' };
		const branch = { header: 'Branche', target: newField };
		const payload = withColumn(
			partnerPayload(
				[organizationRow('100001', 'Bäckerei Körner', 'info@baeckerei-koerner.example')],
				ORGANIZATION_RULE,
			),
			branch,
			['Handwerk'],
		);
		const p = await preview(club, payload);
		// The stock changes after the preview.
		await setSuppression(db, importer, storedId, true);
		const blocked = withColumn(
			partnerPayload(
				[
					organizationRow('100001', 'Bäckerei Körner', 'info@baeckerei-koerner.example'),
					organizationRow('100001', 'Bäckerei Körner', 'info@baeckerei-koerner.example'),
				],
				ORGANIZATION_RULE,
			),
			branch,
			['Handwerk', 'Handwerk'],
		);
		const fresh = await preview(club, blocked);
		const outcomes = [
			await confirm(club, payload, { deleteIds: [], stockVersion: p.stockVersion }),
			await confirm(club, blocked, { deleteIds: [], stockVersion: fresh.stockVersion }),
		];
		expect(outcomes).toStrictEqual([
			{ failure: 'stockChanged', ok: false },
			{ failure: 'blocked', ok: false },
		]);
		// No custom field, no saved mapping, no audit entry; only the suppression bumped the version.
		expect({
			audit: await importAudit(db),
			customFields: await listCustomFields(db, 'partner'),
			partners: await storedPartners(db),
			state: await getImportState(db, 'partner'),
		}).toStrictEqual({
			audit: [],
			customFields: [],
			partners: [['100001', 'Bäckerei Körner GmbH']],
			state: { kind: 'partner', lastConfirmedAt: null, mapping: null, stockVersion: 1 },
		});
	});

	it('saves the mapping, the import time and a new stock version on confirm', async () => {
		const club = await setUp();
		const { db } = club;
		const payload = {
			...partnerPayload(
				[organizationRow('100001', 'Bäckerei Körner GmbH', 'info@baeckerei-koerner.example')],
				ORGANIZATION_RULE,
			),
			discardedHeaders: ['Typ'],
		};
		const p = await preview(club, payload);
		await expect(getImportState(db, 'partner')).resolves.toStrictEqual({
			kind: 'partner',
			lastConfirmedAt: null,
			mapping: null,
			stockVersion: 0,
		});
		await confirm(club, payload, { deleteIds: [], stockVersion: p.stockVersion });
		const state = await getImportState(db, 'partner');
		expect(state).toMatchObject({ lastConfirmedAt: NOW, stockVersion: 1 });
		const mapping = savedMappingSchema.parse(state.mapping);
		expect(mapping.columns).toMatchObject({
			'E-Mail': { field: 'email', type: 'field' },
			'Nr.': { field: 'customerNumber', type: 'field' },
			Typ: { type: 'discard' },
		});
		expect(mapping.options).toStrictEqual(payload.options);
		// The member import state stays as it is.
		await expect(getImportState(db, 'member')).resolves.toMatchObject({ stockVersion: 0 });
	});

	it('writes an audit entry with counts and without names', async () => {
		const club = await setUp();
		const { db, importer } = club;
		await addPartner(db, {
			customerNumber: '100001',
			email: 'info@baeckerei-koerner.example',
			organization: 'Bäckerei Körner',
		});
		const missingId = await addPartner(db, {
			customerNumber: '100002',
			email: 'info@gasthof-linde.example',
			organization: 'Gasthof Linde',
		});
		await addPartner(db, {
			email: 'kontakt@autohaus-weber.example',
			organization: 'Autohaus Weber',
		});
		const payload = partnerPayload(
			[
				organizationRow('100001', 'Bäckerei Körner GmbH', 'info@baeckerei-koerner.example'),
				organizationRow('100007', 'Autohaus Weber', 'kontakt@autohaus-weber.example'),
				organizationRow('100008', 'Sportpark Nord', 'kein-at'),
			],
			ORGANIZATION_RULE,
		);
		await expect(importPartners(club, payload, [missingId])).resolves.toStrictEqual({
			counts: { changed: 2, created: 1, removed: 1, warnings: 1 },
			ok: true,
		});
		const entries = await importAudit(db);
		expect(entries).toStrictEqual([
			[importer.userId, null, { created: 1, deleted: 1, takenOver: 1, updated: 1, warnings: 1 }],
		]);
		expect(JSON.stringify(entries)).not.toMatch(/Körner|Weber|Linde|Sportpark|example/u);
	});

	it('caps the kept values and the row issues at 1 000 entries', async () => {
		const club = await setUp();
		const many = 1005;
		const numbers = Array.from({ length: many }, (_unused, index) => String(100_001 + index));
		await club.db.insert(contacts).values(
			numbers.map((number) => ({
				customerNumber: number,
				email: `partner.${number}@example.org`,
				kind: 'partner' as const,
				organization: `Partner ${number}`,
			})),
		);
		const payload = partnerPayload(
			[
				// Without address: the stored one stays.
				...numbers.map((number) => organizationRow(number, `Partner ${number}`, '-')),
				// The same address without number again and again.
				...Array.from({ length: many + 1 }, () =>
					organizationRow('', 'Vereinsheim', 'wirt@vereinsheim.example'),
				),
			],
			ORGANIZATION_RULE,
		);
		const p = await preview(club, payload);
		expect({
			counts: p.counts,
			firstRowIssue: p.rowIssues[0],
			keptValues: p.keptValues.length,
			lastKept: p.keptValues.at(-1),
			moreKeptValues: p.moreKeptValues,
			moreRowIssues: p.moreRowIssues,
			rowIssues: p.rowIssues.length,
		}).toStrictEqual({
			counts: { ...NO_COUNTS, created: 1, skipped: many, unchanged: many },
			firstRowIssue: { line: many + 3, reason: 'emailRepeated' },
			keptValues: 1000,
			lastKept: { column: 'E-Mail', line: 1001 },
			moreKeptValues: 5,
			moreRowIssues: 5,
			rowIssues: 1000,
		});
	});

	it('requires edit in the partner area', async () => {
		const club = await setUp();
		const { db, importer, membersAreaId, partnersAreaId } = club;
		const reader = await userWith(db, { [partnersAreaId]: 'read' });
		const membersEditor = await userWith(db, { [membersAreaId]: 'edit' });
		const adminWithoutArea = await userWith(db, {}, { isAdmin: true });
		const partners = partnerPayload(
			[organizationRow('100001', 'Bäckerei Körner GmbH', 'info@baeckerei-koerner.example')],
			ORGANIZATION_RULE,
		);
		// A member payload is no partner import, whoever sends it.
		const members = memberPayload([['1', 'Anna', 'Beispiel', 'anna.1@example.org']]);
		const input = { deleteIds: [], stockVersion: 0 };
		const attempts = [
			...[reader, membersEditor, adminWithoutArea].flatMap((principal) => [
				previewPartnerImport(db, principal, partners, NOW),
				confirmPartnerImport(db, principal, partners, input, NOW),
			]),
			previewPartnerImport(db, importer, members, NOW),
			confirmPartnerImport(db, importer, members, input, NOW),
		];
		const outcomes = attempts.map(async (attempt) => isForbidden(attempt));
		await expect(Promise.all(outcomes)).resolves.toStrictEqual(attempts.map(() => true));
		await expect(db.select().from(contacts)).resolves.toStrictEqual([]);
		await expect(getImportState(db, 'partner')).resolves.toMatchObject({
			lastConfirmedAt: null,
			stockVersion: 0,
		});
	});
});
