import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { emptyTemplate } from '@/mail/starters/starters';
import type { TemplateInput } from '@/mail/templates/template-schema';
import { storeAttachment } from '@/server/attachments/attachments';
import { pdfBytes } from '@/server/attachments/testing';
import { insertContact, userWith } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { attachments, layouts, user } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { OccasionInvalidError } from '@/server/occasions/errors';
import { removeOccasion } from '@/server/occasions/occasions';
import { ForbiddenError } from '@/server/permissions/principal';
import { testEnv } from '@/server/sending/testing';
import { createMemoryStorage } from '@/server/storage/memory';
import { APP_ORIGIN } from '@/server/templates/testing';

import { deriveFlowKey, flowRequestId } from './flow-key';
import { loadSendFlowPage } from './send-flow-page';
import type { SendFlowPage } from './send-flow-page';
import { insertWave, setUpWaveClubOn } from './testing';

/**
 * Loads the page of the send flow with the test environment's secret.
 *
 * @param db The database.
 * @param actor Who sends.
 * @param occasionId The occasion.
 * @returns The page.
 */
async function pageOf(
	db: Db,
	actor: Parameters<typeof loadSendFlowPage>[1],
	occasionId: string,
): Promise<SendFlowPage> {
	const flowKey = await deriveFlowKey(testEnv().appSecret);
	return loadSendFlowPage(db, actor, occasionId, { appOrigin: APP_ORIGIN, flowKey });
}

/**
 * A global layout.
 *
 * @param db The database.
 * @param name Its name.
 * @returns Its id.
 */
async function insertLayout(db: Db, name: string): Promise<string> {
	const [row] = await db
		.insert(layouts)
		.values({ html: `<div class="${name}">{{content}}</div>`, name })
		.returning({ id: layouts.id });
	if (row === undefined) throw new Error('Inserting the layout returned no row.');
	return row.id;
}

/**
 * A template in a global layout.
 *
 * @param layoutId The layout.
 * @returns The template.
 */
function inLayout(layoutId: string): TemplateInput {
	const template = emptyTemplate({ name: 'Einladung', subject: 'Sommerfest' });
	if (template.body.kind !== 'blocks') throw new Error('The empty template has blocks.');
	return { ...template, body: { ...template.body, layout: { kind: 'shared', layoutId } } };
}

describe(loadSendFlowPage, () => {
	it('loads the occasion, its template, the filters, the free files and the own address', async () => {
		const db = await createTestDb();
		await insertLayout(db, 'other');
		const festive = await insertLayout(db, 'festive');
		const c = await setUpWaveClubOn(db, { template: inLayout(festive) });
		await insertContact(db, { groups: ['Jugend'], kind: 'member' });
		await insertContact(db, { kind: 'partner', tags: ['Sponsor'] });
		const storage = createMemoryStorage();
		const flyer = await storeAttachment(db, storage, c.sender, c.occasionId, {
			bytes: pdfBytes(),
			name: 'flyer.pdf',
		});
		const taken = await storeAttachment(db, storage, c.sender, c.occasionId, {
			bytes: pdfBytes(),
			name: 'alt.pdf',
		});
		const waveId = await insertWave(db, c.occasionId);
		await db.update(attachments).set({ waveId }).where(eq(attachments.id, taken.id));
		const [own] = await db
			.select({ email: user.email })
			.from(user)
			.where(eq(user.id, c.sender.userId));
		const page = await pageOf(db, c.sender, c.occasionId);
		expect(page).toMatchObject({
			appOrigin: APP_ORIGIN,
			attachments: [{ id: flyer.id, name: 'flyer.pdf', own: true, waveId: null }],
			groups: ['Jugend'],
			occasion: { id: c.occasionId, kind: 'circular', name: 'Einladungen', unsubscribe: true },
			ownAddress: own?.email,
			sender: { label: 'Verein <verein@example.org>', provider: 'graph' },
			tags: ['Sponsor'],
			template: {
				input: { subject: 'Sommerfest' },
				layouts: [{ html: '<div class="festive">{{content}}</div>', id: festive }],
			},
		});
		expect(page.attachments).toHaveLength(1);
	});

	it('needs send in the area and an occasion that is not archived', async () => {
		const c = await setUpWaveClubOn(await createTestDb());
		await expect(pageOf(c.db, c.editor, c.occasionId)).rejects.toThrow(ForbiddenError);
		await insertWave(c.db, c.occasionId);
		await removeOccasion(c.db, c.editor, c.occasionId, 1);
		await expect(pageOf(c.db, c.sender, c.occasionId)).rejects.toThrow(OccasionInvalidError);
	});

	it('tells the own free files from those of other users', async () => {
		const c = await setUpWaveClubOn(await createTestDb());
		const colleague = await userWith(c.db, { [c.membersAreaId]: 'send' });
		const storage = createMemoryStorage();
		const mine = await storeAttachment(c.db, storage, c.sender, c.occasionId, {
			bytes: pdfBytes(),
			name: 'mine.pdf',
		});
		const theirs = await storeAttachment(c.db, storage, colleague, c.occasionId, {
			bytes: pdfBytes(),
			name: 'theirs.pdf',
		});
		const page = await pageOf(c.db, c.sender, c.occasionId);
		expect(page.attachments.map(({ id, own }) => ({ id, own }))).toStrictEqual([
			{ id: mine.id, own: true },
			{ id: theirs.id, own: false },
		]);
		// The colleague sees it the other way round; the page names no user.
		const theirPage = await pageOf(c.db, colleague, c.occasionId);
		expect(theirPage.attachments.map(({ own }) => own)).toStrictEqual([false, true]);
		expect(JSON.stringify(theirPage.attachments)).not.toContain(c.sender.userId);
	});

	it('derives the key of the flow from the user, the occasion and its newest wave', async () => {
		const c = await setUpWaveClubOn(await createTestDb());
		const colleague = await userWith(c.db, { [c.membersAreaId]: 'send' });
		const flowKey = await deriveFlowKey(testEnv().appSecret);
		// Two tabs before a confirmation share the key.
		const first = await pageOf(c.db, c.sender, c.occasionId);
		const secondTab = await pageOf(c.db, c.sender, c.occasionId);
		expect(secondTab.requestId).toBe(first.requestId);
		await expect(
			flowRequestId(flowKey, {
				newestWaveId: null,
				occasionId: c.occasionId,
				userId: c.sender.userId,
			}),
		).resolves.toBe(first.requestId);
		// Another user has a flow of its own.
		const theirs = await pageOf(c.db, colleague, c.occasionId);
		expect(theirs.requestId).not.toBe(first.requestId);
		// After a wave the next flow gets a new key, from the newest wave.
		await insertWave(c.db, c.occasionId, { createdAt: new Date('2026-11-01T10:00:00Z') });
		const newest = await insertWave(c.db, c.occasionId, {
			createdAt: new Date('2026-11-02T10:00:00Z'),
		});
		const afterWave = await pageOf(c.db, c.sender, c.occasionId);
		expect(afterWave.requestId).not.toBe(first.requestId);
		await expect(
			flowRequestId(flowKey, {
				newestWaveId: newest,
				occasionId: c.occasionId,
				userId: c.sender.userId,
			}),
		).resolves.toBe(afterWave.requestId);
	});
});
