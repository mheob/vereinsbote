import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { setUpClub, userWith } from '@/server/contacts/testing';
import { auditLog, outboxEntries, senders } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';

import {
	SenderChangedError,
	SenderEmailTakenError,
	SenderInUseError,
	SenderInvalidError,
	SenderNotFoundError,
} from './errors';
import {
	createSender,
	deleteSender,
	listSenders,
	sendersForArea,
	setSystemSender,
	updateSender,
} from './senders';
import type { SenderInput } from './senders';
import { graphConnection, resendConnection, senderOn } from './testing';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const inputFor = (connectionId: string, email: string): SenderInput => ({
	archiveBcc: null,
	areaIds: [],
	connectionId,
	dailyLimit: null,
	displayName: 'Verein',
	email,
	perMinute: null,
	replyTo: null,
});

describe('sender management', () => {
	it('lets only admins manage senders', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const editor = await userWith(db, { [membersAreaId]: 'send' });
		const connectionId = await graphConnection(db, admin);
		const id = await senderOn(db, admin, connectionId, 'verein@example.org');
		const input = inputFor(connectionId, 'x@example.org');
		await expect(listSenders(db, editor)).rejects.toThrow(ForbiddenError);
		await expect(createSender(db, editor, input)).rejects.toThrow(ForbiddenError);
		await expect(updateSender(db, editor, id, input, 1)).rejects.toThrow(ForbiddenError);
		await expect(deleteSender(db, editor, id)).rejects.toThrow(ForbiddenError);
		await expect(setSystemSender(db, editor, id)).rejects.toThrow(ForbiddenError);
	});

	it('releases a sender to areas and lists it per area', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		const both = await senderOn(db, admin, connectionId, 'b@example.org', [
			membersAreaId,
			partnersAreaId,
		]);
		await senderOn(db, admin, connectionId, 'a@example.org', [membersAreaId]);
		await senderOn(db, admin, connectionId, 'none@example.org');
		const members = await sendersForArea(db, membersAreaId);
		expect(members.map((sender) => sender.email)).toStrictEqual(['a@example.org', 'b@example.org']);
		await expect(sendersForArea(db, partnersAreaId)).resolves.toStrictEqual([
			{ displayName: 'Verein', email: 'b@example.org', id: both },
		]);
	});

	it('lists the senders with their areas', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		const both = await senderOn(db, admin, connectionId, 'b@example.org', [
			membersAreaId,
			partnersAreaId,
		]);
		await senderOn(db, admin, connectionId, 'a@example.org');
		const listed = await listSenders(db, admin);
		expect(listed.map((sender) => sender.email)).toStrictEqual(['a@example.org', 'b@example.org']);
		expect(listed.find((sender) => sender.id === both)?.areaIds.toSorted()).toStrictEqual(
			[membersAreaId, partnersAreaId].toSorted(),
		);
	});

	it('takes an area away when the sender is saved without it', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		const id = await senderOn(db, admin, connectionId, 'b@example.org', [
			membersAreaId,
			partnersAreaId,
		]);
		const { version } = await updateSender(
			db,
			admin,
			id,
			{ ...inputFor(connectionId, 'b@example.org'), areaIds: [partnersAreaId] },
			1,
		);
		expect(version).toBe(2);
		await expect(sendersForArea(db, membersAreaId)).resolves.toStrictEqual([]);
	});

	it('refuses a stale version and an unknown sender', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		const id = await senderOn(db, admin, connectionId, 'b@example.org');
		const input = inputFor(connectionId, 'b@example.org');
		await updateSender(db, admin, id, input, 1);
		await expect(updateSender(db, admin, id, input, 1)).rejects.toThrow(SenderChangedError);
		await expect(updateSender(db, admin, UNKNOWN_ID, input, 1)).rejects.toThrow(
			SenderNotFoundError,
		);
	});

	it('refuses an area that does not exist', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		await expect(
			createSender(db, admin, {
				...inputFor(connectionId, 'c@example.org'),
				areaIds: [UNKNOWN_ID],
			}),
		).rejects.toMatchObject({ field: 'areaIds' });
	});

	it('keeps exactly one system sender', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		const first = await senderOn(db, admin, connectionId, 'first@example.org');
		const second = await senderOn(db, admin, connectionId, 'second@example.org');
		await setSystemSender(db, admin, first);
		await setSystemSender(db, admin, second);
		const listed = await listSenders(db, admin);
		const system = listed.filter((sender) => sender.isSystem);
		expect(system.map((sender) => sender.id)).toStrictEqual([second]);
	});

	it('clears the system sender and logs each choice', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		const first = await senderOn(db, admin, connectionId, 'first@example.org');
		await setSystemSender(db, admin, first);
		await setSystemSender(db, admin, null);
		const entries = await db.select().from(auditLog);
		const logged = entries.filter((entry) => entry.action === 'sender.system_set');
		const listed = await listSenders(db, admin);
		expect(listed.some((sender) => sender.isSystem)).toBe(false);
		expect(logged).toHaveLength(2);
	});

	it('refuses an unknown system sender and keeps the one that is set', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		const first = await senderOn(db, admin, connectionId, 'first@example.org');
		await setSystemSender(db, admin, first);
		await expect(setSystemSender(db, admin, UNKNOWN_ID)).rejects.toThrow(SenderNotFoundError);
		const listed = await listSenders(db, admin);
		expect(listed.filter((sender) => sender.isSystem)).toHaveLength(1);
	});

	it('refuses a second sender with the same address, case-insensitive', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		await senderOn(db, admin, connectionId, 'verein@example.org');
		await expect(
			createSender(db, admin, inputFor(connectionId, ' Verein@Example.ORG ')),
		).rejects.toThrow(SenderEmailTakenError);
	});

	it('refuses a change to an address another sender has', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		await senderOn(db, admin, connectionId, 'verein@example.org');
		const other = await senderOn(db, admin, connectionId, 'other@example.org');
		await expect(
			updateSender(db, admin, other, inputFor(connectionId, 'VEREIN@example.org'), 1),
		).rejects.toThrow(SenderEmailTakenError);
	});

	it('stores the address normalized and refuses a value that is no address', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		const { id } = await createSender(db, admin, inputFor(connectionId, ' Verein@Example.ORG '));
		const [row] = await db.select().from(senders).where(eq(senders.id, id));
		expect(row?.email).toBe('verein@example.org');
		await expect(createSender(db, admin, inputFor(connectionId, 'not an address'))).rejects.toThrow(
			SenderInvalidError,
		);
	});

	it('ignores perMinute and dailyLimit for resend senders', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const resendId = await resendConnection(db, admin);
		const { id } = await createSender(db, admin, {
			...inputFor(resendId, 'resend@example.org'),
			archiveBcc: ' Archiv@Example.org ',
			dailyLimit: 500,
			perMinute: 99,
		});
		const listed = await listSenders(db, admin);
		expect(listed.find((sender) => sender.id === id)).toMatchObject({
			archiveBcc: 'archiv@example.org',
			connectionKind: 'resend',
			dailyLimit: null,
			perMinute: null,
		});
	});

	it('keeps the limits of graph senders, defaults the rate and drops the archive address', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const graphId = await graphConnection(db, admin);
		const { id } = await createSender(db, admin, {
			...inputFor(graphId, 'graph@example.org'),
			archiveBcc: 'archiv@example.org',
			dailyLimit: 500,
			perMinute: 99,
		});
		const defaults = await senderOn(db, admin, graphId, 'default@example.org');
		const listed = await listSenders(db, admin);
		expect(listed.find((sender) => sender.id === id)).toMatchObject({
			archiveBcc: null,
			dailyLimit: 500,
			perMinute: 99,
		});
		expect(listed.find((sender) => sender.id === defaults)?.perMinute).toBe(30);
	});

	it('deletes a sender with its area releases', async () => {
		const db = await createTestDb();
		const { admin, membersAreaId } = await setUpClub(db);
		const connectionId = await graphConnection(db, admin);
		const id = await senderOn(db, admin, connectionId, 'verein@example.org', [membersAreaId]);
		await deleteSender(db, admin, id);
		await expect(sendersForArea(db, membersAreaId)).resolves.toStrictEqual([]);
		await expect(deleteSender(db, admin, id)).rejects.toThrow(SenderNotFoundError);
	});

	it.each(['planned', 'sending', 'uncertain'] as const)(
		'refuses to delete a sender with a %s outbox entry',
		async (status) => {
			const db = await createTestDb();
			const { admin } = await setUpClub(db);
			const id = await senderOn(db, admin, await graphConnection(db, admin), 'v@example.org');
			await db.insert(outboxEntries).values({
				priority: 'group',
				senderId: id,
				source: 'wave',
				sourceId: UNKNOWN_ID,
				status,
			});
			await expect(deleteSender(db, admin, id)).rejects.toThrow(SenderInUseError);
			await expect(deleteSender(db, admin, id)).rejects.toMatchObject({ reason: 'entries' });
			await expect(listSenders(db, admin)).resolves.toHaveLength(1);
		},
	);

	it('deletes a sender whose entries are done and keeps their history', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		const id = await senderOn(db, admin, await graphConnection(db, admin), 'v@example.org');
		const done = ['sent', 'bounced', 'failed', 'skipped', 'cancelled'] as const;
		await db.insert(outboxEntries).values(
			done.map((status) => ({
				priority: 'group' as const,
				senderId: id,
				source: 'wave' as const,
				sourceId: UNKNOWN_ID,
				status,
			})),
		);
		await deleteSender(db, admin, id);
		const rows = await db
			.select({ senderId: outboxEntries.senderId, status: outboxEntries.status })
			.from(outboxEntries);
		expect(rows).toHaveLength(done.length);
		expect(rows.every((row) => row.senderId === null)).toBe(true);
	});
});
