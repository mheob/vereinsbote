import { randomUUID } from 'node:crypto';

import type { Db } from '@/server/db/client';
import { areaMemberships, contacts } from '@/server/db/schema';
import type { AccessLevel } from '@/server/permissions/levels';
import { loadPrincipal } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { completeSetup } from '@/server/setup/setup';
import { insertUser } from '@/server/users/repo';

import type { ContactKind } from './fields';
import { getContactSettings } from './settings';

const SETUP_TOKEN = 'test-setup-token-for-clubs';

/**
 * Loads a principal that must exist.
 *
 * @param db The database.
 * @param userId The user.
 * @returns The principal.
 */
async function principalOf(db: Db, userId: string): Promise<Principal> {
	const principal = await loadPrincipal(db, userId);
	if (principal === null) throw new Error('The test user has no principal.');
	return principal;
}

/**
 * Sets a club up through the real setup: the admin (with `edit` in "Mitglieder") and the areas
 * "Mitglieder" (members) and "Finanzen" (partners). For tests only.
 *
 * @param db The test database.
 * @returns The admin and the ids of the two areas.
 */
async function setUpClub(
	db: Db,
): Promise<{ admin: Principal; membersAreaId: string; partnersAreaId: string }> {
	const { adminUserId } = await completeSetup(db, {
		adminEmail: 'admin@example.org',
		adminName: 'Test Admin',
		expectedToken: SETUP_TOKEN,
		token: SETUP_TOKEN,
	});
	const { membersAreaId, partnersAreaId } = await getContactSettings(db);
	if (membersAreaId === null || partnersAreaId === null) {
		throw new Error('The setup did not set the contact areas.');
	}
	return { admin: await principalOf(db, adminUserId), membersAreaId, partnersAreaId };
}

/**
 * Creates an active user with the given area levels. For tests only.
 *
 * @param db The test database.
 * @param levels The access level per area id.
 * @param options `isAdmin` makes the user an admin.
 * @returns The user's principal.
 */
async function userWith(
	db: Db,
	levels: Readonly<Record<string, AccessLevel>>,
	options: Readonly<{ isAdmin?: boolean }> = {},
): Promise<Principal> {
	const { id } = await insertUser(db, {
		email: `user-${randomUUID()}@example.org`,
		isAdmin: options.isAdmin ?? false,
		name: 'Test User',
		status: 'active',
	});
	const entries = Object.entries(levels);
	if (entries.length > 0) {
		await db
			.insert(areaMemberships)
			.values(entries.map(([areaId, level]) => ({ areaId, level, userId: id })));
	}
	return principalOf(db, id);
}

/**
 * Inserts a contact. A member without a number gets a unique one, a partner without number and
 * address gets a unique address. For tests only.
 *
 * @param db The test database.
 * @param values The columns to set; `kind` is required.
 * @returns The id of the contact.
 */
async function insertContact(
	db: Db,
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle's insert type has mutable arrays
	values: Partial<typeof contacts.$inferInsert> & { kind: ContactKind },
): Promise<string> {
	const unique = randomUUID().slice(0, 8);
	const filled: typeof contacts.$inferInsert = { ...values };
	if (values.kind === 'member' && values.memberNumber === undefined) {
		filled.memberNumber = `M-${unique}`;
	}
	if (
		values.kind === 'partner' &&
		values.customerNumber === undefined &&
		values.email === undefined
	) {
		filled.email = `partner-${unique}@example.org`;
	}
	const [row] = await db.insert(contacts).values(filled).returning({ id: contacts.id });
	if (row === undefined) throw new Error('Inserting the contact returned no row.');
	return row.id;
}

export { insertContact, setUpClub, userWith };
