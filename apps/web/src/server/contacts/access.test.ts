import { describe, expect, it } from 'vite-plus/test';

import { createArea } from '@/server/areas/areas';
import type { Db } from '@/server/db/client';
import { customFields } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError, loadPrincipal } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { setAreaLevel } from '@/server/users/users';

import { assertCanList, assertCanManage, loadContactAccess } from './access';
import type { ContactAccess } from './access';
import { customFieldKey } from './fields';
import type { FieldKey, Protection } from './fields';
import { setFieldAreas } from './settings';
import { setUpClub, userWith } from './testing';

/**
 * Creates a custom text field of the kind `member`.
 *
 * @param db The database.
 * @param name The name of the field.
 * @param protection Whether everybody sees it (`base`) or the field protection applies.
 * @returns The id of the field.
 */
async function insertMemberField(db: Db, name: string, protection: Protection): Promise<string> {
	const [row] = await db
		.insert(customFields)
		.values({ kind: 'member', name, protection, type: 'text' })
		.returning({ id: customFields.id });
	if (row === undefined) throw new Error('Inserting the custom field returned no row.');
	return row.id;
}

/**
 * The visible fields of both kinds as sorted lists, easier to compare than sets.
 *
 * @param access The access.
 * @returns The sorted field keys per kind.
 */
function visibleLists(access: ContactAccess): { member: FieldKey[]; partner: FieldKey[] } {
	return {
		member: [...access.visible.member].toSorted(),
		partner: [...access.visible.partner].toSorted(),
	};
}

/**
 * Loads the access of a user who must exist.
 *
 * @param db The database.
 * @param userId The user.
 * @returns The access.
 */
async function accessOfUser(db: Db, userId: string): Promise<ContactAccess> {
	const principal: Principal | null = await loadPrincipal(db, userId);
	if (principal === null) throw new Error('The user has no principal.');
	return loadContactAccess(db, principal);
}

describe(loadContactAccess, () => {
	it('gives the admin role alone no access', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		// The setup gave the admin `edit` in the members area.
		await setAreaLevel(db, admin, { areaId: membersAreaId, level: null, userId: admin.userId });
		const access = await accessOfUser(db, admin.userId);
		expect(access).toMatchObject({ canList: false, canManage: { member: false, partner: false } });
		expect(visibleLists(access)).toStrictEqual({ member: [], partner: [] });
		expect(() => {
			assertCanList(access);
		}).toThrow(ForbiddenError);
	});

	it('gives the first admin the members area through the setup', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const access = await loadContactAccess(db, admin);
		expect(access).toMatchObject({ canList: true, canManage: { member: true, partner: false } });
		expect(visibleLists(access)).toStrictEqual({
			member: ['address', 'birthDate', 'entryDate', 'exitDate'],
			partner: [],
		});
	});

	it('lets edit in the kind area manage that kind only', async () => {
		const db = await createTestDb();
		const { partnersAreaId } = await setUpClub(db);
		const access = await loadContactAccess(db, await userWith(db, { [partnersAreaId]: 'edit' }));
		expect(access).toMatchObject({ canList: true, canManage: { member: false, partner: true } });
		expect(visibleLists(access)).toStrictEqual({ member: [], partner: ['address', 'birthDate'] });
		expect(() => {
			assertCanList(access);
		}).not.toThrow();
		expect(() => {
			assertCanManage(access, 'partner');
		}).not.toThrow();
		expect(() => {
			assertCanManage(access, 'member');
		}).toThrow(ForbiddenError);
	});

	it('lets read list but not manage', async () => {
		const db = await createTestDb();
		const { membersAreaId } = await setUpClub(db);
		const access = await loadContactAccess(db, await userWith(db, { [membersAreaId]: 'read' }));
		expect(access).toMatchObject({ canList: true, canManage: { member: false, partner: false } });
		expect(() => {
			assertCanManage(access, 'member');
		}).toThrow(ForbiddenError);
		expect(() => {
			assertCanManage(access, 'partner');
		}).toThrow(ForbiddenError);
	});

	it('lets read in an area without a contact role list but see no protected field', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const { areaId } = await createArea(db, admin, 'Jugend');
		const access = await loadContactAccess(db, await userWith(db, { [areaId]: 'send' }));
		expect(access).toMatchObject({ canList: true, canManage: { member: false, partner: false } });
		expect(visibleLists(access)).toStrictEqual({ member: [], partner: [] });
	});

	it('gives nobody management while the contact areas are not set', async () => {
		const db = await createTestDb();
		const admin = await userWith(db, {}, { isAdmin: true });
		const { areaId } = await createArea(db, admin, 'Mitglieder');
		const access = await loadContactAccess(db, await userWith(db, { [areaId]: 'send' }));
		expect(access).toMatchObject({ canList: true, canManage: { member: false, partner: false } });
		expect(visibleLists(access)).toStrictEqual({ member: [], partner: [] });
	});

	it('shows a field assigned to a further area to readers of that area', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		await setFieldAreas(db, admin, {
			areaIds: [membersAreaId, partnersAreaId],
			fieldKey: 'birthDate',
			kind: 'member',
		});
		const finance = await loadContactAccess(db, await userWith(db, { [partnersAreaId]: 'read' }));
		expect(visibleLists(finance)).toStrictEqual({
			member: ['birthDate'],
			partner: ['address', 'birthDate'],
		});
		const members = await loadContactAccess(db, await userWith(db, { [membersAreaId]: 'read' }));
		expect(visibleLists(members)).toStrictEqual({
			member: ['address', 'birthDate', 'entryDate', 'exitDate'],
			partner: [],
		});
	});

	it('hides a field from the kind area once it is assigned elsewhere only', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		await setFieldAreas(db, admin, {
			areaIds: [partnersAreaId],
			fieldKey: 'address',
			kind: 'member',
		});
		const members = await loadContactAccess(db, await userWith(db, { [membersAreaId]: 'read' }));
		expect(visibleLists(members).member).toStrictEqual(['birthDate', 'entryDate', 'exitDate']);
	});

	it('always shows base custom fields', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		const { areaId: youthAreaId } = await createArea(db, admin, 'Jugend');
		const baseId = await insertMemberField(db, 'Trikotgröße', 'base');
		const protectedId = await insertMemberField(db, 'Notiz', 'protected');
		const base = customFieldKey(baseId);
		const secret = customFieldKey(protectedId);

		const youth = await loadContactAccess(db, await userWith(db, { [youthAreaId]: 'read' }));
		expect(visibleLists(youth)).toStrictEqual({ member: [base], partner: [] });
		const finance = await loadContactAccess(db, await userWith(db, { [partnersAreaId]: 'read' }));
		expect(visibleLists(finance)).toStrictEqual({
			member: [base],
			partner: ['address', 'birthDate'],
		});
		const members = await loadContactAccess(db, await userWith(db, { [membersAreaId]: 'read' }));
		expect(visibleLists(members).member).toStrictEqual(
			['address', 'birthDate', 'entryDate', 'exitDate', base, secret].toSorted(),
		);
	});
});
