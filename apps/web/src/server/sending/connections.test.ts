import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { setUpClub, userWith } from '@/server/contacts/testing';
import { auditLog, mailConnections } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';

import {
	createConnection,
	deleteConnection,
	getConnection,
	listConnections,
	updateConnection,
} from './connections';
import type { ConnectionInput } from './connections';
import {
	ConnectionChangedError,
	ConnectionInUseError,
	ConnectionInvalidError,
	ConnectionNameTakenError,
	ConnectionNotFoundError,
} from './errors';
import { deleteSender } from './senders';
import { graphConnection, resendConnection, senderOn, testKey } from './testing';

const SECRET = 'graph-client-secret-1';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const graphInput = (overrides: Partial<Extract<ConnectionInput, { kind: 'graph' }>> = {}) =>
	({
		clientId: 'c',
		clientSecret: null,
		kind: 'graph',
		name: 'n',
		secretExpiresOn: '2028-01-31',
		tenantId: 't',
		...overrides,
	}) as const;

describe('connection management', () => {
	it('lets only admins manage connections', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [membersAreaId]: 'send' });
		const id = await graphConnection(db, admin);
		const key = await testKey();
		const input = graphInput({ clientSecret: 's' });
		await expect(listConnections(db, editor)).rejects.toThrow(ForbiddenError);
		await expect(getConnection(db, editor, id)).rejects.toThrow(ForbiddenError);
		await expect(createConnection(db, editor, input, key)).rejects.toThrow(ForbiddenError);
		await expect(updateConnection(db, editor, id, input, 1, key)).rejects.toThrow(ForbiddenError);
		await expect(deleteConnection(db, editor, id)).rejects.toThrow(ForbiddenError);
	});

	it('stores secrets encrypted', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await graphConnection(db, admin);
		const resendId = await resendConnection(db, admin);
		const rows = await db.select().from(mailConnections);
		const resend = rows.find((row) => row.id === resendId);
		expect(rows.every((row) => row.secretCiphertext.startsWith('v2.'))).toBe(true);
		expect(rows.some((row) => row.secretCiphertext.includes(SECRET))).toBe(false);
		expect(resend?.webhookSecretCiphertext?.startsWith('v2.')).toBe(true);
	});

	it('never returns a secret', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const graphId = await graphConnection(db, admin);
		await resendConnection(db, admin);
		const listed = await listConnections(db, admin);
		const detail = await getConnection(db, admin, graphId);
		const json = JSON.stringify([listed, detail]);
		expect(json).not.toContain(SECRET);
		expect(json).not.toContain('re_test_key_1');
		expect(json).not.toContain('v2.');
		expect(detail).toMatchObject({ hasWebhookSecret: false, tenantId: 'tenant-1' });
	});

	it('logs the changes without a secret', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await graphConnection(db, admin);
		const entries = await db.select().from(auditLog);
		const logged = entries.filter((entry) => entry.action !== 'setup.completed');
		expect(logged.map((entry) => entry.action)).toStrictEqual(['connection.created']);
		expect(JSON.stringify(logged)).not.toContain(SECRET);
	});

	it('keeps the secret when the field is empty', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const id = await graphConnection(db, admin);
		const [before] = await db.select().from(mailConnections).where(eq(mailConnections.id, id));
		const { version } = await updateConnection(
			db,
			admin,
			id,
			graphInput({ clientId: 'client-id-2', name: 'Renamed' }),
			1,
			await testKey(),
		);
		const [after] = await db.select().from(mailConnections).where(eq(mailConnections.id, id));
		expect(version).toBe(2);
		expect(after?.secretCiphertext).toBe(before?.secretCiphertext);
		expect(after).toMatchObject({
			clientId: 'client-id-2',
			name: 'Renamed',
			secretExpiresOn: '2028-01-31',
		});
	});

	it('replaces the secret when one is typed', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const id = await graphConnection(db, admin);
		const [before] = await db.select().from(mailConnections).where(eq(mailConnections.id, id));
		await updateConnection(
			db,
			admin,
			id,
			graphInput({ clientSecret: 'a-new-secret' }),
			1,
			await testKey(),
		);
		const [after] = await db.select().from(mailConnections).where(eq(mailConnections.id, id));
		expect(after?.secretCiphertext).not.toBe(before?.secretCiphertext);
	});

	it('refuses deleting a connection with senders', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const id = await graphConnection(db, admin);
		await senderOn(db, admin, id, 'verein@example.org');
		await expect(deleteConnection(db, admin, id)).rejects.toThrow(ConnectionInUseError);
		await expect(deleteConnection(db, admin, id)).rejects.toMatchObject({ senders: 1 });
	});

	it('deletes a connection without senders', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const id = await graphConnection(db, admin);
		const senderId = await senderOn(db, admin, id, 'verein@example.org');
		await deleteSender(db, admin, senderId);
		await deleteConnection(db, admin, id);
		await expect(listConnections(db, admin)).resolves.toStrictEqual([]);
		await expect(deleteConnection(db, admin, id)).rejects.toThrow(ConnectionNotFoundError);
	});

	it('refuses a stale version', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const id = await graphConnection(db, admin);
		const key = await testKey();
		await updateConnection(db, admin, id, graphInput({ name: 'Again' }), 1, key);
		await expect(updateConnection(db, admin, id, graphInput(), 1, key)).rejects.toThrow(
			ConnectionChangedError,
		);
	});

	it('refuses an unknown connection', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await expect(
			updateConnection(db, admin, UNKNOWN_ID, graphInput(), 1, await testKey()),
		).rejects.toThrow(ConnectionNotFoundError);
	});

	it('refuses a name that is taken, ignoring case', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await graphConnection(db, admin, 'Microsoft 365');
		await expect(graphConnection(db, admin, ' MICROSOFT 365 ')).rejects.toThrow(
			ConnectionNameTakenError,
		);
	});

	it('refuses a missing secret and a name or date that is invalid', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const key = await testKey();
		const create = async (
			overrides: Partial<Extract<ConnectionInput, { kind: 'graph' }>>,
		): Promise<{ id: string }> =>
			createConnection(db, admin, graphInput({ clientSecret: 's', ...overrides }), key);
		await expect(create({ clientSecret: null })).rejects.toThrow(ConnectionInvalidError);
		await expect(create({ secretExpiresOn: '2027-02-30' })).rejects.toMatchObject({
			field: 'secretExpiresOn',
		});
		await expect(create({ name: '  ' })).rejects.toMatchObject({ field: 'name' });
	});

	it('refuses a resend limit that is not a positive whole number', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const input = {
			apiKey: 'k',
			dailyLimit: 0,
			kind: 'resend',
			name: 'r',
			perMinute: 5,
			webhookSecret: null,
		} as const;
		await expect(createConnection(db, admin, input, await testKey())).rejects.toMatchObject({
			field: 'dailyLimit',
		});
	});
});
