import { describe, expect, it } from 'vite-plus/test';

import { createArea } from '@/server/areas/areas';
import type { Db } from '@/server/db/client';
import { contactOptOuts, contacts, contactSuppressions, customFields } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { CONTACTS_PAGE_SIZE, getContact, listContacts, MAX_SEARCH_LENGTH } from './contacts';
import type { ContactDetail, ContactFilters, ContactListPage } from './contacts';
import type { ContactKind, CustomFieldType, Protection } from './fields';
import { insertContact, setUpClub, userWith } from './testing';

/** 00:30 in Berlin on 2026-06-15 while it is still 2026-06-14 in UTC. */
const NOW = new Date('2026-06-14T22:30:00Z');

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

/** What a test asks the list for; everything but the kind is optional. */
type ListInput = Readonly<{
	kind: ContactKind;
	query?: string;
	filters?: Readonly<ContactFilters>;
	page?: number;
}>;

/**
 * Lists one page of a kind at `NOW`.
 *
 * @param db The database.
 * @param principal Who asks.
 * @param input The kind and optionally search, filters and page (default 1).
 * @returns The page.
 */
async function list(db: Db, principal: Principal, input: ListInput): Promise<ContactListPage> {
	return listContacts(
		db,
		principal,
		{
			filters: input.filters ?? {},
			kind: input.kind,
			page: input.page ?? 1,
			query: input.query ?? '',
		},
		NOW,
	);
}

/**
 * The numbers of the listed contacts in list order.
 *
 * @param db The database.
 * @param principal Who asks.
 * @param input The kind and optionally search, filters and page.
 * @returns The numbers.
 */
async function listNumbers(
	db: Db,
	principal: Principal,
	input: ListInput,
): Promise<(string | null)[]> {
	const page = await list(db, principal, input);
	return page.items.map((item) => item.number);
}

/**
 * The primary names of the listed contacts in list order.
 *
 * @param db The database.
 * @param principal Who asks.
 * @param input The kind and optionally search, filters and page.
 * @returns The names.
 */
async function listNames(db: Db, principal: Principal, input: ListInput): Promise<string[]> {
	const page = await list(db, principal, input);
	return page.items.map((item) => item.name.primary);
}

/**
 * Shows a contact that must exist.
 *
 * @param db The database.
 * @param principal Who asks.
 * @param contactId The contact.
 * @returns The detail.
 */
async function detail(db: Db, principal: Principal, contactId: string): Promise<ContactDetail> {
	const found = await getContact(db, principal, contactId);
	if (found === null) throw new Error('The contact was not found.');
	return found;
}

/**
 * Creates a custom field with a fixed creation time, so the order of the fields is certain.
 *
 * @param db The database.
 * @param field The kind, name, type, protection and creation time.
 * @returns The id of the field.
 */
async function insertField(
	db: Db,
	field: Readonly<{
		kind: ContactKind;
		name: string;
		type: CustomFieldType;
		protection: Protection;
		createdAt: string;
	}>,
): Promise<string> {
	const [row] = await db
		.insert(customFields)
		.values({ ...field, createdAt: new Date(field.createdAt) })
		.returning({ id: customFields.id });
	if (row === undefined) throw new Error('Inserting the custom field returned no row.');
	return row.id;
}

describe(getContact, () => {
	it('delivers protected member fields only with read in the members area', async () => {
		const db = await createTestDb();
		const { membersAreaId, partnersAreaId } = await setUpClub(db);
		const id = await insertContact(db, {
			birthDate: '1980-05-17',
			exitDate: '2030-01-01',
			firstName: 'Anna',
			kind: 'member',
			lastName: 'Abel',
			memberNumber: '7',
			street: 'Lindenweg 3',
		});
		const seen = await detail(db, await userWith(db, { [partnersAreaId]: 'read' }), id);
		expect(seen.protectedValues).toStrictEqual({});
		expect(JSON.stringify(seen)).not.toMatch(/1980-05-17|2030-01-01|Lindenweg/u);
		expect(seen).toMatchObject({
			firstName: 'Anna',
			kind: 'member',
			lastName: 'Abel',
			memberNumber: '7',
			name: { primary: 'Anna Abel', secondary: null },
		});
		const members = await detail(db, await userWith(db, { [membersAreaId]: 'read' }), id);
		expect(members.protectedValues).toStrictEqual({
			birthDate: '1980-05-17',
			exitDate: '2030-01-01',
			street: 'Lindenweg 3',
		});
	});

	it('protects partner fields by the partner area', async () => {
		const db = await createTestDb();
		const { membersAreaId, partnersAreaId } = await setUpClub(db);
		const id = await insertContact(db, {
			birthDate: '1975-03-02',
			city: 'Musterstadt',
			customerNumber: '100001',
			kind: 'partner',
			organization: 'Körner GmbH',
			postalCode: '99441',
			street: 'Marktplatz 1',
		});
		const members = await detail(db, await userWith(db, { [membersAreaId]: 'read' }), id);
		expect(members.protectedValues).toStrictEqual({});
		expect(JSON.stringify(members)).not.toMatch(/1975-03-02|Marktplatz|Musterstadt|"99441"/u);
		expect(members).toMatchObject({
			customerNumber: '100001',
			memberNumber: null,
			name: { primary: 'Körner GmbH', secondary: null },
			organization: 'Körner GmbH',
		});
		const finance = await detail(db, await userWith(db, { [partnersAreaId]: 'read' }), id);
		expect(finance.protectedValues).toStrictEqual({
			birthDate: '1975-03-02',
			city: 'Musterstadt',
			postalCode: '99441',
			street: 'Marktplatz 1',
		});
	});

	it('hides protected custom values and shows base ones', async () => {
		const db = await createTestDb();
		const { membersAreaId, partnersAreaId } = await setUpClub(db);
		const noteId = await insertField(db, {
			createdAt: '2026-01-01T00:00:00Z',
			kind: 'member',
			name: 'Notiz',
			protection: 'protected',
			type: 'text',
		});
		const sizeId = await insertField(db, {
			createdAt: '2026-01-02T00:00:00Z',
			kind: 'member',
			name: 'Trikotgröße',
			protection: 'base',
			type: 'text',
		});
		const sinceId = await insertField(db, {
			createdAt: '2026-01-03T00:00:00Z',
			kind: 'member',
			name: 'Ehrenamt seit',
			protection: 'base',
			type: 'date',
		});
		const branchId = await insertField(db, {
			createdAt: '2026-01-04T00:00:00Z',
			kind: 'partner',
			name: 'Branche',
			protection: 'base',
			type: 'text',
		});
		const id = await insertContact(db, {
			// A value of a partner field does not belong to a member and is never shown.
			customValues: { [branchId]: 'Fremdwert', [noteId]: 'Knie-OP', [sinceId]: '', [sizeId]: 'XL' },
			kind: 'member',
			memberNumber: '7',
		});
		const size = { id: sizeId, name: 'Trikotgröße', type: 'text', value: 'XL' };

		const finance = await detail(db, await userWith(db, { [partnersAreaId]: 'read' }), id);
		expect(finance.customValues).toStrictEqual([size]);
		expect(JSON.stringify(finance)).not.toMatch(/Knie-OP|Fremdwert/u);

		const members = await detail(db, await userWith(db, { [membersAreaId]: 'read' }), id);
		expect(members.customValues).toStrictEqual([
			{ id: noteId, name: 'Notiz', type: 'text', value: 'Knie-OP' },
			size,
		]);
		expect(JSON.stringify(members)).not.toMatch(/Fremdwert/u);
	});

	it('shows suppression and opt-outs, and all areas only to managers', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		const { areaId: youthAreaId } = await createArea(db, admin, 'jugend');
		const id = await insertContact(db, { kind: 'member', memberNumber: '7' });
		const other = await insertContact(db, { kind: 'member', memberNumber: '8' });
		await insertContact(db, { customerNumber: '8', kind: 'partner' });
		await db.insert(contactSuppressions).values([
			{ contactKey: 'nr:7', createdAt: new Date('2026-05-01T08:00:00Z'), kind: 'member' },
			// The partner 8 is suppressed, the member 8 is not: the kind is part of the key.
			{ contactKey: 'nr:8', kind: 'partner' },
		]);
		await db.insert(contactOptOuts).values([
			{
				areaId: youthAreaId,
				contactKey: 'nr:7',
				createdAt: new Date('2026-05-02T09:00:00Z'),
				kind: 'member',
				scope: 'area',
			},
			{
				areaId: partnersAreaId,
				contactKey: 'nr:7',
				createdAt: new Date('2026-05-03T10:00:00Z'),
				kind: 'member',
				scope: 'area',
			},
			{ areaId: membersAreaId, contactKey: 'nr:8', kind: 'partner', scope: 'area' },
			{ contactKey: 'nr:7', kind: 'member', occasionId: UNKNOWN_ID, scope: 'occasion' },
		]);

		const reader = await detail(db, await userWith(db, { [membersAreaId]: 'read' }), id);
		expect(reader).toMatchObject({
			areas: [],
			canManage: false,
			// Sorted by lower(name): "Finanzen" before "jugend"; the occasion opt-out is no area's.
			optOuts: [
				{ areaId: partnersAreaId, areaName: 'Finanzen', at: '2026-05-03T10:00:00.000Z' },
				{ areaId: youthAreaId, areaName: 'jugend', at: '2026-05-02T09:00:00.000Z' },
			],
			suppression: { at: '2026-05-01T08:00:00.000Z' },
		});

		const manager = await detail(db, await userWith(db, { [membersAreaId]: 'edit' }), id);
		expect(manager).toMatchObject({
			areas: [
				{ id: partnersAreaId, name: 'Finanzen' },
				{ id: youthAreaId, name: 'jugend' },
				{ id: membersAreaId, name: 'Mitglieder' },
			],
			canManage: true,
		});

		const partnerManager = await userWith(db, { [partnersAreaId]: 'edit' });
		await expect(detail(db, partnerManager, other)).resolves.toMatchObject({
			areas: [],
			canManage: false,
			optOuts: [],
			suppression: null,
		});
	});

	it('returns null for an unknown or malformed id', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await expect(getContact(db, admin, UNKNOWN_ID)).resolves.toBeNull();
		await expect(getContact(db, admin, 'not-a-uuid')).resolves.toBeNull();
	});

	it('refuses users without any area', async () => {
		const db = await createTestDb();
		await setUpClub(db);
		const id = await insertContact(db, { kind: 'member', memberNumber: '7' });
		const nobody = await userWith(db, {}, { isAdmin: true });
		await expect(getContact(db, nobody, id)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(getContact(db, nobody, UNKNOWN_ID)).rejects.toBeInstanceOf(ForbiddenError);
	});
});

describe(listContacts, () => {
	it('searches name, organization, email and number ignoring case', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await insertContact(db, {
			email: 'anna@abel.example',
			firstName: 'Anna',
			kind: 'member',
			lastName: 'Abel',
			memberNumber: '7',
		});
		await insertContact(db, {
			firstName: 'Bert',
			kind: 'member',
			lastName: 'Berg',
			memberNumber: '8',
		});
		await insertContact(db, {
			customerNumber: '100001',
			email: 'info@koerner.example',
			kind: 'partner',
			organization: 'Körner GmbH',
		});
		await insertContact(db, {
			email: 'kontakt@example.org',
			firstName: 'Clara',
			kind: 'partner',
			lastName: 'Christ',
		});
		await insertContact(db, {
			customerNumber: '100002',
			kind: 'partner',
			organization: 'Adler AG',
		});

		const member = async (query: string): Promise<(string | null)[]> =>
			listNumbers(db, admin, { kind: 'member', query });
		const partner = async (query: string): Promise<string[]> =>
			listNames(db, admin, { kind: 'partner', query });
		const members = {
			byFirstName: await member('BERT'),
			byFullName: await member('anna abel'),
			byLastName: await member('abel'),
			byNumber: await member('8'),
			otherKind: await member('körner'),
		};
		expect(members).toStrictEqual({
			byFirstName: ['8'],
			byFullName: ['7'],
			byLastName: ['7'],
			byNumber: ['8'],
			otherKind: [],
		});
		const partners = {
			all: await partner(''),
			byCustomerNumber: await partner('  100001 '),
			byEmail: await partner('EXAMPLE.ORG'),
			byOrganization: await partner('körner'),
			byPartOfNumber: await partner('10000'),
		};
		expect(partners).toStrictEqual({
			all: ['Adler AG', 'Clara Christ', 'Körner GmbH'],
			byCustomerNumber: ['Körner GmbH'],
			byEmail: ['Clara Christ'],
			byOrganization: ['Körner GmbH'],
			byPartOfNumber: ['Adler AG', 'Körner GmbH'],
		});
	});

	it('cuts the search to its maximum length', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const longName = 'L'.repeat(MAX_SEARCH_LENGTH);
		await insertContact(db, { kind: 'member', lastName: longName, memberNumber: '1' });
		await expect(
			listNumbers(db, admin, { kind: 'member', query: `${longName}Q` }),
		).resolves.toStrictEqual(['1']);
	});

	it('searches %, _ and backslash literally', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const partner = async (query: string): Promise<(string | null)[]> =>
			listNumbers(db, admin, { kind: 'partner', query });
		await insertContact(db, { customerNumber: '10_0', kind: 'partner' });
		await insertContact(db, { customerNumber: '100', kind: 'partner' });
		const before = {
			backslash: await partner('a\\'),
			percent: await partner('%'),
			underscore: await partner('10_'),
		};
		expect(before).toStrictEqual({ backslash: [], percent: [], underscore: ['10_0'] });

		// Unescaped, `a\` would match "Extra%" (`\%` is a literal percent) and `k\s` would miss
		// "Back\slash" (`\s` is a plain `s`).
		await insertContact(db, { customerNumber: '200', kind: 'partner', organization: 'Extra%' });
		await insertContact(db, {
			customerNumber: '201',
			kind: 'partner',
			organization: String.raw`Back\slash`,
		});
		const after = {
			backslash: await partner('a\\'),
			backslashInside: await partner(String.raw`k\s`),
			percent: await partner('%'),
		};
		expect(after).toStrictEqual({ backslash: [], backslashInside: ['201'], percent: ['200'] });
	});

	it('refuses the exit filter without access to the exit date', async () => {
		const db = await createTestDb();
		const { membersAreaId, partnersAreaId } = await setUpClub(db);
		await insertContact(db, { exitDate: '2026-01-01', kind: 'member', memberNumber: '1' });
		const finance = await userWith(db, { [partnersAreaId]: 'read' });
		const members = await userWith(db, { [membersAreaId]: 'read' });
		await expect(
			list(db, finance, { filters: { exit: 'reached' }, kind: 'member' }),
		).rejects.toBeInstanceOf(ForbiddenError);
		// Partners have no exit date.
		await expect(
			list(db, members, { filters: { exit: 'planned' }, kind: 'partner' }),
		).rejects.toBeInstanceOf(ForbiddenError);

		const financePage = await list(db, finance, { kind: 'member' });
		const membersPage = await list(db, members, { kind: 'member' });
		const partnersPage = await list(db, members, { kind: 'partner' });
		const offered = {
			financeMembers: financePage.canFilterExit,
			membersMembers: membersPage.canFilterExit,
			membersPartners: partnersPage.canFilterExit,
		};
		expect(offered).toStrictEqual({
			financeMembers: false,
			membersMembers: true,
			membersPartners: false,
		});
		expect(financePage.total).toBe(1);
		await expect(
			listNumbers(db, members, { filters: { exit: 'reached' }, kind: 'member' }),
		).resolves.toStrictEqual(['1']);
	});

	it('filters by group, missing email, suppression and exit', async () => {
		const db = await createTestDb();
		const { membersAreaId } = await setUpClub(db);
		await insertContact(db, {
			email: 'm1@example.org',
			groups: ['Fußball', 'Aktiv'],
			kind: 'member',
			lastName: 'Name1',
			memberNumber: '1',
		});
		await insertContact(db, {
			groups: ['Passiv'],
			kind: 'member',
			lastName: 'Name2',
			memberNumber: '2',
		});
		await insertContact(db, {
			email: 'm3@example.org',
			kind: 'member',
			lastName: 'Name3',
			memberNumber: '3',
		});
		await insertContact(db, {
			email: 'm4@example.org',
			exitDate: '2026-06-14',
			kind: 'member',
			lastName: 'Name4',
			memberNumber: '4',
		});
		// Today in Berlin, still tomorrow in UTC.
		await insertContact(db, {
			email: 'm5@example.org',
			exitDate: '2026-06-15',
			kind: 'member',
			lastName: 'Name5',
			memberNumber: '5',
		});
		await insertContact(db, {
			email: 'm6@example.org',
			exitDate: '2026-06-16',
			kind: 'member',
			lastName: 'Name6',
			memberNumber: '6',
		});
		await insertContact(db, { customerNumber: '2', kind: 'partner' });
		await db.insert(contactSuppressions).values([
			{ contactKey: 'nr:3', kind: 'member' },
			{ contactKey: 'nr:2', kind: 'partner' },
		]);
		const reader = await userWith(db, { [membersAreaId]: 'read' });
		const filtered = async (filters: Readonly<ContactFilters>): Promise<(string | null)[]> =>
			listNumbers(db, reader, { filters, kind: 'member' });

		const all = await list(db, reader, { kind: 'member' });
		expect(all.items.map((item) => [item.number, item.suppressed])).toStrictEqual([
			['1', false],
			['2', false],
			['3', true],
			['4', false],
			['5', false],
			['6', false],
		]);
		expect(all.groups).toStrictEqual(['Aktiv', 'Fußball', 'Passiv']);
		// The count goes through the condition, the list through the join.
		await expect(
			list(db, reader, { filters: { suppressed: true }, kind: 'member' }),
		).resolves.toMatchObject({ total: 1 });
		expect(all.items[0]).toMatchObject({
			email: 'm1@example.org',
			groups: ['Fußball', 'Aktiv'],
			tags: [],
		});
		const results = {
			exitPlanned: await filtered({ exit: 'planned' }),
			exitReached: await filtered({ exit: 'reached' }),
			group: await filtered({ group: 'Fußball' }),
			groupWithEmail: await filtered({ group: 'Fußball', withoutEmail: true }),
			groupWithoutEmail: await filtered({ group: 'Passiv', withoutEmail: true }),
			suppressed: await filtered({ suppressed: true }),
			uncheckedBoxes: await filtered({ suppressed: false, withoutEmail: false }),
			withoutEmail: await filtered({ withoutEmail: true }),
		};
		expect(results).toStrictEqual({
			exitPlanned: ['6'],
			exitReached: ['4', '5'],
			group: ['1'],
			groupWithEmail: [],
			groupWithoutEmail: ['2'],
			suppressed: ['3'],
			uncheckedBoxes: ['1', '2', '3', '4', '5', '6'],
			withoutEmail: ['2'],
		});
	});

	it('filters partners by tag ignoring case', async () => {
		const db = await createTestDb();
		const { partnersAreaId } = await setUpClub(db);
		await insertContact(db, {
			createdAt: new Date('2026-01-01T00:00:00Z'),
			customerNumber: '1',
			kind: 'partner',
			tags: ['Sponsor'],
		});
		await insertContact(db, {
			createdAt: new Date('2026-01-02T00:00:00Z'),
			customerNumber: '2',
			kind: 'partner',
			tags: ['sponsor', 'Presse'],
		});
		await insertContact(db, { customerNumber: '3', kind: 'partner' });
		const reader = await userWith(db, { [partnersAreaId]: 'read' });
		const all = await list(db, reader, { kind: 'partner' });
		// One entry per tag ignoring case, spelled as the oldest partner spells it.
		expect(all.tags).toStrictEqual(['Presse', 'Sponsor']);
		expect(all.groups).toStrictEqual([]);
		expect(all.items[1]).toMatchObject({ groups: [], number: '2', tags: ['sponsor', 'Presse'] });
		await expect(
			listNumbers(db, reader, { filters: { tag: 'SPONSOR' }, kind: 'partner' }),
		).resolves.toStrictEqual(['1', '2']);
		await expect(
			listNumbers(db, reader, { filters: { tag: 'presse' }, kind: 'partner' }),
		).resolves.toStrictEqual(['2']);
	});

	it('pages by 50 sorted by organization or last name', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const people = Array.from({ length: 48 }, (_, index) => ({
			kind: 'member' as const,
			lastName: `Mueller${String(index).padStart(2, '0')}`,
			memberNumber: `M${index}`,
		}));
		await db.insert(contacts).values([
			...people,
			// Without lower() "Zimmer" would come before "zimmer"; with it the first name decides.
			{ firstName: 'Bert', kind: 'member', lastName: 'Zimmer', memberNumber: 'B' },
			{ firstName: 'Anna', kind: 'member', lastName: 'zimmer', memberNumber: 'A' },
			{ kind: 'member', lastName: 'Zorn', memberNumber: 'Z', organization: 'Adler AG' },
		]);
		expect(CONTACTS_PAGE_SIZE).toBe(50);
		const first = await list(db, admin, { kind: 'member' });
		const firstNumbers = first.items.map((item) => item.number);
		expect({
			count: firstNumbers.length,
			head: firstNumbers.slice(0, 3),
			last: firstNumbers.at(-1),
			name: first.items[0]?.name,
			page: first.page,
			total: first.total,
		}).toStrictEqual({
			count: 50,
			head: ['Z', 'M0', 'M1'],
			last: 'A',
			name: { primary: 'Adler AG', secondary: 'Zorn' },
			page: 1,
			total: 51,
		});

		const second = await list(db, admin, { kind: 'member', page: 2 });
		expect({
			numbers: second.items.map((item) => item.number),
			page: second.page,
			total: second.total,
		}).toStrictEqual({ numbers: ['B'], page: 2, total: 51 });

		await expect(list(db, admin, { kind: 'member', page: 3 })).resolves.toMatchObject({
			items: [],
			page: 3,
			total: 51,
		});
	});

	it('refuses a page below 1 or between two pages', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await expect(list(db, admin, { kind: 'member', page: 0 })).rejects.toThrow('page');
		await expect(list(db, admin, { kind: 'member', page: 1.5 })).rejects.toThrow('page');
	});

	it('refuses users without any area', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const nobody = await userWith(db, {}, { isAdmin: true });
		await expect(list(db, nobody, { kind: 'member' })).rejects.toBeInstanceOf(ForbiddenError);
		await expect(list(db, admin, { kind: 'member' })).resolves.toMatchObject({ total: 0 });
	});
});
