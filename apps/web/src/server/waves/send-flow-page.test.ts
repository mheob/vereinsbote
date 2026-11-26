import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { emptyTemplate } from '@/mail/starters/starters';
import type { TemplateInput } from '@/mail/templates/template-schema';
import { storeAttachment } from '@/server/attachments/attachments';
import { pdfBytes } from '@/server/attachments/testing';
import { insertContact } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { attachments, layouts, user } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { OccasionInvalidError } from '@/server/occasions/errors';
import { removeOccasion } from '@/server/occasions/occasions';
import { ForbiddenError } from '@/server/permissions/principal';
import { createMemoryStorage } from '@/server/storage/memory';
import { APP_ORIGIN } from '@/server/templates/testing';

import { loadSendFlowPage } from './send-flow-page';
import { insertWave, setUpWaveClubOn } from './testing';

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
		const page = await loadSendFlowPage(db, c.sender, c.occasionId, APP_ORIGIN);
		expect(page).toMatchObject({
			appOrigin: APP_ORIGIN,
			attachments: [{ id: flyer.id, name: 'flyer.pdf', waveId: null }],
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
		await expect(loadSendFlowPage(c.db, c.editor, c.occasionId, APP_ORIGIN)).rejects.toThrow(
			ForbiddenError,
		);
		await insertWave(c.db, c.occasionId);
		await removeOccasion(c.db, c.editor, c.occasionId, 1);
		await expect(loadSendFlowPage(c.db, c.sender, c.occasionId, APP_ORIGIN)).rejects.toThrow(
			OccasionInvalidError,
		);
	});
});
