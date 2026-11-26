import { describe, expect, it } from 'vite-plus/test';

import { createArea } from '@/server/areas/areas';
import { customFieldKey } from '@/server/contacts/fields';
import { setFieldAreas } from '@/server/contacts/settings';
import type { CustomFieldRecord } from '@/server/contacts/settings';
import { setUpClub } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { customFields } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';

import {
	allowedLayoutPlaceholders,
	allowedTemplatePlaceholders,
	templatePlaceholders,
} from './allowed-placeholders';

const BASE_KEYS = [
	'contact.firstName',
	'contact.lastName',
	'contact.organization',
	'contact.displayName',
	'contact.email',
	'contact.memberNumber',
	'contact.customerNumber',
	'contact.groups',
	'contact.tags',
];
const PROTECTED_KEYS = [
	'contact.birthDate',
	'contact.entryDate',
	'contact.exitDate',
	'contact.street',
	'contact.postalCode',
	'contact.city',
];

/**
 * The keys a set lacks.
 *
 * @param set The set.
 * @param keys The keys to look for.
 * @returns The keys not in the set.
 */
const lacking = (set: ReadonlySet<string>, keys: readonly string[]): string[] =>
	keys.filter((key) => !set.has(key));

/**
 * The keys a set has.
 *
 * @param set The set.
 * @param keys The keys to look for.
 * @returns The keys in the set.
 */
const having = (set: ReadonlySet<string>, keys: readonly string[]): string[] =>
	keys.filter((key) => set.has(key));

/** Allowed in every template. */
const EVERYWHERE = [...BASE_KEYS, 'salutation', 'brand.name', 'brand.logoUrl'];

/**
 * A club with the areas "Mitglieder" (members), "Finanzen" (partners) and "Veranstaltungen".
 *
 * @param db The test database.
 * @returns The admin and the area ids.
 */
async function club(
	db: Db,
): Promise<Awaited<ReturnType<typeof setUpClub>> & { eventsAreaId: string }> {
	const setUp = await setUpClub(db);
	const { areaId } = await createArea(db, setUp.admin, 'Veranstaltungen');
	return { ...setUp, eventsAreaId: areaId };
}

/**
 * Inserts a custom field.
 *
 * @param db The database.
 * @param values The kind, name, key and protection.
 * @returns The id of the field.
 */
async function insertCustomField(
	db: Db,
	values: Readonly<
		Pick<typeof customFields.$inferInsert, 'kind' | 'name' | 'placeholderKey' | 'protection'>
	>,
): Promise<string> {
	const [row] = await db
		.insert(customFields)
		.values({ ...values, type: 'text' })
		.returning({ id: customFields.id });
	if (row === undefined) throw new Error('Inserting the custom field returned no row.');
	return row.id;
}

describe(allowedTemplatePlaceholders, () => {
	it('allows base fields everywhere and protected fields of the area only', async () => {
		const db = await createTestDb();
		const { eventsAreaId, membersAreaId } = await club(db);
		const members = await allowedTemplatePlaceholders(db, membersAreaId);
		const events = await allowedTemplatePlaceholders(db, eventsAreaId);
		expect(lacking(members.keys, [...EVERYWHERE, ...PROTECTED_KEYS])).toStrictEqual([]);
		expect(lacking(events.keys, EVERYWHERE)).toStrictEqual([]);
		expect([
			...having(members.keys, ['content']),
			...having(events.keys, [...PROTECTED_KEYS, 'content']),
		]).toStrictEqual([]);
		expect(lacking(events.known, [...PROTECTED_KEYS, 'content'])).toStrictEqual([]);
		expect({ events: events.deliveredByKind, members: members.deliveredByKind }).toStrictEqual({
			events: { member: new Set(), partner: new Set() },
			members: {
				member: new Set(['birthDate', 'entryDate', 'exitDate', 'address']),
				partner: new Set(),
			},
		});
	});

	it('allows a field assigned to the area for one kind and delivers it for that kind only', async () => {
		const db = await createTestDb();
		const { admin, eventsAreaId } = await club(db);
		await setFieldAreas(db, admin, {
			areaIds: [eventsAreaId],
			fieldKey: 'birthDate',
			kind: 'partner',
		});
		const events = await allowedTemplatePlaceholders(db, eventsAreaId);
		expect(having(events.keys, PROTECTED_KEYS)).toStrictEqual(['contact.birthDate']);
		expect(events.deliveredByKind).toStrictEqual({
			member: new Set(),
			partner: new Set(['birthDate']),
		});
	});

	it('allows custom fields by their protection', async () => {
		const db = await createTestDb();
		const { eventsAreaId, membersAreaId } = await club(db);
		const noteId = await insertCustomField(db, {
			kind: 'member',
			name: 'Notiz',
			placeholderKey: 'notiz',
			protection: 'protected',
		});
		await insertCustomField(db, {
			kind: 'partner',
			name: 'Trikotgröße',
			placeholderKey: 'trikotgroesse',
			protection: 'base',
		});
		const members = await allowedTemplatePlaceholders(db, membersAreaId);
		const events = await allowedTemplatePlaceholders(db, eventsAreaId);
		const custom = ['contact.custom.notiz', 'contact.custom.trikotgroesse'];
		expect(having(members.keys, custom)).toStrictEqual(custom);
		expect(having(events.keys, custom)).toStrictEqual(['contact.custom.trikotgroesse']);
		expect(having(events.known, custom)).toStrictEqual(custom);
		expect(members.deliveredByKind.member).toContain(customFieldKey(noteId));
	});
});

describe(templatePlaceholders, () => {
	it('allows a custom field when one kind allows it', () => {
		const fieldId = '11111111-1111-4111-8111-111111111111';
		const shared = { name: 'Notiz', placeholderKey: 'notiz', type: 'text' } as const;
		const allowed = templatePlaceholders(
			{ member: new Set(), partner: new Set([customFieldKey(fieldId)]) },
			[
				{
					...shared,
					id: '33333333-3333-4333-8333-333333333333',
					kind: 'member',
					protection: 'protected',
				},
				{ ...shared, id: fieldId, kind: 'partner', protection: 'protected' },
			],
		);
		expect(allowed.keys).toContain('contact.custom.notiz');
	});

	it('allows the unsubscribe link in every template and every layout, content in layouts only', () => {
		const template = templatePlaceholders({ member: new Set(), partner: new Set() }, []);
		const own = allowedLayoutPlaceholders('template', template);
		const global = allowedLayoutPlaceholders('global', []);
		expect(
			[template.keys, own.keys, global.keys].map((keys) => keys.has('unsubscribe.url')),
		).toStrictEqual([true, true, true]);
		expect([template.keys, own.keys, global.keys].map((keys) => keys.has('content'))).toStrictEqual(
			[false, true, true],
		);
	});
});

const field = (placeholderKey: string, protection: 'base' | 'protected'): CustomFieldRecord => ({
	id: `field-${placeholderKey}`,
	kind: 'member',
	name: placeholderKey,
	placeholderKey,
	protection,
	type: 'text',
});

describe(allowedLayoutPlaceholders, () => {
	it('limits global layouts to brand, base fields and content', () => {
		const { keys } = allowedLayoutPlaceholders('global', []);
		expect(
			lacking(keys, [...BASE_KEYS, 'content', 'brand.name', 'brand.primaryColor']),
		).toStrictEqual([]);
		expect(having(keys, [...PROTECTED_KEYS, 'salutation'])).toStrictEqual([]);
	});

	it('gives global layouts the base custom fields, not the protected ones', () => {
		const { keys, known } = allowedLayoutPlaceholders('global', [
			field('verein', 'base'),
			field('notiz', 'protected'),
		]);
		expect(having(keys, ['contact.custom.verein', 'contact.custom.notiz'])).toStrictEqual([
			'contact.custom.verein',
		]);
		expect(having(known, ['contact.custom.verein', 'contact.custom.notiz'])).toStrictEqual([
			'contact.custom.verein',
			'contact.custom.notiz',
		]);
		expect(known).toContain('contact.birthDate');
		expect(known).not.toContain('contact.custom.other');
	});

	it("gives a template's own layout the template's placeholders and content", () => {
		const template = templatePlaceholders(
			{ member: new Set(['birthDate']), partner: new Set() },
			[],
		);
		const { keys, known } = allowedLayoutPlaceholders('template', template);
		expect(
			having(keys, ['content', 'contact.birthDate', 'salutation', 'contact.city']),
		).toStrictEqual(['content', 'contact.birthDate', 'salutation']);
		expect(known).toBe(template.known);
	});
});
