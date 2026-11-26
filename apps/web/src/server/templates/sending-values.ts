/*
 * What the sending needs of a template, without a user (Design 11.3): the template as a mail
 * source, built by the same function as the editor's preview, and the placeholder values of a
 * contact by the area's field protection, not by anybody's access. A value for `unsubscribe.url`
 * never comes from here: contact data cannot reach that slot, the outbox sets it.
 */
import { eq } from 'drizzle-orm';

import { contactPlaceholderValues } from '@/mail/placeholders/contact-values';
import type { ContactValueSource } from '@/mail/placeholders/contact-values';
import { UNSUBSCRIBE_URL_KEY } from '@/mail/placeholders/registry';
import type { SalutationTexts } from '@/mail/placeholders/salutation';
import type { MailSource } from '@/mail/render/compile';
import { mailSourceOf } from '@/mail/templates/mail-source';
import type { LayoutHtml } from '@/mail/templates/mail-source';
import type { ContactKind } from '@/server/contacts/fields';
import { areaFieldKeys, listCustomFields } from '@/server/contacts/settings';
import type { CustomFieldRecord } from '@/server/contacts/settings';
import type { Db } from '@/server/db/client';
import { layouts } from '@/server/db/schema';

import { templatePlaceholders } from './allowed-placeholders';
import type { AllowedPlaceholders } from './allowed-placeholders';
import { areaImages } from './editor-data';
import { mediaIdsOf } from './templates';
import type { TemplateRecord } from './templates';

/** What the values of an area's contacts depend on; loaded once per wave or run. */
interface SendingValueContext {
	/** The placeholders of the area's templates and the protected fields it gets per kind. */
	readonly allowed: AllowedPlaceholders;
	/** The custom fields per kind of contact. */
	readonly customFields: Readonly<Record<ContactKind, readonly Readonly<CustomFieldRecord>[]>>;
}

/**
 * The global layout a template chose, with its HTML.
 *
 * @param db The database.
 * @param template The template.
 * @returns The layout, or none for the standard layout, an own layout or HTML.
 */
async function chosenLayout(db: Db, template: Readonly<TemplateRecord>): Promise<LayoutHtml[]> {
	const { body } = template;
	if (body.kind !== 'blocks' || body.layout.kind !== 'shared') return [];
	return db
		.select({ html: layouts.html, id: layouts.id })
		.from(layouts)
		.where(eq(layouts.id, body.layout.layoutId));
}

/**
 * A template as a mail source, with the HTML of its global layout and the library images of its
 * area it shows. Runs two queries at once: never inside a transaction.
 *
 * @param db The database.
 * @param template The template.
 * @param appOrigin The origin of the app (`APP_URL`), to know its images in HTML.
 * @returns The mail source, the same the editor's preview compiles.
 */
async function templateMailSource(
	db: Db,
	template: Readonly<TemplateRecord>,
	appOrigin: string,
): Promise<MailSource> {
	const [shared, images] = await Promise.all([
		chosenLayout(db, template),
		areaImages(db, template.areaId, mediaIdsOf(template.body, appOrigin)),
	]);
	return mailSourceOf(template, shared, new Map(Object.entries(images)));
}

/**
 * Loads what the values of an area's contacts depend on. Runs several queries at once: never
 * inside a transaction.
 *
 * @param db The database.
 * @param areaId The area of the occasion.
 * @returns The allowed placeholders and the custom fields.
 */
async function sendingValueContext(db: Db, areaId: string): Promise<SendingValueContext> {
	const [deliveredByKind, member, partner] = await Promise.all([
		areaFieldKeys(db, areaId),
		listCustomFields(db, 'member'),
		listCustomFields(db, 'partner'),
	]);
	return {
		allowed: templatePlaceholders(deliveredByKind, [...member, ...partner]),
		customFields: { member, partner },
	};
}

/**
 * The placeholder values of a contact for a mail of the area: only the protected fields the area
 * gets for the contact's kind, only keys its templates may use. Pure; no user.
 *
 * @param ctx What the area's values depend on (`sendingValueContext`).
 * @param contact The contact as it is now (a `ContactRecord` row).
 * @param salutation The salutation texts of the wave.
 * @returns The value per placeholder key; never one for `unsubscribe.url`.
 */
function sendingValues(
	ctx: Readonly<SendingValueContext>,
	contact: ContactValueSource,
	salutation: SalutationTexts,
): Map<string, string> {
	const { allowed, customFields } = ctx;
	const values = contactPlaceholderValues(
		contact,
		allowed.deliveredByKind[contact.kind],
		customFields[contact.kind],
		salutation,
	);
	// Contact data never fills the unsubscribe link, even if a key were named so one day.
	return new Map(
		[...values].filter(([key]) => allowed.keys.has(key) && key !== UNSUBSCRIBE_URL_KEY),
	);
}

export { sendingValueContext, sendingValues, templateMailSource };
export type { SendingValueContext };
