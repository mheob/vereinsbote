import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import { emptyTemplate } from '@/mail/starters/starters';
import { setFieldAreas } from '@/server/contacts/settings';
import { insertContact, setUpClub, userWith } from '@/server/contacts/testing';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';

import { TemplateNotFoundError } from './errors';
import { previewValues, searchPreviewContacts } from './preview-values';
import { createTemplate } from './templates';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const MAX_HITS = 10;
const MANY = 14;

const named = (name: string): ReturnType<typeof emptyTemplate> =>
	emptyTemplate({ name, subject: 'Betreff' });

/**
 * A club with one template in the members area and one in the partners area, a user who edits
 * the members area and reads the partners area, and a member with a birth date.
 *
 * @returns The database, the users, the templates and the member.
 */
async function club(): Promise<{
	db: Awaited<ReturnType<typeof createTestDb>>;
	admin: Awaited<ReturnType<typeof setUpClub>>['admin'];
	user: Awaited<ReturnType<typeof userWith>>;
	membersTemplate: string;
	partnersTemplate: string;
	partnersAreaId: string;
	memberId: string;
}> {
	const db = await createTestDb();
	const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
	const user = await userWith(db, { [membersAreaId]: 'edit', [partnersAreaId]: 'read' });
	const members = await createTemplate(db, user, membersAreaId, named('Mitglieder'));
	// A template in the partners area needs `edit` there.
	const partnersEditor = await userWith(db, { [partnersAreaId]: 'edit' });
	const inPartners = await createTemplate(db, partnersEditor, partnersAreaId, named('Finanzen'));
	const memberId = await insertContact(db, {
		birthDate: '1990-05-17',
		email: 'ben@example.org',
		firstName: 'Ben',
		gender: 'male',
		kind: 'member',
		lastName: 'Bauer',
	});
	return {
		admin,
		db,
		memberId,
		membersTemplate: members.id,
		partnersAreaId,
		partnersTemplate: inPartners.id,
		user,
	};
}

describe(previewValues, () => {
	it('gives readers of the area the values the template may use', async () => {
		const c = await club();
		const values = await previewValues(
			c.db,
			c.user,
			c.membersTemplate,
			c.memberId,
			DEFAULT_SALUTATIONS.du,
		);
		expect(values).toMatchObject({
			'contact.birthDate': '17.05.1990',
			'contact.email': 'ben@example.org',
			'contact.firstName': 'Ben',
			'contact.lastName': 'Bauer',
			salutation: 'Lieber Ben',
		});
	});

	it('uses the salutation texts it is given', async () => {
		const c = await club();
		const values = await previewValues(c.db, c.user, c.membersTemplate, c.memberId, {
			...DEFAULT_SALUTATIONS.du,
			male: 'Servus {{contact.firstName}}',
		});
		expect(values?.salutation).toBe('Servus Ben');
	});

	it('never delivers a protected field of another area', async () => {
		const c = await club();
		// The user reads the members area and so sees the birth date, but this template is in the
		// partners area, which does not.
		const values = await previewValues(
			c.db,
			c.user,
			c.partnersTemplate,
			c.memberId,
			DEFAULT_SALUTATIONS.du,
		);
		expect(values).toMatchObject({ 'contact.firstName': 'Ben' });
		expect(values).not.toHaveProperty(['contact.birthDate']);
		expect(JSON.stringify(values)).not.toContain('1990');
	});

	it('stops delivering a field once the protection changes', async () => {
		const c = await club();
		const before = await previewValues(
			c.db,
			c.user,
			c.membersTemplate,
			c.memberId,
			DEFAULT_SALUTATIONS.du,
		);
		expect(before).toHaveProperty(['contact.birthDate']);
		await setFieldAreas(c.db, c.admin, {
			areaIds: [c.partnersAreaId],
			fieldKey: 'birthDate',
			kind: 'member',
		});
		const after = await previewValues(
			c.db,
			c.user,
			c.membersTemplate,
			c.memberId,
			DEFAULT_SALUTATIONS.du,
		);
		expect(after).not.toHaveProperty(['contact.birthDate']);
		expect(after).toMatchObject({ 'contact.firstName': 'Ben' });
	});

	it('gives nothing for a contact that is gone', async () => {
		const c = await club();
		await expect(
			previewValues(c.db, c.user, c.membersTemplate, UNKNOWN_ID, DEFAULT_SALUTATIONS.du),
		).resolves.toBeNull();
	});

	it('refuses users without read in the area and unknown templates', async () => {
		const c = await club();
		const outsider = await userWith(c.db, { [c.partnersAreaId]: 'read' });
		await expect(
			previewValues(c.db, outsider, c.membersTemplate, c.memberId, DEFAULT_SALUTATIONS.du),
		).rejects.toThrow(ForbiddenError);
		// The admin role alone gives no access to an area.
		await expect(
			previewValues(c.db, c.admin, c.partnersTemplate, c.memberId, DEFAULT_SALUTATIONS.du),
		).rejects.toThrow(ForbiddenError);
		await expect(
			previewValues(c.db, c.user, UNKNOWN_ID, c.memberId, DEFAULT_SALUTATIONS.du),
		).rejects.toThrow(TemplateNotFoundError);
	});
});

describe(searchPreviewContacts, () => {
	it('finds members and partners by name, with kind and display name', async () => {
		const c = await club();
		const partnerId = await insertContact(c.db, {
			customerNumber: 'K-1',
			firstName: 'Bea',
			kind: 'partner',
			lastName: 'Bauer',
		});
		const found = await searchPreviewContacts(c.db, c.user, c.membersTemplate, 'bauer');
		expect(found).toStrictEqual([
			{ id: partnerId, kind: 'partner', name: 'Bea Bauer' },
			{ id: c.memberId, kind: 'member', name: 'Ben Bauer' },
		]);
		await expect(
			searchPreviewContacts(c.db, c.user, c.membersTemplate, 'nobody'),
		).resolves.toStrictEqual([]);
	});

	it('gives at most ten contacts', async () => {
		const c = await club();
		await Promise.all(
			Array.from({ length: MANY }, async (_, index) =>
				insertContact(c.db, { firstName: `Gast${index}`, kind: 'member', lastName: 'Probe' }),
			),
		);
		const found = await searchPreviewContacts(c.db, c.user, c.membersTemplate, '');
		expect(found).toHaveLength(MAX_HITS);
	});

	it('refuses users without read in the area of the template', async () => {
		const c = await club();
		const outsider = await userWith(c.db, { [c.partnersAreaId]: 'read' });
		await expect(searchPreviewContacts(c.db, outsider, c.membersTemplate, '')).rejects.toThrow(
			ForbiddenError,
		);
		await expect(searchPreviewContacts(c.db, c.user, UNKNOWN_ID, '')).rejects.toThrow(
			TemplateNotFoundError,
		);
	});
});
