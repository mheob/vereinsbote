import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { createArea } from '@/server/areas/areas';
import type { Db } from '@/server/db/client';
import {
	auditLog,
	contactOptOuts,
	contacts,
	contactSuppressions,
	customFields,
} from '@/server/db/schema';
import type { ContactRecord } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { ContactNotFoundError } from './errors';
import type { ContactKind, CustomFieldType } from './fields';
import { getImportState } from './import-state';
import type { PartnerInput } from './partner-form';
import {
	createPartner,
	CustomerNumberTakenError,
	deletePartner,
	getPartnerForm,
	listTags,
	PartnerInputInvalidError,
	savePartner,
	updatePartner,
} from './partners';
import { setFieldAreas } from './settings';
import { insertContact, setUpClub, userWith } from './testing';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const stadtwerke: PartnerInput = {
	customerNumber: '',
	email: 'presse@stadtwerke.example',
	firstName: '',
	gender: 'unspecified',
	lastName: '',
	organization: 'Stadtwerke',
	tags: [],
};

/** A club and a partner editor: `edit` in the partners area "Finanzen". */
interface PartnerClub {
	readonly admin: Principal;
	readonly editor: Principal;
	readonly membersAreaId: string;
	readonly partnersAreaId: string;
}

/**
 * Sets up a club with a partner editor.
 *
 * @param db The test database.
 * @returns The admin, the editor and the two areas.
 */
async function partnerClub(db: Db): Promise<PartnerClub> {
	const club = await setUpClub(db);
	const editor = await userWith(db, { [club.partnersAreaId]: 'edit' });
	return { ...club, editor };
}

/**
 * The partner stock version.
 *
 * @param db The test database.
 * @returns The version.
 */
async function partnerVersion(db: Db): Promise<number> {
	const state = await getImportState(db, 'partner');
	return state.stockVersion;
}

/**
 * The audit entries of partner upkeep, oldest first.
 *
 * @param db The test database.
 * @returns Action, target and details per entry.
 */
async function partnerAudit(
	db: Db,
): Promise<{ action: string; target: string | null; details: unknown }[]> {
	const entries = await db.select().from(auditLog).orderBy(auditLog.id);
	return entries
		.filter((entry) => entry.action.startsWith('partner.'))
		.map(({ action, details, target }) => ({ action, details, target }));
}

/**
 * Reads a stored contact.
 *
 * @param db The test database.
 * @param id The contact.
 * @returns The row.
 */
async function stored(db: Db, id: string): Promise<ContactRecord> {
	const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
	if (row === undefined) throw new Error('The contact does not exist.');
	return row;
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
 * The area opt-outs of the partners as `<key> <areaId>`, sorted.
 *
 * @param db The test database.
 * @returns The opt-outs.
 */
async function optOutKeys(db: Db): Promise<string[]> {
	const rows = await db
		.select({ areaId: contactOptOuts.areaId, key: contactOptOuts.contactKey })
		.from(contactOptOuts)
		.where(eq(contactOptOuts.kind, 'partner'));
	return rows.map((row) => `${row.key} ${row.areaId}`).toSorted();
}

/**
 * Inserts a custom field.
 *
 * @param db The test database.
 * @param field The kind, name, type and protection.
 * @returns The id.
 */
async function insertCustomField(
	db: Db,
	field: Readonly<{
		kind: ContactKind;
		name: string;
		type: CustomFieldType;
		protection: 'base' | 'protected';
	}>,
): Promise<string> {
	const [row] = await db.insert(customFields).values(field).returning({ id: customFields.id });
	if (row === undefined) throw new Error('Inserting the custom field returned no row.');
	return row.id;
}

describe(createPartner, () => {
	it('requires edit in the partner area', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await partnerClub(db);
		const partnerId = await insertContact(db, {
			email: 'presse@stadtwerke.example',
			kind: 'partner',
			organization: 'Stadtwerke',
		});
		const refused = [
			await userWith(db, { [partnersAreaId]: 'read' }),
			await userWith(db, { [membersAreaId]: 'edit' }),
			await userWith(db, {}, { isAdmin: true }),
			admin,
		];
		for (const principal of refused) {
			// oxlint-disable-next-line no-await-in-loop -- one refusal after the other
			await expect(createPartner(db, principal, stadtwerke)).rejects.toBeInstanceOf(ForbiddenError);
			// oxlint-disable-next-line no-await-in-loop -- see above
			await expect(
				updatePartner(db, principal, partnerId, { ...stadtwerke, organization: 'Neu' }),
			).rejects.toBeInstanceOf(ForbiddenError);
			// oxlint-disable-next-line no-await-in-loop -- see above
			await expect(deletePartner(db, principal, partnerId)).rejects.toBeInstanceOf(ForbiddenError);
		}
		const rows = await db.select().from(contacts);
		expect(rows.map((row) => row.organization)).toStrictEqual(['Stadtwerke']);
		await expect(partnerVersion(db)).resolves.toBe(0);
		await expect(partnerAudit(db)).resolves.toStrictEqual([]);
	});

	it('creates, updates and deletes a partner and bumps the stock version', async () => {
		const db = await createTestDb();
		const { editor } = await partnerClub(db);
		const { contactId } = await createPartner(db, editor, {
			...stadtwerke,
			email: ' Presse@Stadtwerke.Example ',
			gender: 'diverse',
			street: 'Hauptstr. 1',
			tags: ['Sponsor', ' presse ', 'SPONSOR'],
		});
		const created = await stored(db, contactId);
		const versions = [await partnerVersion(db)];
		await updatePartner(db, editor, contactId, {
			...stadtwerke,
			firstName: 'Anna',
			lastName: 'Beispiel',
			organization: 'Stadtwerke Nord',
			tags: ['Presse'],
		});
		const updated = await stored(db, contactId);
		versions.push(await partnerVersion(db));
		await deletePartner(db, editor, contactId);
		versions.push(await partnerVersion(db));

		expect(created).toMatchObject({
			birthDate: null,
			city: null,
			contactKey: 'email:presse@stadtwerke.example',
			customValues: {},
			customerNumber: null,
			email: 'presse@stadtwerke.example',
			firstName: null,
			gender: 'diverse',
			groups: [],
			kind: 'partner',
			lastName: null,
			memberNumber: null,
			organization: 'Stadtwerke',
			postalCode: null,
			street: 'Hauptstr. 1',
			tags: ['Sponsor', 'presse'],
		});
		expect(updated).toMatchObject({
			firstName: 'Anna',
			gender: 'unspecified',
			lastName: 'Beispiel',
			organization: 'Stadtwerke Nord',
			// Not passed, so unchanged.
			street: 'Hauptstr. 1',
			tags: ['Presse'],
		});
		expect(versions).toStrictEqual([1, 2, 3]);
		await expect(db.select().from(contacts)).resolves.toStrictEqual([]);
		await expect(partnerAudit(db)).resolves.toMatchObject([
			{ action: 'partner.created' },
			{
				action: 'partner.updated',
				details: { fields: ['organization', 'firstName', 'lastName', 'gender', 'tags'] },
			},
			{ action: 'partner.deleted' },
		]);
	});

	it('stores empty values as NULL and clears a value set to empty', async () => {
		const db = await createTestDb();
		const { editor } = await partnerClub(db);
		const { contactId } = await createPartner(db, editor, {
			...stadtwerke,
			city: ' ',
			customerNumber: '100009',
			firstName: 'Anna',
		});
		await updatePartner(db, editor, contactId, {
			...stadtwerke,
			city: 'Musterstadt',
			customerNumber: '100009',
			email: '',
			firstName: ' ',
		});
		await expect(stored(db, contactId)).resolves.toMatchObject({
			city: 'Musterstadt',
			contactKey: 'nr:100009',
			email: null,
			firstName: null,
		});
	});

	it('refuses invalid input with the fields and writes nothing', async () => {
		const db = await createTestDb();
		const { editor } = await partnerClub(db);
		const empty = { ...stadtwerke, email: '', organization: '' };
		const error: unknown = await createPartner(db, editor, empty).catch(
			(error_: unknown) => error_,
		);
		expect(error).toBeInstanceOf(PartnerInputInvalidError);
		expect(error).toMatchObject({ fields: { email: 'required', name: 'required' } });
		const { contactId } = await createPartner(db, editor, stadtwerke);
		await expect(
			updatePartner(db, editor, contactId, { ...stadtwerke, email: 'presse@', tags: ['x'] }),
		).rejects.toMatchObject({ fields: { email: 'invalid' } });
		await expect(stored(db, contactId)).resolves.toMatchObject({
			email: 'presse@stadtwerke.example',
			tags: [],
		});
		await expect(partnerVersion(db)).resolves.toBe(1);
	});

	it('refuses a customer number another partner has', async () => {
		const db = await createTestDb();
		const { editor } = await partnerClub(db);
		await createPartner(db, editor, { ...stadtwerke, customerNumber: '100009' });
		await expect(
			createPartner(db, editor, { ...stadtwerke, customerNumber: '100009', organization: 'B' }),
		).rejects.toBeInstanceOf(CustomerNumberTakenError);
		const { contactId } = await createPartner(db, editor, {
			...stadtwerke,
			customerNumber: '100010',
		});
		await expect(
			updatePartner(db, editor, contactId, { ...stadtwerke, customerNumber: '100009' }),
		).rejects.toBeInstanceOf(CustomerNumberTakenError);
		await expect(stored(db, contactId)).resolves.toMatchObject({ customerNumber: '100010' });
		await expect(partnerVersion(db)).resolves.toBe(2);
		const error = new CustomerNumberTakenError();
		expect(error.message).not.toContain('100009');
	});
});

describe(updatePartner, () => {
	it('never changes a member', async () => {
		const db = await createTestDb();
		const { editor, membersAreaId, partnersAreaId } = await partnerClub(db);
		const both = await userWith(db, { [membersAreaId]: 'edit', [partnersAreaId]: 'edit' });
		const memberId = await insertContact(db, {
			kind: 'member',
			lastName: 'Mitglied',
			memberNumber: '42',
		});
		for (const principal of [editor, both]) {
			// oxlint-disable-next-line no-await-in-loop -- one refusal after the other
			await expect(updatePartner(db, principal, memberId, stadtwerke)).rejects.toBeInstanceOf(
				ForbiddenError,
			);
			// oxlint-disable-next-line no-await-in-loop -- see above
			await expect(deletePartner(db, principal, memberId)).rejects.toBeInstanceOf(ForbiddenError);
		}
		await expect(stored(db, memberId)).resolves.toMatchObject({
			lastName: 'Mitglied',
			organization: null,
		});
		await expect(updatePartner(db, editor, UNKNOWN_ID, stadtwerke)).rejects.toBeInstanceOf(
			ContactNotFoundError,
		);
		await expect(deletePartner(db, editor, UNKNOWN_ID)).rejects.toBeInstanceOf(
			ContactNotFoundError,
		);
		await expect(partnerVersion(db)).resolves.toBe(0);
	});

	it('refuses protected fields the user may not see', async () => {
		const db = await createTestDb();
		const { admin, editor, membersAreaId } = await partnerClub(db);
		await setFieldAreas(db, admin, {
			areaIds: [membersAreaId],
			fieldKey: 'birthDate',
			kind: 'partner',
		});
		const partnerId = await insertContact(db, {
			birthDate: '1980-05-17',
			email: 'presse@stadtwerke.example',
			kind: 'partner',
			organization: 'Stadtwerke',
		});
		await expect(
			createPartner(db, editor, { ...stadtwerke, birthDate: '' }),
		).rejects.toBeInstanceOf(ForbiddenError);
		await expect(
			updatePartner(db, editor, partnerId, { ...stadtwerke, birthDate: '01.01.1990' }),
		).rejects.toBeInstanceOf(ForbiddenError);
		// The address still belongs to "Finanzen"; a field not passed stays as it is.
		await updatePartner(db, editor, partnerId, { ...stadtwerke, city: 'Musterstadt' });
		await expect(stored(db, partnerId)).resolves.toMatchObject({
			birthDate: '1980-05-17',
			city: 'Musterstadt',
		});
		await setFieldAreas(db, admin, {
			areaIds: [membersAreaId],
			fieldKey: 'address',
			kind: 'partner',
		});
		const addressParts: PartnerInput[] = [
			{ ...stadtwerke, street: 'x' },
			{ ...stadtwerke, postalCode: 'x' },
			{ ...stadtwerke, city: 'x' },
		];
		for (const input of addressParts) {
			// oxlint-disable-next-line no-await-in-loop -- one refusal after the other
			await expect(updatePartner(db, editor, partnerId, input)).rejects.toBeInstanceOf(
				ForbiddenError,
			);
		}
	});

	it('writes only the custom fields the user sees and keeps the others', async () => {
		const db = await createTestDb();
		const { admin, editor, membersAreaId } = await partnerClub(db);
		const visibleId = await insertCustomField(db, {
			kind: 'partner',
			name: 'Vertrag bis',
			protection: 'protected',
			type: 'date',
		});
		const baseId = await insertCustomField(db, {
			kind: 'partner',
			name: 'Ansprechpartner',
			protection: 'base',
			type: 'text',
		});
		const hiddenId = await insertCustomField(db, {
			kind: 'partner',
			name: 'Bonität',
			protection: 'protected',
			type: 'text',
		});
		const memberFieldId = await insertCustomField(db, {
			kind: 'member',
			name: 'Spind',
			protection: 'base',
			type: 'text',
		});
		await setFieldAreas(db, admin, {
			areaIds: [membersAreaId],
			fieldKey: `custom:${hiddenId}`,
			kind: 'partner',
		});
		const partnerId = await insertContact(db, {
			customValues: { [baseId]: 'Frau Beispiel', [hiddenId]: 'gut' },
			email: 'presse@stadtwerke.example',
			kind: 'partner',
			organization: 'Stadtwerke',
		});
		for (const custom of [{ [hiddenId]: 'schlecht' }, { [memberFieldId]: '7' }, { x: 'y' }]) {
			// oxlint-disable-next-line no-await-in-loop -- one refusal after the other
			await expect(
				updatePartner(db, editor, partnerId, { ...stadtwerke, custom }),
			).rejects.toBeInstanceOf(ForbiddenError);
		}
		await expect(
			updatePartner(db, editor, partnerId, {
				...stadtwerke,
				custom: { [visibleId]: '31.02.2027' },
			}),
		).rejects.toMatchObject({ fields: { [`custom:${visibleId}`]: 'invalid' } });

		await updatePartner(db, editor, partnerId, {
			...stadtwerke,
			custom: { [baseId]: ' ', [visibleId]: '31.12.2027' },
		});
		await expect(stored(db, partnerId)).resolves.toHaveProperty('customValues', {
			[hiddenId]: 'gut',
			[visibleId]: '2027-12-31',
		});
		const audit = await partnerAudit(db);
		expect(audit.at(-1)?.details).toStrictEqual({
			fields: [`custom:${baseId}`, `custom:${visibleId}`].toSorted(),
		});
	});

	it('changes nothing for an unchanged partner', async () => {
		const db = await createTestDb();
		const { editor } = await partnerClub(db);
		const input = { ...stadtwerke, city: 'Musterstadt', tags: ['Sponsor'] };
		const { contactId } = await createPartner(db, editor, input);
		const before = await stored(db, contactId);
		await updatePartner(db, editor, contactId, { ...input, email: 'PRESSE@stadtwerke.example ' });
		await expect(partnerVersion(db)).resolves.toBe(1);
		await expect(partnerAudit(db)).resolves.toHaveLength(1);
		await expect(stored(db, contactId)).resolves.toHaveProperty('updatedAt', before.updatedAt);
	});
});

describe('the key of a partner', () => {
	it('moves suppression and opt-outs when the key of a partner changes', async () => {
		const db = await createTestDb();
		const { editor, partnersAreaId } = await partnerClub(db);
		const { contactId } = await createPartner(db, editor, stadtwerke);
		await db
			.insert(contactSuppressions)
			.values({ contactKey: 'email:presse@stadtwerke.example', kind: 'partner' });
		await db.insert(contactOptOuts).values({
			areaId: partnersAreaId,
			contactKey: 'email:presse@stadtwerke.example',
			kind: 'partner',
			scope: 'area',
		});

		await updatePartner(db, editor, contactId, { ...stadtwerke, email: 'info@stadtwerke.example' });
		await expect(suppressedKeys(db)).resolves.toStrictEqual(['email:info@stadtwerke.example']);
		await expect(optOutKeys(db)).resolves.toStrictEqual([
			`email:info@stadtwerke.example ${partnersAreaId}`,
		]);

		await updatePartner(db, editor, contactId, {
			...stadtwerke,
			customerNumber: '100009',
			email: 'info@stadtwerke.example',
		});
		await expect(suppressedKeys(db)).resolves.toStrictEqual(['nr:100009']);
		await expect(optOutKeys(db)).resolves.toStrictEqual([`nr:100009 ${partnersAreaId}`]);
		await expect(stored(db, contactId)).resolves.toMatchObject({ contactKey: 'nr:100009' });
	});

	it('keeps the entries for another partner that still has the old key', async () => {
		const db = await createTestDb();
		const { admin, editor } = await partnerClub(db);
		const { areaId: youthId } = await createArea(db, admin, 'Jugend');
		const { contactId } = await createPartner(db, editor, stadtwerke);
		await createPartner(db, editor, { ...stadtwerke, organization: 'Stadtwerke Nord' });
		await db
			.insert(contactSuppressions)
			.values({ contactKey: 'email:presse@stadtwerke.example', kind: 'partner' });
		await db.insert(contactOptOuts).values({
			areaId: youthId,
			contactKey: 'email:presse@stadtwerke.example',
			kind: 'partner',
			scope: 'area',
		});

		await updatePartner(db, editor, contactId, { ...stadtwerke, customerNumber: '100009' });
		await expect(suppressedKeys(db)).resolves.toStrictEqual([
			'email:presse@stadtwerke.example',
			'nr:100009',
		]);
		await expect(optOutKeys(db)).resolves.toStrictEqual([
			`email:presse@stadtwerke.example ${youthId}`,
			`nr:100009 ${youthId}`,
		]);
	});

	it('keeps the suppression of a deleted partner', async () => {
		const db = await createTestDb();
		const { editor, partnersAreaId } = await partnerClub(db);
		const { contactId } = await createPartner(db, editor, {
			...stadtwerke,
			customerNumber: '100009',
		});
		await db.insert(contactSuppressions).values({ contactKey: 'nr:100009', kind: 'partner' });
		await db.insert(contactOptOuts).values({
			areaId: partnersAreaId,
			contactKey: 'nr:100009',
			kind: 'partner',
			scope: 'area',
		});
		await deletePartner(db, editor, contactId);
		await expect(db.select().from(contacts)).resolves.toStrictEqual([]);
		await expect(suppressedKeys(db)).resolves.toStrictEqual(['nr:100009']);
		await expect(optOutKeys(db)).resolves.toStrictEqual([`nr:100009 ${partnersAreaId}`]);
	});
});

describe(listTags, () => {
	it('lists each tag once', async () => {
		const db = await createTestDb();
		await insertContact(db, {
			createdAt: new Date('2026-01-02T00:00:00Z'),
			kind: 'partner',
			tags: ['sponsor', 'Presse'],
		});
		await insertContact(db, {
			createdAt: new Date('2026-01-01T00:00:00Z'),
			kind: 'partner',
			tags: ['Sponsor'],
		});
		// Members have no tags; a stray one in the database is not listed.
		await insertContact(db, { kind: 'member', tags: ['Mitglied'] });
		await expect(listTags(db)).resolves.toStrictEqual(['Presse', 'Sponsor']);
	});

	it('breaks a tie of creation times by the byte order of the spelling', async () => {
		const db = await createTestDb();
		const createdAt = new Date('2026-01-01T00:00:00Z');
		await insertContact(db, { createdAt, kind: 'partner', tags: ['jugend'] });
		await insertContact(db, { createdAt, kind: 'partner', tags: ['Jugend'] });
		await expect(listTags(db)).resolves.toStrictEqual(['Jugend']);
	});

	it('gives new tags the spelling of the existing ones', async () => {
		const db = await createTestDb();
		const { editor } = await partnerClub(db);
		await createPartner(db, editor, { ...stadtwerke, tags: ['Sponsor'] });
		const { contactId } = await createPartner(db, editor, {
			...stadtwerke,
			organization: 'Druckerei',
			tags: ['SPONSOR', ' presse '],
		});
		await expect(stored(db, contactId)).resolves.toMatchObject({ tags: ['Sponsor', 'presse'] });
		// The only partner with a tag may change its spelling.
		await updatePartner(db, editor, contactId, {
			...stadtwerke,
			organization: 'Druckerei',
			tags: ['sponsor', 'Presse'],
		});
		await expect(stored(db, contactId)).resolves.toMatchObject({ tags: ['Sponsor', 'Presse'] });
		await expect(listTags(db)).resolves.toStrictEqual(['Presse', 'Sponsor']);
	});
});

describe(getPartnerForm, () => {
	it('requires edit in the partner area and refuses members and unknown contacts', async () => {
		const db = await createTestDb();
		const { admin, editor, membersAreaId, partnersAreaId } = await partnerClub(db);
		const memberId = await insertContact(db, { kind: 'member', lastName: 'Mitglied' });
		const refused = [
			await userWith(db, { [partnersAreaId]: 'read' }),
			await userWith(db, { [membersAreaId]: 'edit' }),
			await userWith(db, {}, { isAdmin: true }),
			admin,
		];
		for (const principal of refused) {
			// oxlint-disable-next-line no-await-in-loop -- one refusal after the other
			await expect(getPartnerForm(db, principal, null)).rejects.toBeInstanceOf(ForbiddenError);
		}
		await expect(getPartnerForm(db, editor, memberId)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(getPartnerForm(db, editor, UNKNOWN_ID)).rejects.toBeInstanceOf(
			ContactNotFoundError,
		);
	});

	it('gives a new partner an empty form with the fields the user sees', async () => {
		const db = await createTestDb();
		const { admin, editor, membersAreaId } = await partnerClub(db);
		await insertContact(db, { kind: 'partner', tags: ['Sponsor', 'Presse'] });
		const baseId = await insertCustomField(db, {
			kind: 'partner',
			name: 'Ansprechpartner',
			protection: 'base',
			type: 'text',
		});
		const hiddenId = await insertCustomField(db, {
			kind: 'partner',
			name: 'Bonität',
			protection: 'protected',
			type: 'text',
		});
		const visibleId = await insertCustomField(db, {
			kind: 'partner',
			name: 'Vertrag bis',
			protection: 'protected',
			type: 'date',
		});
		await insertCustomField(db, {
			kind: 'member',
			name: 'Spind',
			protection: 'base',
			type: 'text',
		});
		await setFieldAreas(db, admin, {
			areaIds: [membersAreaId],
			fieldKey: `custom:${hiddenId}`,
			kind: 'partner',
		});
		await setFieldAreas(db, admin, {
			areaIds: [membersAreaId],
			fieldKey: 'birthDate',
			kind: 'partner',
		});
		const form = await getPartnerForm(db, editor, null);
		expect(form).toStrictEqual({
			customFields: [
				{ id: baseId, kind: 'partner', name: 'Ansprechpartner', protection: 'base', type: 'text' },
				{
					id: visibleId,
					kind: 'partner',
					name: 'Vertrag bis',
					protection: 'protected',
					type: 'date',
				},
			],
			protectedFields: ['street', 'postalCode', 'city'],
			tagSuggestions: ['Presse', 'Sponsor'],
			values: null,
		});
	});

	it('fills the form of a stored partner with the values the user sees', async () => {
		const db = await createTestDb();
		const { admin, editor, membersAreaId } = await partnerClub(db);
		const visibleId = await insertCustomField(db, {
			kind: 'partner',
			name: 'Vertrag bis',
			protection: 'protected',
			type: 'date',
		});
		const emptyId = await insertCustomField(db, {
			kind: 'partner',
			name: 'Ansprechpartner',
			protection: 'base',
			type: 'text',
		});
		const hiddenId = await insertCustomField(db, {
			kind: 'partner',
			name: 'Bonität',
			protection: 'protected',
			type: 'text',
		});
		await setFieldAreas(db, admin, {
			areaIds: [membersAreaId],
			fieldKey: `custom:${hiddenId}`,
			kind: 'partner',
		});
		await setFieldAreas(db, admin, {
			areaIds: [membersAreaId],
			fieldKey: 'address',
			kind: 'partner',
		});
		const partnerId = await insertContact(db, {
			birthDate: '1980-05-17',
			city: 'Musterstadt',
			customValues: { [hiddenId]: 'gut', [visibleId]: '2027-12-31' },
			customerNumber: '100009',
			email: 'presse@stadtwerke.example',
			gender: 'female',
			kind: 'partner',
			organization: 'Stadtwerke',
			street: 'Hauptstr. 1',
			tags: ['Presse'],
		});
		const form = await getPartnerForm(db, editor, partnerId);
		expect(form.protectedFields).toStrictEqual(['birthDate']);
		// Hidden values never leave the server: no address, no "Bonität".
		expect(form.values).toStrictEqual({
			birthDate: '1980-05-17',
			custom: { [emptyId]: '', [visibleId]: '2027-12-31' },
			customerNumber: '100009',
			email: 'presse@stadtwerke.example',
			firstName: '',
			gender: 'female',
			lastName: '',
			organization: 'Stadtwerke',
			tags: ['Presse'],
		});
	});
});

describe(savePartner, () => {
	it('creates a partner without id and edits the one with id', async () => {
		const db = await createTestDb();
		const { editor } = await partnerClub(db);
		const created = await savePartner(db, editor, stadtwerke);
		const rows = await db.select({ id: contacts.id }).from(contacts);
		expect(rows.map((row) => ({ contactId: row.id, ok: true }))).toStrictEqual([created]);
		const { contactId } = await createPartner(db, editor, {
			...stadtwerke,
			organization: 'Druckerei',
		});
		const edited = await savePartner(db, editor, {
			...stadtwerke,
			contactId,
			organization: 'Druckerei Nord',
		});
		expect(edited).toStrictEqual({ contactId, ok: true });
		await expect(stored(db, contactId)).resolves.toHaveProperty('organization', 'Druckerei Nord');
	});

	it('gives refused fields, a taken customer number and an unknown partner as results', async () => {
		const db = await createTestDb();
		const { editor } = await partnerClub(db);
		await createPartner(db, editor, { ...stadtwerke, customerNumber: '100001' });
		const results = [
			await savePartner(db, editor, { ...stadtwerke, organization: '' }),
			await savePartner(db, editor, { ...stadtwerke, customerNumber: '100001' }),
			await savePartner(db, editor, { ...stadtwerke, contactId: UNKNOWN_ID }),
		];
		expect(results).toStrictEqual([
			{ fields: { name: 'required' }, ok: false },
			{ fields: { customerNumber: 'taken' }, ok: false },
			{ failure: 'contactNotFound', ok: false },
		]);
	});

	it('still refuses a user without the right', async () => {
		const db = await createTestDb();
		const { partnersAreaId } = await partnerClub(db);
		const reader = await userWith(db, { [partnersAreaId]: 'read' });
		await expect(savePartner(db, reader, stadtwerke)).rejects.toBeInstanceOf(ForbiddenError);
	});
});

describe('the audit of partner upkeep', () => {
	it('audits by number or internal id, never by address', async () => {
		const db = await createTestDb();
		const { editor } = await partnerClub(db);
		const { contactId } = await createPartner(db, editor, stadtwerke);
		await updatePartner(db, editor, contactId, { ...stadtwerke, customerNumber: '100009' });
		await deletePartner(db, editor, contactId);
		const audit = await partnerAudit(db);
		expect(audit.map(({ action, target }) => [action, target])).toStrictEqual([
			['partner.created', `contact:${contactId}`],
			['partner.updated', 'partner:100009'],
			['partner.deleted', 'partner:100009'],
		]);
		expect(JSON.stringify(audit)).not.toContain('@');
		expect(JSON.stringify(audit)).not.toContain('Stadtwerke');
	});
});
