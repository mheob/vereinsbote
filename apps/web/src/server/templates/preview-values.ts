/*
 * The contacts a template can be previewed with, and the values they give its placeholders. A
 * preview shows what a mailing would show, so it follows the rules of the mailing and of the user:
 * only keys the template may use, protected values only for fields the template's area gets for
 * the contact's kind and the user sees (Design 9, 15).
 */
import { eq } from 'drizzle-orm';

import { contactPlaceholderValues } from '@/mail/placeholders/contact-values';
import type { SalutationTexts } from '@/mail/placeholders/salutation';
import { compareCodePoints } from '@/server/compare-code-points';
import { loadContactAccess } from '@/server/contacts/access';
import { listContacts } from '@/server/contacts/contacts';
import type { ContactKind, FieldKey } from '@/server/contacts/fields';
import { listCustomFields } from '@/server/contacts/settings';
import type { Db } from '@/server/db/client';
import { contacts } from '@/server/db/schema';
import type { Principal } from '@/server/permissions/principal';

import { allowedTemplatePlaceholders } from './allowed-placeholders';
import { getTemplate } from './templates';

/** A contact the preview can be shown for: what the picker needs, no contact data. */
interface PreviewContact {
	readonly id: string;
	readonly kind: ContactKind;
	readonly name: string;
}

/** How many contacts a search gives. */
const MAX_PREVIEW_CONTACTS = 10;

const KINDS: readonly ContactKind[] = ['member', 'partner'];

/**
 * Searches the contacts of both kinds by the list's own search, which covers base fields only.
 *
 * @param db The database.
 * @param actor Who searches; needs `read` in the template's area.
 * @param templateId The template.
 * @param query The search as typed.
 * @returns At most ten contacts, by name.
 * @throws {TemplateNotFoundError} When no template has the id.
 * @throws {ForbiddenError} Without `read` in the area of the template.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function searchPreviewContacts(
	db: Db,
	actor: Principal,
	templateId: string,
	query: string,
): Promise<PreviewContact[]> {
	await getTemplate(db, actor, templateId);
	const now = new Date();
	const pages = await Promise.all(
		KINDS.map(async (kind) => listContacts(db, actor, { filters: {}, kind, page: 1, query }, now)),
	);
	return pages
		.flatMap((page, index) =>
			page.items.map((item) => ({
				id: item.id,
				kind: KINDS[index] ?? 'member',
				name: item.name.primary,
			})),
		)
		.toSorted((a, b) => compareCodePoints(a.name.toLowerCase(), b.name.toLowerCase()))
		.slice(0, MAX_PREVIEW_CONTACTS);
}

/**
 * The protected fields of a kind the template's area gets and the user sees.
 *
 * @param areaGets What the template's area gets.
 * @param userSees What the user sees.
 * @returns The fields both allow.
 */
function bothAllow(
	areaGets: ReadonlySet<FieldKey>,
	userSees: ReadonlySet<FieldKey>,
): ReadonlySet<FieldKey> {
	return new Set([...areaGets].filter((key) => userSees.has(key)));
}

/**
 * The placeholder values of a contact for a template. Loads the access and the allowed
 * placeholders before it reads the contact: never call it inside a transaction.
 *
 * @param db The database.
 * @param actor Who previews; needs `read` in the template's area.
 * @param templateId The template.
 * @param contactId The contact; the caller validates that it is a UUID.
 * @param salutation The salutation texts as the editor holds them now, saved or not.
 * @returns The value per key the template may use; null when the contact is gone or the user
 * may not list contacts.
 * @throws {TemplateNotFoundError} When no template has the id.
 * @throws {ForbiddenError} Without `read` in the area of the template.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function previewValues(
	db: Db,
	actor: Principal,
	templateId: string,
	contactId: string,
	salutation: SalutationTexts,
): Promise<Record<string, string> | null> {
	const template = await getTemplate(db, actor, templateId);
	const access = await loadContactAccess(db, actor);
	if (!access.canList) return null;
	const allowed = await allowedTemplatePlaceholders(db, template.areaId);
	const [row] = await db.select().from(contacts).where(eq(contacts.id, contactId));
	if (row === undefined) return null;
	const delivered = bothAllow(allowed.deliveredByKind[row.kind], access.visible[row.kind]);
	const values = contactPlaceholderValues(
		row,
		delivered,
		await listCustomFields(db, row.kind),
		salutation,
	);
	return Object.fromEntries([...values].filter(([key]) => allowed.keys.has(key)));
}

export { previewValues, searchPreviewContacts };
export type { PreviewContact };
