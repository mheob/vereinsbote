import { describe, expect, it } from 'vite-plus/test';

import { auditLog, user } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { insertUser } from '@/server/users/repo';

import { writeAudit } from './audit';

describe(writeAudit, () => {
	it('stores an entry with details', async () => {
		const db = await createTestDb();
		await writeAudit(db, {
			action: 'area.created',
			actorUserId: null,
			details: { name: 'Finanzen' },
			target: 'area:1',
		});
		const rows = await db.select().from(auditLog);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			action: 'area.created',
			actorUserId: null,
			details: { name: 'Finanzen' },
			target: 'area:1',
		});
	});

	it('stores an entry without target and details, at the given time', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, { email: 'a@v.de', name: 'A', status: 'active' });
		const at = new Date('2026-01-02T03:04:05Z');
		await writeAudit(db, { action: 'setup.completed', actorUserId: id, at });
		const [row] = await db.select().from(auditLog);
		expect(row).toMatchObject({
			action: 'setup.completed',
			actorUserId: id,
			details: null,
			target: null,
		});
		expect(row?.at.toISOString()).toBe(at.toISOString());
	});

	it('keeps the entry when the actor is deleted', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, { email: 'a@v.de', name: 'A', status: 'active' });
		await writeAudit(db, { action: 'user.invited', actorUserId: id });
		await db.delete(user);
		const [row] = await db.select().from(auditLog);
		expect(row).toMatchObject({ action: 'user.invited', actorUserId: null });
	});
});
