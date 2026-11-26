/*
 * What the preview of the send flow shows for a contact of the selection (Design 10.3, 11.2): the
 * values in the user's view (`previewValues`) of the contact whose values fill the mail, and who
 * the mail goes to. A circular shows the mail of the contact's address, filled by its first
 * contact; a contact that gets no mail shows its own values and why it gets none. Needs `send` in
 * the occasion's area and the right to list contacts.
 */
import { todayInClubZone } from '@/server/contacts/calendar';
import { displayName } from '@/server/contacts/display-name';
import { ContactNotFoundError } from '@/server/contacts/errors';
import type { Db } from '@/server/db/client';
import type { Principal } from '@/server/permissions/principal';
import { previewValues } from '@/server/templates/preview-values';
import { getTemplate } from '@/server/templates/templates';

import { planMails } from './merge';
import { contactsWithMarks, exclusionOf, resolveRecipients } from './recipients';
import type { RecipientSelection, ShownExclusion } from './recipients';
import { shownReason } from './shown-reasons';
import type { ExitDateSight } from './shown-reasons';
import { sendableOccasion } from './waves';

/** What the preview shows for a contact of the selection. */
interface RecipientPreview {
	/**
	 * The contact whose values fill the mail: the chosen one, or for a circular the first contact
	 * of its address. The test mail takes its values.
	 */
	readonly contactId: string;
	/** The placeholder values in the user's view. */
	readonly values: Readonly<Record<string, string>>;
	/** Who the mail goes to, the filling contact first; empty when the chosen one gets none. */
	readonly names: readonly string[];
	/**
	 * Why the chosen contact gets no mail of this selection, as the user may see it (ruling R10);
	 * null when it gets one.
	 */
	readonly excluded: ShownExclusion | 'notSelected' | null;
}

/**
 * Why a contact outside the planned mails gets none, as the user may see it: its first reason
 * (`unavailable` for an exit date the user may not see), or that the selection does not take it.
 *
 * @param db The database.
 * @param asked The occasion (its id and area), the contact and the user's sight of exit dates.
 * @param asked.occasion The occasion.
 * @param asked.contactId The contact.
 * @param asked.sight Whether the user sees the exit date, per kind.
 * @param now The instant.
 * @returns The reason.
 * @throws {ContactNotFoundError} When the contact is gone.
 */
async function reasonOf(
	db: Db,
	asked: Readonly<{
		occasion: Readonly<{ id: string; areaId: string }>;
		contactId: string;
		sight: ExitDateSight;
	}>,
	now: Date,
): Promise<ShownExclusion | 'notSelected'> {
	const [row] = await contactsWithMarks(db, asked.occasion, [asked.contactId]);
	if (row === undefined) throw new ContactNotFoundError();
	const { contact, ...marks } = row;
	const reason = exclusionOf(contact, marks, todayInClubZone(now));
	return reason === null ? 'notSelected' : shownReason(reason, contact.kind, asked.sight);
}

/**
 * The preview of a contact of the selection: the values of the contact that fills its mail and
 * who the mail goes to; for a contact that gets no mail, its own values and why. Loads the user's
 * access before it reads: never inside a transaction.
 *
 * @param db The database.
 * @param actor Who sends; needs `send` in the occasion's area.
 * @param input The occasion, the contact and the selection of the flow.
 * @param input.occasionId The occasion.
 * @param input.contactId The chosen contact; the caller validates that it is a UUID.
 * @param input.selection The selection of the flow.
 * @param now The instant.
 * @returns The preview.
 * @throws {OccasionNotFoundError} When no occasion has the id.
 * @throws {ForbiddenError} Without `send` in the occasion's area or the right to list contacts.
 * @throws {OccasionInvalidError} When the occasion is archived.
 * @throws {ContactNotFoundError} When the contact is gone.
 */
// oxlint-disable-next-line max-params -- the database, the user, the input and the clock
async function recipientPreview(
	db: Db,
	actor: Principal,
	input: Readonly<{ occasionId: string; contactId: string; selection: RecipientSelection }>,
	now: Date,
): Promise<RecipientPreview> {
	const occasion = await sendableOccasion(db, actor, input.occasionId);
	const recipients = await resolveRecipients(db, actor, occasion, input.selection, now);
	const mail = planMails(occasion.kind, recipients.mailable).find(({ contacts: merged }) =>
		merged.some(({ id }) => id === input.contactId),
	);
	const filling = mail?.contacts[0]?.id ?? input.contactId;
	const sight = recipients.exitDateSight;
	const excluded =
		mail === undefined
			? await reasonOf(db, { contactId: input.contactId, occasion, sight }, now)
			: null;
	const template = await getTemplate(db, actor, occasion.templateId);
	const values = await previewValues(db, actor, template.id, filling, template.salutationTexts);
	if (values === null) throw new ContactNotFoundError();
	return {
		contactId: filling,
		excluded,
		names: (mail?.contacts ?? []).map((contact) => displayName(contact).primary),
		values,
	};
}

export { recipientPreview };
export type { RecipientPreview };
