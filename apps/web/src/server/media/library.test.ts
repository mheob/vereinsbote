import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vite-plus/test';

import { createArea } from '@/server/areas/areas';
import { setUpClub, userWith } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { auditLog, media, templateMedia, templates } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';
import { createMemoryStorage } from '@/server/storage/memory';
import type { ObjectStorage } from '@/server/storage/storage';

import {
	ImageInUseError,
	ImageNameInvalidError,
	ImageNotFoundError,
	deleteImage,
	listLibrary,
	renameImage,
} from './library';
import { storeImage } from './media';
import { pngBytes } from './testing';

const PNG_LENGTH = 100;
const MAX_NAME = 200;
const UNKNOWN_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

interface Club {
	readonly db: Db;
	readonly storage: ObjectStorage;
	readonly admin: Principal;
	readonly editor: Principal;
	readonly reader: Principal;
	readonly outsider: Principal;
	readonly membersAreaId: string;
	readonly eventsAreaId: string;
}

async function club(): Promise<Club> {
	const db = await createTestDb();
	const { admin, membersAreaId } = await setUpClub(db);
	const { areaId: eventsAreaId } = await createArea(db, admin, 'Veranstaltungen');
	return {
		admin,
		db,
		editor: await userWith(db, { [membersAreaId]: 'edit' }),
		eventsAreaId,
		membersAreaId,
		outsider: await userWith(db, { [eventsAreaId]: 'send' }),
		reader: await userWith(db, { [membersAreaId]: 'read' }),
		storage: createMemoryStorage(),
	};
}

async function upload(c: Club, areaId: string, name: string): Promise<string> {
	const uploader = await userWith(c.db, { [areaId]: 'edit' });
	const record = await storeImage(
		c.db,
		c.storage,
		uploader,
		{ areaId, purpose: 'library' },
		{ bytes: pngBytes(600, 300, PNG_LENGTH), name },
	);
	return record.id;
}

/**
 * A template of the members area that shows the image, inserted directly (the save checks are
 * not under test).
 *
 * @param c The club.
 * @param mediaId The image.
 * @param name The template's name.
 * @returns The id of the template.
 */
async function templateUsing(c: Club, mediaId: string, name: string): Promise<string> {
	const [row] = await c.db
		.insert(templates)
		.values({
			areaId: c.membersAreaId,
			body: {},
			name,
			salutationForm: 'du',
			salutationTexts: {},
			subject: 'Betreff',
		})
		.returning({ id: templates.id });
	if (row === undefined) throw new Error('no template');
	await c.db.insert(templateMedia).values({ mediaId, templateId: row.id });
	return row.id;
}

describe(listLibrary, () => {
	it('lists the images of an area for readers only', async () => {
		const c = await club();
		const first = await upload(c, c.membersAreaId, 'a.png');
		const second = await upload(c, c.membersAreaId, 'b.png');
		await upload(c, c.eventsAreaId, 'other.png');
		await c.db
			.update(media)
			.set({ createdAt: new Date('2020-01-01T00:00:00Z') })
			.where(eq(media.id, first));
		await templateUsing(c, second, 'Sommerfest');

		const images = await listLibrary(c.db, c.reader, c.membersAreaId);
		expect(images.map(({ id }) => id)).toStrictEqual([second, first]);
		expect(images[0]).toMatchObject({
			height: 300,
			name: 'b.png',
			usedBy: [{ name: 'Sommerfest' }],
			width: 600,
		});
		expect(images[1]?.usedBy).toStrictEqual([]);

		await expect(listLibrary(c.db, c.outsider, c.membersAreaId)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
	});

	it('gives the admin role no access without membership', async () => {
		const c = await club();
		await expect(listLibrary(c.db, c.admin, c.eventsAreaId)).rejects.toBeInstanceOf(ForbiddenError);
	});
});

describe(renameImage, () => {
	it('renames within 200 characters', async () => {
		const c = await club();
		const id = await upload(c, c.membersAreaId, 'a.png');
		await renameImage(c.db, c.editor, id, '  Sommerfest 2026  ');
		const [row] = await c.db.select().from(media).where(eq(media.id, id));
		expect(row?.name).toBe('Sommerfest 2026');
		await renameImage(c.db, c.editor, id, 'x'.repeat(MAX_NAME));
		await expect(renameImage(c.db, c.editor, id, 'x'.repeat(MAX_NAME + 1))).rejects.toBeInstanceOf(
			ImageNameInvalidError,
		);
		await expect(renameImage(c.db, c.editor, id, '   ')).rejects.toBeInstanceOf(
			ImageNameInvalidError,
		);
	});

	it('needs edit in the area and an existing library image', async () => {
		const c = await club();
		const id = await upload(c, c.membersAreaId, 'a.png');
		await expect(renameImage(c.db, c.reader, id, 'x')).rejects.toBeInstanceOf(ForbiddenError);
		await expect(renameImage(c.db, c.editor, UNKNOWN_ID, 'x')).rejects.toBeInstanceOf(
			ImageNotFoundError,
		);
	});
});

describe(deleteImage, () => {
	it('refuses to delete an image a template uses and names the template', async () => {
		const c = await club();
		const id = await upload(c, c.membersAreaId, 'a.png');
		await templateUsing(c, id, 'Sommerfest');
		await templateUsing(c, id, 'Einladung');
		const error = await deleteImage(c.db, c.storage, c.editor, id).catch(
			(error_: unknown) => error_,
		);
		expect(error).toBeInstanceOf(ImageInUseError);
		expect(error).toMatchObject({
			templates: [{ name: 'Einladung' }, { name: 'Sommerfest' }],
		});
		await expect(c.storage.get(`media/${id}`)).resolves.not.toBeNull();
		await expect(c.db.select().from(media).where(eq(media.id, id))).resolves.toHaveLength(1);
	});

	it('deletes the row, then the object, and logs it', async () => {
		const c = await club();
		const id = await upload(c, c.membersAreaId, 'a.png');
		await deleteImage(c.db, c.storage, c.editor, id);
		await expect(c.db.select().from(media).where(eq(media.id, id))).resolves.toHaveLength(0);
		await expect(c.storage.get(`media/${id}`)).resolves.toBeNull();
		const entries = await c.db
			.select()
			.from(auditLog)
			.where(eq(auditLog.target, `media:${id}`));
		expect(entries.find(({ action }) => action === 'media.deleted')).toMatchObject({
			actorUserId: c.editor.userId,
			details: { areaId: c.membersAreaId },
		});
	});

	it('keeps the deletion when the object cannot be deleted, logging the label only', async () => {
		const c = await club();
		const id = await upload(c, c.membersAreaId, 'a.png');
		const failing: ObjectStorage = {
			...c.storage,
			delete: () => {
				throw new Error('secret detail');
			},
		};
		const error = vi.spyOn(console, 'error').mockImplementation(() => {
			// silenced
		});
		await deleteImage(c.db, failing, c.editor, id);
		await expect(c.db.select().from(media).where(eq(media.id, id))).resolves.toHaveLength(0);
		expect(error).toHaveBeenCalledOnce();
		expect(JSON.stringify(error.mock.calls)).not.toContain('secret detail');
		error.mockRestore();
	});

	it('needs edit, and reports an unknown image', async () => {
		const c = await club();
		const id = await upload(c, c.membersAreaId, 'a.png');
		await expect(deleteImage(c.db, c.storage, c.reader, id)).rejects.toBeInstanceOf(ForbiddenError);
		await expect(deleteImage(c.db, c.storage, c.editor, UNKNOWN_ID)).rejects.toBeInstanceOf(
			ImageNotFoundError,
		);
	});
});
