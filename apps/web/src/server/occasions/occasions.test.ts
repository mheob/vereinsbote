import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { emptyTemplate } from '@/mail/starters/starters';
import { createArea } from '@/server/areas/areas';
import { UnknownAreaError } from '@/server/contacts/errors';
import { setUpClub, userWith } from '@/server/contacts/testing';
import { areas, auditLog, contactOptOuts, occasions } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { SenderAreaInUseError, SenderInUseError } from '@/server/sending/errors';
import { deleteSender, updateSender } from '@/server/sending/senders';
import type { SenderInput } from '@/server/sending/senders';
import { graphConnection, senderOn } from '@/server/sending/testing';
import { TemplateInUseError } from '@/server/templates/errors';
import { deleteTemplate } from '@/server/templates/templates';
import { createTemplate } from '@/server/templates/testing';
import { insertWave } from '@/server/waves/testing';

import {
	OccasionChangedError,
	OccasionInvalidError,
	OccasionNameTakenError,
	OccasionNotFoundError,
} from './errors';
import {
	createOccasion,
	defaultUnsubscribe,
	getOccasion,
	listOccasions,
	removeOccasion,
	updateOccasion,
} from './occasions';
import type { OccasionInput } from './occasions';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

type Db = Awaited<ReturnType<typeof createTestDb>>;

interface Club {
	readonly db: Db;
	readonly admin: Principal;
	/** `edit` in "Mitglieder". */
	readonly editor: Principal;
	readonly membersAreaId: string;
	readonly partnersAreaId: string;
	readonly eventsAreaId: string;
	readonly connectionId: string;
	/** A template of "Mitglieder". */
	readonly templateId: string;
	/** A sender released to "Mitglieder". */
	readonly senderId: string;
}

/**
 * A club with the areas "Mitglieder", "Partner" and "Veranstaltungen", one template and one sender
 * released to "Mitglieder".
 *
 * @returns The club.
 */
async function club(): Promise<Club> {
	const db = await createTestDb();
	const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
	const { areaId: eventsAreaId } = await createArea(db, admin, 'Veranstaltungen');
	const editor = await userWith(db, { [eventsAreaId]: 'edit', [membersAreaId]: 'edit' });
	const connectionId = await graphConnection(db, admin);
	const senderId = await senderOn(db, admin, connectionId, 'verein@example.org', [membersAreaId]);
	const { id: templateId } = await createTemplate(
		db,
		editor,
		membersAreaId,
		emptyTemplate({ name: 'Einladung', subject: 'Sommerfest' }),
	);
	return {
		admin,
		connectionId,
		db,
		editor,
		eventsAreaId,
		membersAreaId,
		partnersAreaId,
		senderId,
		templateId,
	};
}

const inputFor = (c: Club, overrides: Partial<OccasionInput> = {}): OccasionInput => ({
	kind: 'circular',
	name: 'Einladungen',
	senderId: c.senderId,
	templateId: c.templateId,
	unsubscribe: true,
	...overrides,
});

/**
 * The audit entries of an action.
 *
 * @param db The database.
 * @param action The action.
 * @returns Target and details of each.
 */
async function auditOf(
	db: Db,
	action: typeof auditLog.$inferSelect.action,
): Promise<{ target: string | null; details: unknown }[]> {
	return db
		.select({ details: auditLog.details, target: auditLog.target })
		.from(auditLog)
		.where(eq(auditLog.action, action));
}

/**
 * All occasion rows.
 *
 * @param db The database.
 * @returns The rows.
 */
async function occasionsOf(db: Db): Promise<unknown[]> {
	return db.select().from(occasions);
}

/**
 * What a promise is refused with.
 *
 * @param promise The promise.
 * @returns The error, or null when it resolved.
 */
async function refusal(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
		return null;
	} catch (error) {
		return error;
	}
}

/**
 * Archives an occasion: gives it a wave, then removes it.
 *
 * @param c The club.
 * @param id The occasion.
 * @param version The version the removal is based on.
 * @returns What the removal gave.
 */
async function archive(c: Club, id: string, version = 1): Promise<'archived' | 'deleted'> {
	await insertWave(c.db, id);
	return removeOccasion(c.db, c.editor, id, version);
}

/**
 * A template of "Veranstaltungen" and a sender released only to that area.
 *
 * @param c The club.
 * @returns Their ids.
 */
async function foreign(c: Club): Promise<{ templateId: string; senderId: string }> {
	const { id: templateId } = await createTemplate(
		c.db,
		c.editor,
		c.eventsAreaId,
		emptyTemplate({ name: 'Einladung', subject: 'Fest' }),
	);
	const senderId = await senderOn(c.db, c.admin, c.connectionId, 'andere@example.org', [
		c.eventsAreaId,
	]);
	return { senderId, templateId };
}

const release = (c: Club, areaIds: readonly string[]): SenderInput => ({
	archiveBcc: null,
	areaIds,
	connectionId: c.connectionId,
	dailyLimit: null,
	displayName: 'Verein',
	email: 'verein@example.org',
	perMinute: null,
	replyTo: null,
});

const optOut = (occasionId: string): typeof contactOptOuts.$inferInsert => ({
	contactKey: 'nr:1001',
	kind: 'member',
	occasionId,
	scope: 'occasion',
});

describe('occasion rights', () => {
	it('creates occasions with read, edit and send rights as in design 18', async () => {
		const c = await club();
		const reader = await userWith(c.db, { [c.membersAreaId]: 'read' });
		const sender = await userWith(c.db, { [c.membersAreaId]: 'send' });
		const adminWithoutArea = await userWith(c.db, {}, { isAdmin: true });
		const input = inputFor(c);
		await expect(createOccasion(c.db, reader, c.membersAreaId, input)).rejects.toThrow(
			ForbiddenError,
		);
		await expect(createOccasion(c.db, adminWithoutArea, c.membersAreaId, input)).rejects.toThrow(
			ForbiddenError,
		);
		await expect(createOccasion(c.db, c.editor, c.membersAreaId, input)).resolves.toHaveProperty(
			'id',
		);
		const named = inputFor(c, { name: 'Rundbrief' });
		await expect(createOccasion(c.db, sender, c.membersAreaId, named)).resolves.toHaveProperty(
			'id',
		);
		await expect(occasionsOf(c.db)).resolves.toHaveLength(2);
	});

	it('lets readers see an occasion and nobody without rights change it', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		const reader = await userWith(c.db, { [c.membersAreaId]: 'read' });
		const other = await userWith(c.db, { [c.eventsAreaId]: 'read' });
		await expect(getOccasion(c.db, reader, id)).resolves.toStrictEqual({
			archivedAt: null,
			areaId: c.membersAreaId,
			id,
			kind: 'circular',
			lastWaveAt: null,
			name: 'Einladungen',
			senderId: c.senderId,
			templateId: c.templateId,
			trigger: 'manual',
			unsubscribe: true,
			version: 1,
			waves: 0,
		});
		await expect(listOccasions(c.db, reader)).resolves.toHaveLength(1);
		await expect(listOccasions(c.db, other)).resolves.toStrictEqual([]);
		await expect(getOccasion(c.db, other, id)).rejects.toThrow(ForbiddenError);
		await expect(updateOccasion(c.db, reader, id, inputFor(c), 1)).rejects.toThrow(ForbiddenError);
	});

	it('lets readers remove nothing', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		const reader = await userWith(c.db, { [c.membersAreaId]: 'read' });
		await expect(removeOccasion(c.db, reader, id, 1)).rejects.toThrow(ForbiddenError);
	});
});

describe('occasion names', () => {
	it('lists the occasions of readable areas by name', async () => {
		const c = await club();
		await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c, { name: ' b-Rundbrief ' }));
		await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c, { name: 'A-Einladung' }));
		const list = await listOccasions(c.db, c.editor);
		expect(list.map(({ name }) => name)).toStrictEqual(['A-Einladung', 'b-Rundbrief']);
	});

	it('keeps a name unique in its area, ignoring case', async () => {
		const c = await club();
		await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c, { name: 'A-Einladung' }));
		const same = inputFor(c, { name: 'a-einladung' });
		await expect(createOccasion(c.db, c.editor, c.membersAreaId, same)).rejects.toThrow(
			OccasionNameTakenError,
		);
		// Another area may use it.
		const { id: eventsTemplate } = await createTemplate(
			c.db,
			c.editor,
			c.eventsAreaId,
			emptyTemplate({ name: 'Einladung', subject: 'Fest' }),
		);
		const eventsSender = await senderOn(c.db, c.admin, c.connectionId, 'fest@example.org', [
			c.eventsAreaId,
		]);
		const events = { ...same, senderId: eventsSender, templateId: eventsTemplate };
		await expect(createOccasion(c.db, c.editor, c.eventsAreaId, events)).resolves.toHaveProperty(
			'id',
		);
	});

	it('refuses an empty or too long name', async () => {
		const c = await club();
		const empty = inputFor(c, { name: '  ' });
		const long = inputFor(c, { name: 'x'.repeat(101) });
		const first = refusal(createOccasion(c.db, c.editor, c.membersAreaId, empty));
		const second = refusal(createOccasion(c.db, c.editor, c.membersAreaId, long));
		await expect(first).resolves.toMatchObject({ problem: 'name' });
		await expect(second).resolves.toBeInstanceOf(OccasionInvalidError);
	});

	it('presets the unsubscribe link by kind', () => {
		expect(defaultUnsubscribe('circular')).toBe(true);
		expect(defaultUnsubscribe('personal')).toBe(false);
	});
});

describe('template and sender of an occasion', () => {
	it('refuses a template of another area', async () => {
		const c = await club();
		const { templateId } = await foreign(c);
		const input = inputFor(c, { templateId });
		const created = refusal(createOccasion(c.db, c.editor, c.membersAreaId, input));
		await expect(created).resolves.toBeInstanceOf(OccasionInvalidError);
		await expect(created).resolves.toMatchObject({ problem: 'templateArea' });
		const gone = inputFor(c, { templateId: UNKNOWN_ID });
		const missing = refusal(createOccasion(c.db, c.editor, c.membersAreaId, gone));
		await expect(missing).resolves.toMatchObject({ problem: 'templateArea' });
		await expect(occasionsOf(c.db)).resolves.toHaveLength(0);
	});

	it('refuses a sender not released to the area', async () => {
		const c = await club();
		const { senderId } = await foreign(c);
		const input = inputFor(c, { senderId });
		const created = refusal(createOccasion(c.db, c.editor, c.membersAreaId, input));
		await expect(created).resolves.toBeInstanceOf(OccasionInvalidError);
		await expect(created).resolves.toMatchObject({ problem: 'senderNotReleased' });
		const gone = inputFor(c, { senderId: UNKNOWN_ID });
		const missing = refusal(createOccasion(c.db, c.editor, c.membersAreaId, gone));
		await expect(missing).resolves.toMatchObject({ problem: 'senderNotReleased' });
		await expect(occasionsOf(c.db)).resolves.toHaveLength(0);
	});

	it('checks both again when an occasion is changed', async () => {
		const c = await club();
		const { senderId, templateId } = await foreign(c);
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		const otherSender = inputFor(c, { senderId });
		const otherTemplate = inputFor(c, { templateId });
		await expect(updateOccasion(c.db, c.editor, id, otherSender, 1)).rejects.toThrow(
			OccasionInvalidError,
		);
		await expect(updateOccasion(c.db, c.editor, id, otherTemplate, 1)).rejects.toThrow(
			OccasionInvalidError,
		);
		await expect(getOccasion(c.db, c.editor, id)).resolves.toMatchObject({ version: 1 });
	});

	it('blocks deleting a template that an occasion uses', async () => {
		const c = await club();
		await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c, { name: 'B-Rundbrief' }));
		await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c, { name: 'A-Einladungen' }));
		const error = refusal(deleteTemplate(c.db, c.editor, c.templateId, 1));
		await expect(error).resolves.toBeInstanceOf(TemplateInUseError);
		await expect(error).resolves.toMatchObject({ occasions: ['A-Einladungen', 'B-Rundbrief'] });
	});

	it('blocks deleting a template that an archived occasion uses', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		await archive(c, id);
		await expect(deleteTemplate(c.db, c.editor, c.templateId, 1)).rejects.toThrow(
			TemplateInUseError,
		);
	});

	it('keeps a template of an occasion even when the check is bypassed', async () => {
		const c = await club();
		await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		// The foreign key is the net under the check: a direct delete is refused by the database.
		const direct = c.db.execute(sql`delete from templates where id = ${c.templateId}`);
		await expect(direct).rejects.toThrow();
	});
});

describe('changing an occasion', () => {
	it('changes an occasion under its version', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		const changed = inputFor(c, { kind: 'personal', unsubscribe: false });
		await expect(updateOccasion(c.db, c.editor, id, changed, 1)).resolves.toStrictEqual({
			version: 2,
		});
		await expect(updateOccasion(c.db, c.editor, id, inputFor(c), 1)).rejects.toThrow(
			OccasionChangedError,
		);
		await expect(getOccasion(c.db, c.editor, id)).resolves.toMatchObject({
			kind: 'personal',
			unsubscribe: false,
			version: 2,
		});
	});

	it('refuses a name another occasion of the area has', async () => {
		const c = await club();
		await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		const other = await createOccasion(
			c.db,
			c.editor,
			c.membersAreaId,
			inputFor(c, { name: 'Rundbrief' }),
		);
		const taken = inputFor(c, { name: 'EINLADUNGEN' });
		await expect(updateOccasion(c.db, c.editor, other.id, taken, 1)).rejects.toThrow(
			OccasionNameTakenError,
		);
	});

	it('refuses unknown occasions and areas', async () => {
		const c = await club();
		await expect(updateOccasion(c.db, c.editor, UNKNOWN_ID, inputFor(c), 1)).rejects.toThrow(
			OccasionNotFoundError,
		);
		await expect(getOccasion(c.db, c.editor, UNKNOWN_ID)).rejects.toThrow(OccasionNotFoundError);
		await expect(removeOccasion(c.db, c.editor, UNKNOWN_ID, 1)).rejects.toThrow(
			OccasionNotFoundError,
		);
		await expect(createOccasion(c.db, c.editor, UNKNOWN_ID, inputFor(c))).rejects.toThrow(
			ForbiddenError,
		);
	});

	it('refuses an occasion in an area that is gone', async () => {
		const c = await club();
		const { areaId } = await createArea(c.db, c.admin, 'Archiv');
		const archivist = await userWith(c.db, { [areaId]: 'edit' });
		await c.db.delete(areas).where(eq(areas.id, areaId));
		await expect(createOccasion(c.db, archivist, areaId, inputFor(c))).rejects.toThrow(
			UnknownAreaError,
		);
	});

	it('logs ids and the area, never names', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		await updateOccasion(c.db, c.editor, id, inputFor(c, { kind: 'personal' }), 1);
		await removeOccasion(c.db, c.editor, id, 2);
		const entry = [{ details: { areaId: c.membersAreaId }, target: `occasion:${id}` }];
		await expect(auditOf(c.db, 'occasion.created')).resolves.toStrictEqual(entry);
		await expect(auditOf(c.db, 'occasion.updated')).resolves.toStrictEqual(entry);
		await expect(auditOf(c.db, 'occasion.deleted')).resolves.toStrictEqual(entry);
	});
});

describe('removing an occasion', () => {
	it('deletes an occasion without waves', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		await expect(removeOccasion(c.db, c.editor, id, 2)).rejects.toThrow(OccasionChangedError);
		await expect(removeOccasion(c.db, c.editor, id, 1)).resolves.toBe('deleted');
		await expect(getOccasion(c.db, c.editor, id)).rejects.toThrow(OccasionNotFoundError);
		await expect(removeOccasion(c.db, c.editor, id, 1)).rejects.toThrow(OccasionNotFoundError);
	});

	it('archives an occasion with waves', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		await expect(archive(c, id)).resolves.toBe('archived');
		const archived = await getOccasion(c.db, c.editor, id);
		expect(archived.archivedAt).toBeInstanceOf(Date);
		expect(archived).toMatchObject({ version: 2, waves: 1 });
		await expect(auditOf(c.db, 'occasion.archived')).resolves.toStrictEqual([
			{ details: { areaId: c.membersAreaId }, target: `occasion:${id}` },
		]);
		await expect(listOccasions(c.db, c.editor)).resolves.toHaveLength(1);
	});

	it('counts the waves of an occasion and tells the latest', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		const other = await createOccasion(
			c.db,
			c.editor,
			c.membersAreaId,
			inputFor(c, { name: 'Rundbrief' }),
		);
		const latest = new Date('2026-11-20T10:00:00.000Z');
		await insertWave(c.db, id, { createdAt: new Date('2026-10-01T10:00:00.000Z') });
		await insertWave(c.db, id, { createdAt: latest });
		await expect(getOccasion(c.db, c.editor, id)).resolves.toMatchObject({
			lastWaveAt: latest,
			waves: 2,
		});
		const listed = await listOccasions(c.db, c.editor);
		expect(listed.map(({ lastWaveAt, waves }) => ({ lastWaveAt, waves }))).toStrictEqual([
			{ lastWaveAt: latest, waves: 2 },
			{ lastWaveAt: null, waves: 0 },
		]);
		expect(listed.map((occasion) => occasion.id)).toStrictEqual([id, other.id]);
	});

	it('cannot change or remove an archived occasion', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		await archive(c, id);
		const refused = refusal(updateOccasion(c.db, c.editor, id, inputFor(c), 2));
		await expect(refused).resolves.toMatchObject({ problem: 'archived' });
		await expect(removeOccasion(c.db, c.editor, id, 2)).rejects.toThrow(OccasionInvalidError);
	});
});

describe('senders and occasions', () => {
	it('blocks removing a sender release that an occasion uses', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		const withoutMembers = release(c, [c.eventsAreaId]);
		const refused = refusal(updateSender(c.db, c.admin, c.senderId, withoutMembers, 1));
		await expect(refused).resolves.toBeInstanceOf(SenderAreaInUseError);
		await expect(refused).resolves.toMatchObject({ occasions: [id] });
	});

	it('lets a release go that no occasion uses', async () => {
		const c = await club();
		await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		const both = release(c, [c.membersAreaId, c.eventsAreaId]);
		await expect(updateSender(c.db, c.admin, c.senderId, both, 1)).resolves.toStrictEqual({
			version: 2,
		});
		const kept = release(c, [c.membersAreaId]);
		await expect(updateSender(c.db, c.admin, c.senderId, kept, 2)).resolves.toStrictEqual({
			version: 3,
		});
	});

	it('holds the release for an archived occasion too', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		await archive(c, id);
		await expect(updateSender(c.db, c.admin, c.senderId, release(c, []), 1)).rejects.toThrow(
			SenderAreaInUseError,
		);
	});

	it('blocks deleting a sender that an occasion uses', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		const refused = refusal(deleteSender(c.db, c.admin, c.senderId));
		await expect(refused).resolves.toBeInstanceOf(SenderInUseError);
		await expect(refused).resolves.toMatchObject({ reason: 'occasions' });
		await removeOccasion(c.db, c.editor, id, 1);
		await expect(deleteSender(c.db, c.admin, c.senderId)).resolves.toBeUndefined();
	});
});

describe('opt-outs of an occasion', () => {
	it('links an occasion opt-out to a real occasion', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		await c.db.insert(contactOptOuts).values(optOut(id));
		// The same contact twice for one occasion is refused, for another occasion it is not.
		await expect(c.db.insert(contactOptOuts).values(optOut(id))).rejects.toThrow();
		const other = await createOccasion(
			c.db,
			c.editor,
			c.membersAreaId,
			inputFor(c, { name: 'Rundbrief' }),
		);
		await expect(c.db.insert(contactOptOuts).values(optOut(other.id))).resolves.toBeDefined();
		// No opt-out can point to an occasion that does not exist.
		await expect(c.db.insert(contactOptOuts).values(optOut(UNKNOWN_ID))).rejects.toThrow();
	});

	it('removes the opt-outs with the occasion', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		await c.db.insert(contactOptOuts).values(optOut(id));
		await removeOccasion(c.db, c.editor, id, 1);
		await expect(c.db.select().from(contactOptOuts)).resolves.toStrictEqual([]);
	});

	it('keeps the opt-outs of an archived occasion', async () => {
		const c = await club();
		const { id } = await createOccasion(c.db, c.editor, c.membersAreaId, inputFor(c));
		await c.db.insert(contactOptOuts).values(optOut(id));
		await archive(c, id);
		await expect(c.db.select().from(contactOptOuts)).resolves.toHaveLength(1);
	});
});
