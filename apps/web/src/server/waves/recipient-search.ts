/*
 * The search over the contacts of the send flow in the user's view (Design 10.1, 10.3): it picks
 * recipients one by one, or the contact the preview shows. It needs `send` in the occasion's area
 * and the right to list contacts, searches base fields only and gives nothing else.
 */
import { and, sql } from 'drizzle-orm';

import { assertCanList, loadContactAccess } from '@/server/contacts/access';
import { todayInClubZone } from '@/server/contacts/calendar';
import { displayName } from '@/server/contacts/display-name';
import type { ContactKind } from '@/server/contacts/fields';
import { searchCondition } from '@/server/contacts/filters';
import type { Db } from '@/server/db/client';
import { contacts } from '@/server/db/schema';
import type { Principal } from '@/server/permissions/principal';

import { selectionCondition } from './recipients';
import type { RecipientSelection } from './recipients';
import { sendableOccasion } from './waves';

/** A contact the search found: base fields only. */
interface RecipientChoice {
	readonly id: string;
	readonly kind: ContactKind;
	readonly name: string;
	readonly email: string | null;
}

/** The longest list a search gives. */
const MAX_RECIPIENT_CHOICES = 10;

/**
 * Searches the contacts of a selection: the term narrows it by the contact list's search, which
 * covers base fields only.
 *
 * @param db The database.
 * @param actor Who sends; needs `send` in the occasion's area.
 * @param input The occasion, the selection to search in and the term as typed.
 * @param input.occasionId The occasion.
 * @param input.selection The selection; one of every contact of a kind or both for single picks.
 * @param input.term The term; empty for the first contacts.
 * @param now The instant; the selection compares exit dates with today in the club's time zone.
 * @returns At most ten contacts, by name.
 * @throws {OccasionNotFoundError} When no occasion has the id.
 * @throws {ForbiddenError} Without `send` in the occasion's area or the right to list contacts.
 * @throws {OccasionInvalidError} When the occasion is archived.
 */
// oxlint-disable-next-line max-params -- the database, the user, the input and the clock
async function searchRecipients(
	db: Db,
	actor: Principal,
	input: Readonly<{ occasionId: string; selection: RecipientSelection; term: string }>,
	now: Date,
): Promise<RecipientChoice[]> {
	await sendableOccasion(db, actor, input.occasionId);
	assertCanList(await loadContactAccess(db, actor));
	if (input.selection.contactIds?.length === 0) return [];
	const today = todayInClubZone(now);
	const condition = and(selectionCondition(input.selection, today), searchCondition(input.term));
	const rows = await db
		.select({
			customerNumber: contacts.customerNumber,
			email: contacts.email,
			firstName: contacts.firstName,
			id: contacts.id,
			kind: contacts.kind,
			lastName: contacts.lastName,
			memberNumber: contacts.memberNumber,
			organization: contacts.organization,
		})
		.from(contacts)
		.where(condition)
		.orderBy(
			sql`lower(coalesce(${contacts.organization}, ${contacts.lastName}, ${contacts.firstName}, ${contacts.email}, ${contacts.memberNumber}, ${contacts.customerNumber}))`,
			sql`lower(${contacts.firstName})`,
			contacts.id,
		)
		.limit(MAX_RECIPIENT_CHOICES);
	return rows.map((row) => ({
		email: row.email,
		id: row.id,
		kind: row.kind,
		name: displayName(row).primary,
	}));
}

export { MAX_RECIPIENT_CHOICES, searchRecipients };
export type { RecipientChoice };
