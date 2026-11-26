import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import type { Block } from '@/mail/blocks/block-schema';
import { UNSUBSCRIBE_URL_KEY } from '@/mail/placeholders/registry';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import type { MailSource } from '@/mail/render/compile';
import { mailSourceOf } from '@/mail/templates/mail-source';
import type { TemplateInput } from '@/mail/templates/template-schema';
import { insertContact, setUpClub, userWith } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { contacts, customFields, layouts } from '@/server/db/schema';
import type { ContactRecord } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { storeImage } from '@/server/media/media';
import { pngBytes } from '@/server/media/testing';
import type { Principal } from '@/server/permissions/principal';
import { createMemoryStorage } from '@/server/storage/memory';

import { sendingValueContext, sendingValues, templateMailSource } from './sending-values';
import { APP_ORIGIN, createTemplate, loadTemplateEditorData } from './testing';

const PNG_LENGTH = 100;
const IMAGE_WIDTH = 600;
const IMAGE_HEIGHT = 300;

/**
 * A template with the given body.
 *
 * @param body The body.
 * @param name The name.
 * @returns The input.
 */
function templateWith(body: TemplateInput['body'], name: string): TemplateInput {
	return {
		body,
		name,
		preheader: 'Für {{contact.firstName}}',
		salutationForm: 'du',
		salutationTexts: DEFAULT_SALUTATIONS.du,
		subject: 'Einladung',
	};
}

/**
 * Inserts a custom field of members, delivered to every area.
 *
 * @param db The database.
 * @returns The id of the field.
 */
async function insertNickname(db: Db): Promise<string> {
	const [row] = await db
		.insert(customFields)
		.values({
			kind: 'member',
			name: 'Spitzname',
			placeholderKey: 'spitzname',
			protection: 'base',
			type: 'text',
		})
		.returning({ id: customFields.id });
	if (row === undefined) throw new Error('Inserting the custom field returned no row.');
	return row.id;
}

/**
 * Reads a contact that must exist.
 *
 * @param db The database.
 * @param id The contact.
 * @returns The row.
 */
async function contactRow(db: Db, id: string): Promise<ContactRecord> {
	const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
	if (row === undefined) throw new Error('The test contact is gone.');
	return row;
}

/** A club with an editor of the members area, a library image there and a global layout. */
interface Library {
	readonly db: Db;
	readonly editor: Principal;
	readonly membersAreaId: string;
	readonly imageId: string;
	readonly layoutId: string;
}

/**
 * Sets up a club with an image in the library of the members area and a global layout.
 *
 * @returns The database, the editor and the ids.
 */
async function library(): Promise<Library> {
	const db = await createTestDb();
	const { membersAreaId } = await setUpClub(db);
	const editor = await userWith(db, { [membersAreaId]: 'edit' });
	const image = await storeImage(
		db,
		createMemoryStorage(),
		editor,
		{ areaId: membersAreaId, purpose: 'library' },
		{ bytes: pngBytes(IMAGE_WIDTH, IMAGE_HEIGHT, PNG_LENGTH), name: 'vereinsheim.png' },
	);
	const [layout] = await db
		.insert(layouts)
		.values({ html: '<div>{{content}}</div>', name: 'Festlich' })
		.returning({ id: layouts.id });
	if (layout === undefined) throw new Error('Inserting the layout returned no row.');
	return { db, editor, imageId: image.id, layoutId: layout.id, membersAreaId };
}

/**
 * Saves a template and builds its mail source the way the editor does and the way the sending does.
 *
 * @param club The club.
 * @param body The body of the template.
 * @returns Both sources.
 */
async function bothSources(
	club: Library,
	body: TemplateInput['body'],
): Promise<{ inEditor: MailSource; onServer: MailSource }> {
	const { db, editor, membersAreaId } = club;
	const { id } = await createTemplate(db, editor, membersAreaId, templateWith(body, 'Vorlage'));
	const page = await loadTemplateEditorData(db, editor, id);
	return {
		inEditor: mailSourceOf(page.template, page.layouts, new Map(Object.entries(page.media))),
		onServer: await templateMailSource(db, page.template, APP_ORIGIN),
	};
}

/**
 * An image block of the library image.
 *
 * @param imageId The image.
 * @returns The block.
 */
const imageBlock = (imageId: string): Block => ({
	alt: 'Vereinsheim',
	decorative: false,
	href: null,
	id: 'i',
	mediaId: imageId,
	type: 'image',
});

describe(templateMailSource, () => {
	it.each([
		[
			'blocks in a global layout',
			(club: Library): TemplateInput['body'] => ({
				blocks: [imageBlock(club.imageId)],
				kind: 'blocks',
				layout: { kind: 'shared', layoutId: club.layoutId },
			}),
		],
		[
			'blocks in an own layout',
			(club: Library): TemplateInput['body'] => ({
				blocks: [],
				kind: 'blocks',
				layout: {
					html: `<img src="/media/${club.imageId}.png" alt="Logo"><div>{{content}}</div>`,
					kind: 'own',
				},
			}),
		],
		[
			'imported HTML',
			(club: Library): TemplateInput['body'] => ({
				html: `<p>Hallo</p><img src="/media/${club.imageId}.png" alt="Vereinsheim">`,
				kind: 'html',
			}),
		],
	])('builds the same mail source on server and in the editor: %s', async (_name, bodyOf) => {
		const club = await library();
		const { inEditor, onServer } = await bothSources(club, bodyOf(club));
		expect(onServer).toStrictEqual(inEditor);
		expect([...onServer.media.keys()]).toStrictEqual([club.imageId]);
	});

	it('puts the HTML of the chosen global layout into the source', async () => {
		const club = await library();
		const { onServer } = await bothSources(club, {
			blocks: [],
			kind: 'blocks',
			layout: { kind: 'shared', layoutId: club.layoutId },
		});
		expect(onServer.body).toStrictEqual({
			blocks: [],
			kind: 'blocks',
			layout: { html: '<div>{{content}}</div>', kind: 'html' },
		});
	});
});

describe(sendingValues, () => {
	it('delivers only fields of the area and never asks for a user', async () => {
		const db = await createTestDb();
		const { membersAreaId, partnersAreaId } = await setUpClub(db);
		const nickname = await insertNickname(db);
		const contact = await contactRow(
			db,
			await insertContact(db, {
				birthDate: '1990-05-17',
				customValues: { [nickname]: 'Benni' },
				email: 'ben@example.org',
				firstName: 'Ben',
				gender: 'male',
				kind: 'member',
				lastName: 'Bauer',
			}),
		);
		const members = sendingValues(
			await sendingValueContext(db, membersAreaId),
			contact,
			DEFAULT_SALUTATIONS.du,
		);
		const partners = sendingValues(
			await sendingValueContext(db, partnersAreaId),
			contact,
			DEFAULT_SALUTATIONS.du,
		);
		expect(Object.fromEntries(members)).toMatchObject({
			'contact.birthDate': '17.05.1990',
			'contact.custom.spitzname': 'Benni',
			'contact.email': 'ben@example.org',
			'contact.firstName': 'Ben',
			salutation: 'Lieber Ben',
		});
		expect(Object.fromEntries(partners)).toMatchObject({
			'contact.custom.spitzname': 'Benni',
			'contact.firstName': 'Ben',
			salutation: 'Lieber Ben',
		});
		expect(partners.has('contact.birthDate')).toBe(false);
		expect(JSON.stringify([...partners])).not.toContain('1990');
	});

	it('gives only keys the area allows and never the unsubscribe link', async () => {
		const db = await createTestDb();
		const { membersAreaId } = await setUpClub(db);
		const context = await sendingValueContext(db, membersAreaId);
		const contact = await contactRow(
			db,
			await insertContact(db, { email: 'ben@example.org', firstName: 'Ben', kind: 'member' }),
		);
		const values = sendingValues(context, contact, DEFAULT_SALUTATIONS.du);
		expect(context.allowed.keys.has(UNSUBSCRIBE_URL_KEY)).toBe(true);
		expect(values.has(UNSUBSCRIBE_URL_KEY)).toBe(false);
		expect([...values.keys()].filter((key) => !context.allowed.keys.has(key))).toStrictEqual([]);
	});
});
