import { desc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { createArea } from '@/server/areas/areas';
import type { Db } from '@/server/db/client';
import { auditLog, customFields } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';

import { NotProtectedFieldError, UnknownAreaError, UnknownCustomFieldError } from './errors';
import { customFieldKey } from './fields';
import type { ContactKind, FieldKey } from './fields';
import {
	FieldAreasEmptyError,
	getContactSettings,
	getFieldAreas,
	kindAreaId,
	listCustomFields,
	saveContactAreas,
	setContactAreas,
	setCustomFieldProtection,
	setFieldAreas,
	setStaleImportWeeks,
	StaleImportWeeksInvalidError,
} from './settings';
import { setUpClub, userWith } from './testing';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Waits for a promise that must reject.
 *
 * @param promise The promise.
 * @returns The rejection reason.
 */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('The promise resolved.');
}

/**
 * Creates a custom text field "Notiz" of the kind `member`.
 *
 * @param db The database.
 * @returns The id of the field.
 */
async function insertNote(db: Db): Promise<string> {
	const [row] = await db
		.insert(customFields)
		.values({ kind: 'member', name: 'Notiz', placeholderKey: 'notiz', type: 'text' })
		.returning({ id: customFields.id });
	if (row === undefined) throw new Error('Inserting the custom field returned no row.');
	return row.id;
}

/**
 * The areas of one protected field.
 *
 * @param db The database.
 * @param kind The kind.
 * @param key The field.
 * @returns The area ids, or undefined when the field is not protected.
 */
async function areasOf(
	db: Db,
	kind: ContactKind,
	key: FieldKey,
): Promise<readonly string[] | undefined> {
	const map = await getFieldAreas(db, kind);
	return map.get(key);
}

/**
 * The newest audit entry.
 *
 * @param db The database.
 * @returns The entry.
 */
async function lastAudit(db: Db): Promise<typeof auditLog.$inferSelect | undefined> {
	const [entry] = await db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1);
	return entry;
}

/**
 * How many changes of the contact settings the audit log has.
 *
 * @param db The database.
 * @returns The number of entries.
 */
async function settingsChanges(db: Db): Promise<number> {
	const entries = await db
		.select()
		.from(auditLog)
		.where(eq(auditLog.action, 'contacts.settings_changed'));
	return entries.length;
}

describe(getContactSettings, () => {
	it('has defaults without a row', async () => {
		const db = await createTestDb();
		await expect(getContactSettings(db)).resolves.toStrictEqual({
			membersAreaId: null,
			partnersAreaId: null,
			staleImportWeeks: 8,
		});
	});

	it('picks the area of a kind', async () => {
		const db = await createTestDb();
		const { membersAreaId, partnersAreaId } = await setUpClub(db);
		const settings = await getContactSettings(db);
		expect(kindAreaId(settings, 'member')).toBe(membersAreaId);
		expect(kindAreaId(settings, 'partner')).toBe(partnersAreaId);
	});

	it('keeps the stale weeks when the areas are saved again', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		await setStaleImportWeeks(db, admin, 12);
		await saveContactAreas(db, { membersAreaId: partnersAreaId, partnersAreaId: membersAreaId });
		await expect(getContactSettings(db)).resolves.toStrictEqual({
			membersAreaId: partnersAreaId,
			partnersAreaId: membersAreaId,
			staleImportWeeks: 12,
		});
	});
});

describe(getFieldAreas, () => {
	it('assigns protected fields to the area of their kind by default', async () => {
		const db = await createTestDb();
		const { membersAreaId, partnersAreaId } = await setUpClub(db);
		await expect(getFieldAreas(db, 'member')).resolves.toStrictEqual(
			new Map([
				['birthDate', [membersAreaId]],
				['entryDate', [membersAreaId]],
				['exitDate', [membersAreaId]],
				['address', [membersAreaId]],
			]),
		);
		await expect(getFieldAreas(db, 'partner')).resolves.toStrictEqual(
			new Map([
				['birthDate', [partnersAreaId]],
				['address', [partnersAreaId]],
			]),
		);
	});

	it('has no areas while the area of the kind is not set', async () => {
		const db = await createTestDb();
		await expect(areasOf(db, 'member', 'birthDate')).resolves.toStrictEqual([]);
	});

	it('overrides one field of one kind only', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		await setFieldAreas(db, admin, {
			areaIds: [membersAreaId, partnersAreaId],
			fieldKey: 'birthDate',
			kind: 'member',
		});
		// Sorted by area name: Finanzen (partners), Mitglieder (members).
		await expect(areasOf(db, 'member', 'birthDate')).resolves.toStrictEqual([
			partnersAreaId,
			membersAreaId,
		]);
		await expect(areasOf(db, 'member', 'exitDate')).resolves.toStrictEqual([membersAreaId]);
		await expect(areasOf(db, 'partner', 'birthDate')).resolves.toStrictEqual([partnersAreaId]);
	});

	it('replaces the previous override', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		const address = { fieldKey: 'address', kind: 'member' } as const;
		await setFieldAreas(db, admin, { ...address, areaIds: [membersAreaId, partnersAreaId] });
		await setFieldAreas(db, admin, { ...address, areaIds: [partnersAreaId, partnersAreaId] });
		await expect(areasOf(db, 'member', 'address')).resolves.toStrictEqual([partnersAreaId]);
	});

	it('refuses to leave a protected field without an area', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		await expect(
			setFieldAreas(db, admin, { areaIds: [], fieldKey: 'birthDate', kind: 'member' }),
		).rejects.toBeInstanceOf(FieldAreasEmptyError);
		await expect(areasOf(db, 'member', 'birthDate')).resolves.toStrictEqual([membersAreaId]);
	});

	it('refuses a field that is not protected for the kind', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const areaIds = [membersAreaId];
		await expect(
			setFieldAreas(db, admin, { areaIds, fieldKey: 'exitDate', kind: 'partner' }),
		).rejects.toThrow('not a protected field');
		await expect(
			setFieldAreas(db, admin, { areaIds, fieldKey: customFieldKey(UNKNOWN_ID), kind: 'member' }),
		).rejects.toThrow('not a protected field');
	});

	it('refuses a base custom field and a custom field of the other kind', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const key = customFieldKey(await insertNote(db));
		const areaIds = [membersAreaId];
		await expect(
			setFieldAreas(db, admin, { areaIds, fieldKey: key, kind: 'partner' }),
		).rejects.toThrow('not a protected field');
		await setCustomFieldProtection(db, admin, {
			customFieldId: key.slice('custom:'.length),
			protection: 'base',
		});
		await expect(
			setFieldAreas(db, admin, { areaIds, fieldKey: key, kind: 'member' }),
		).rejects.toThrow('not a protected field');
	});

	it('lets fields without an override follow a new members area', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		const { areaId: boardAreaId } = await createArea(db, admin, 'Vorstand');
		await setFieldAreas(db, admin, {
			areaIds: [membersAreaId, partnersAreaId],
			fieldKey: 'birthDate',
			kind: 'member',
		});
		await setContactAreas(db, admin, { membersAreaId: boardAreaId, partnersAreaId });
		await expect(areasOf(db, 'member', 'exitDate')).resolves.toStrictEqual([boardAreaId]);
		await expect(areasOf(db, 'member', 'birthDate')).resolves.toStrictEqual([
			partnersAreaId,
			membersAreaId,
		]);
	});
});

describe('who may change the contact settings', () => {
	it('only admins change contact settings', async () => {
		const db = await createTestDb();
		const { membersAreaId, partnersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [membersAreaId]: 'edit', [partnersAreaId]: 'send' });
		const customFieldId = await insertNote(db);
		const attempts = [
			setContactAreas(db, editor, { membersAreaId, partnersAreaId }),
			setFieldAreas(db, editor, {
				areaIds: [membersAreaId],
				fieldKey: 'birthDate',
				kind: 'member',
			}),
			setCustomFieldProtection(db, editor, { customFieldId, protection: 'base' }),
			setStaleImportWeeks(db, editor, 10),
		];
		const errors = await Promise.all(attempts.map(async (attempt) => failureOf(attempt)));
		expect(errors.map((error) => error instanceof ForbiddenError)).toStrictEqual([
			true,
			true,
			true,
			true,
		]);
		await expect(getContactSettings(db)).resolves.toStrictEqual({
			membersAreaId,
			partnersAreaId,
			staleImportWeeks: 8,
		});
	});

	it('writes no audit entry for a refused change', async () => {
		const db = await createTestDb();
		const { membersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [membersAreaId]: 'send' });
		await expect(setStaleImportWeeks(db, editor, 10)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(
			db.select().from(auditLog).where(eq(auditLog.action, 'contacts.settings_changed')),
		).resolves.toHaveLength(0);
	});

	it('lets an admin without any area level change the settings', async () => {
		const db = await createTestDb();
		const { membersAreaId, partnersAreaId } = await setUpClub(db);
		const admin = await userWith(db, {}, { isAdmin: true });
		await setContactAreas(db, admin, {
			membersAreaId: partnersAreaId,
			partnersAreaId: membersAreaId,
		});
		const settings = await getContactSettings(db);
		expect(kindAreaId(settings, 'member')).toBe(partnersAreaId);
	});
});

describe(setContactAreas, () => {
	it('stores the areas and writes an audit entry with ids only', async () => {
		const db = await createTestDb();
		const { admin, partnersAreaId } = await setUpClub(db);
		const { areaId: boardAreaId } = await createArea(db, admin, 'Vorstand');
		await setContactAreas(db, admin, { membersAreaId: boardAreaId, partnersAreaId });
		const entry = await lastAudit(db);
		expect(entry?.action).toBe('contacts.settings_changed');
		expect(entry?.actorUserId).toBe(admin.userId);
		expect(entry?.details).toStrictEqual({ membersAreaId: boardAreaId, partnersAreaId });
	});
});

describe(setFieldAreas, () => {
	it('writes the kind, the field and the areas to the audit log', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		await setFieldAreas(db, admin, {
			areaIds: [membersAreaId],
			fieldKey: 'entryDate',
			kind: 'member',
		});
		const entry = await lastAudit(db);
		expect(entry?.action).toBe('contacts.settings_changed');
		expect(entry?.details).toStrictEqual({
			areaIds: [membersAreaId],
			fieldKey: 'entryDate',
			kind: 'member',
		});
	});
});

describe(setStaleImportWeeks, () => {
	it('refuses weeks outside 1 to 52 and fractions', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const attempts = [0, 53, 2.5, -1, Number.NaN].map(async (weeks) =>
			setStaleImportWeeks(db, admin, weeks),
		);
		const errors = await Promise.all(attempts.map(async (attempt) => failureOf(attempt)));
		expect(errors.map((error) => error instanceof StaleImportWeeksInvalidError)).toStrictEqual([
			true,
			true,
			true,
			true,
			true,
		]);
		await expect(getContactSettings(db)).resolves.toMatchObject({ staleImportWeeks: 8 });
	});

	it('accepts stale import weeks from 1 to 52', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await setStaleImportWeeks(db, admin, 12);
		await expect(getContactSettings(db)).resolves.toMatchObject({ staleImportWeeks: 12 });
		await setStaleImportWeeks(db, admin, 1);
		await expect(getContactSettings(db)).resolves.toMatchObject({ staleImportWeeks: 1 });
		await setStaleImportWeeks(db, admin, 52);
		await expect(getContactSettings(db)).resolves.toMatchObject({ staleImportWeeks: 52 });
	});

	it('keeps the areas when only the weeks are set', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		await setStaleImportWeeks(db, admin, 20);
		await expect(getContactSettings(db)).resolves.toStrictEqual({
			membersAreaId,
			partnersAreaId,
			staleImportWeeks: 20,
		});
	});
});

describe(setCustomFieldProtection, () => {
	it('lists the custom fields of a kind', async () => {
		const db = await createTestDb();
		const id = await insertNote(db);
		await expect(listCustomFields(db, 'member')).resolves.toStrictEqual([
			{
				id,
				kind: 'member',
				name: 'Notiz',
				placeholderKey: 'notiz',
				protection: 'protected',
				type: 'text',
			},
		]);
		await expect(listCustomFields(db, 'partner')).resolves.toStrictEqual([]);
	});

	it('orders custom fields created at the same time by name, not by their random id', async () => {
		// One import creates several fields in one transaction, so they share `now()`; PGlite's
		// clock even ties fields created a millisecond apart.
		const db = await createTestDb();
		const createdAt = new Date('2026-11-24T10:00:00.000Z');
		await db.insert(customFields).values([
			{
				createdAt,
				id: '00000000-0000-4000-8000-000000000001',
				kind: 'partner',
				name: 'Zahlweise',
				placeholderKey: 'zahlweise',
				type: 'text',
			},
			{
				createdAt,
				id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
				kind: 'partner',
				name: 'ansprechpartner',
				placeholderKey: 'ansprechpartner',
				type: 'text',
			},
			{
				createdAt,
				id: '88888888-8888-4888-8888-888888888888',
				kind: 'partner',
				name: 'Branche',
				placeholderKey: 'branche',
				type: 'text',
			},
		]);
		const fields = await listCustomFields(db, 'partner');
		expect(fields.map((field) => field.name)).toStrictEqual([
			'ansprechpartner',
			'Branche',
			'Zahlweise',
		]);
	});

	it('switches a custom field between base and protected', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const id = await insertNote(db);
		const key = customFieldKey(id);
		await expect(areasOf(db, 'member', key)).resolves.toStrictEqual([membersAreaId]);

		await setCustomFieldProtection(db, admin, { customFieldId: id, protection: 'base' });
		await expect(areasOf(db, 'member', key)).resolves.toBeUndefined();
		const entry = await lastAudit(db);
		expect(entry?.action).toBe('contacts.settings_changed');
		expect(entry?.details).toStrictEqual({ customFieldId: id, protection: 'base' });

		await setCustomFieldProtection(db, admin, { customFieldId: id, protection: 'protected' });
		await expect(areasOf(db, 'member', key)).resolves.toStrictEqual([membersAreaId]);
	});

	it('forgets the own areas of a field that becomes base', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		const id = await insertNote(db);
		const key = customFieldKey(id);
		await setFieldAreas(db, admin, { areaIds: [partnersAreaId], fieldKey: key, kind: 'member' });
		await expect(areasOf(db, 'member', key)).resolves.toStrictEqual([partnersAreaId]);
		await setCustomFieldProtection(db, admin, { customFieldId: id, protection: 'base' });
		await setCustomFieldProtection(db, admin, { customFieldId: id, protection: 'protected' });
		await expect(areasOf(db, 'member', key)).resolves.toStrictEqual([membersAreaId]);
	});

	it('refuses an unknown custom field', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await expect(
			setCustomFieldProtection(db, admin, { customFieldId: UNKNOWN_ID, protection: 'base' }),
		).rejects.toThrow('does not exist');
	});
});

describe('a setting changed in another tab', () => {
	it('refuses an unknown area as members or partners area and changes nothing', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		const before = await settingsChanges(db);
		await expect(
			setContactAreas(db, admin, { membersAreaId: UNKNOWN_ID, partnersAreaId }),
		).rejects.toBeInstanceOf(UnknownAreaError);
		await expect(
			setContactAreas(db, admin, { membersAreaId, partnersAreaId: UNKNOWN_ID }),
		).rejects.toBeInstanceOf(UnknownAreaError);
		await expect(getContactSettings(db)).resolves.toStrictEqual({
			membersAreaId,
			partnersAreaId,
			staleImportWeeks: 8,
		});
		await expect(settingsChanges(db)).resolves.toBe(before);
	});

	it('refuses an unknown area for a protected field and changes nothing', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const before = await settingsChanges(db);
		await expect(
			setFieldAreas(db, admin, {
				areaIds: [membersAreaId, UNKNOWN_ID],
				fieldKey: 'birthDate',
				kind: 'member',
			}),
		).rejects.toBeInstanceOf(UnknownAreaError);
		await expect(areasOf(db, 'member', 'birthDate')).resolves.toStrictEqual([membersAreaId]);
		await expect(settingsChanges(db)).resolves.toBe(before);
	});

	it('refuses the areas of a custom field that became a base field and changes nothing', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		const customFieldId = await insertNote(db);
		await setCustomFieldProtection(db, admin, { customFieldId, protection: 'base' });
		const before = await settingsChanges(db);
		const key = customFieldKey(customFieldId);
		await expect(
			setFieldAreas(db, admin, { areaIds: [partnersAreaId], fieldKey: key, kind: 'member' }),
		).rejects.toBeInstanceOf(NotProtectedFieldError);
		await expect(areasOf(db, 'member', key)).resolves.toBeUndefined();
		await expect(settingsChanges(db)).resolves.toBe(before);
		// Protected again, it starts from the members area: nothing of the refused areas stayed.
		await setCustomFieldProtection(db, admin, { customFieldId, protection: 'protected' });
		await expect(areasOf(db, 'member', key)).resolves.toStrictEqual([membersAreaId]);
	});

	it('refuses the protection of an unknown custom field and changes nothing', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const customFieldId = await insertNote(db);
		const before = await settingsChanges(db);
		await expect(
			setCustomFieldProtection(db, admin, { customFieldId: UNKNOWN_ID, protection: 'base' }),
		).rejects.toBeInstanceOf(UnknownCustomFieldError);
		await expect(listCustomFields(db, 'member')).resolves.toMatchObject([
			{ id: customFieldId, protection: 'protected' },
		]);
		await expect(settingsChanges(db)).resolves.toBe(before);
	});
});
