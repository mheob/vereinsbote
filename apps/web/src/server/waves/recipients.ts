/*
 * The recipients of a wave (Design 10.1): the contacts a user selects with the filters of the
 * contact list (plan decision 15) or one by one, split into those who may get the mail and those
 * who may not, counted by reason. The full contact rows stay on the server: the outbox needs them,
 * the user sees only counts.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { assertCanList, loadContactAccess } from '@/server/contacts/access';
import { todayInClubZone } from '@/server/contacts/calendar';
import type { ContactKind } from '@/server/contacts/fields';
import { filterConditions, searchCondition, suppressionOfContact } from '@/server/contacts/filters';
import type { ContactFilters } from '@/server/contacts/filters';
import { isMailable } from '@/server/contacts/mailable';
import type { Db } from '@/server/db/client';
import { contactBounces, contactOptOuts, contacts, contactSuppressions } from '@/server/db/schema';
import type { ContactRecord } from '@/server/db/schema';
import type { OccasionRecord } from '@/server/occasions/occasions';
import { assertArea } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

/**
 * Who a wave goes to: a kind (or both), the search and the filters of the contact list, and, for
 * a selection one by one, the contacts' ids. The ids narrow the filters, they never widen them.
 */
interface RecipientSelection {
	readonly kind: ContactKind | 'both';
	readonly query: string;
	readonly filters: Pick<ContactFilters, 'group' | 'tag'>;
	/** The single selection; null selects every contact the filters find. */
	readonly contactIds: readonly string[] | null;
}

/**
 * Why a selected contact gets no mail (Design 10.1): a suppression, a reached exit date, no
 * address, an address marked invalid, or an opt-out of the occasion or of its area.
 */
type ExclusionReason =
	| 'exited'
	| 'invalidEmail'
	| 'noEmail'
	| 'optedOutArea'
	| 'optedOutOccasion'
	| 'suppressed';

/** A contact row, deeply readonly; a `ContactRecord` is one. */
type ContactRow = Readonly<Omit<ContactRecord, 'customValues' | 'groups' | 'tags'>> & {
	readonly customValues: Readonly<Record<string, string>>;
	readonly groups: readonly string[];
	readonly tags: readonly string[];
};

interface ResolvedRecipients {
	mailable: ContactRow[];
	/** Every excluded contact counts once, under the first of its reasons. */
	excluded: Record<ExclusionReason, number>;
}

/** The marks that may exclude a selected contact. */
interface ExclusionMarks {
	readonly suppressed: boolean;
	readonly invalidEmail: boolean;
	readonly optedOutArea: boolean;
	readonly optedOutOccasion: boolean;
}

/** A selected contact with its marks. */
type SelectedRow = ExclusionMarks & { readonly contact: ContactRow };

/** The opt-outs of the occasion's area and of the occasion itself, joined apart. */
const areaOptOuts = alias(contactOptOuts, 'area_opt_outs');
const occasionOptOuts = alias(contactOptOuts, 'occasion_opt_outs');

/**
 * No contact excluded yet.
 *
 * @returns A zero per reason.
 */
function noExclusions(): Record<ExclusionReason, number> {
	return {
		exited: 0,
		invalidEmail: 0,
		noEmail: 0,
		optedOutArea: 0,
		optedOutOccasion: 0,
		suppressed: 0,
	};
}

/**
 * The first reason a contact gets no mail, in the order of `ExclusionReason`'s description.
 *
 * @param contact The contact's address and exit date.
 * @param marks Its suppression, the mark of its address and its opt-outs.
 * @param today Today in the club's time zone.
 * @returns The reason, or null when the contact may get the mail.
 */
function exclusionOf(
	contact: Readonly<Pick<ContactRecord, 'email' | 'exitDate'>>,
	marks: ExclusionMarks,
	today: string,
): ExclusionReason | null {
	if (!isMailable(contact, marks.suppressed, today)) {
		if (marks.suppressed) return 'suppressed';
		return contact.email === null || contact.email === '' ? 'noEmail' : 'exited';
	}
	if (marks.invalidEmail) return 'invalidEmail';
	if (marks.optedOutOccasion) return 'optedOutOccasion';
	return marks.optedOutArea ? 'optedOutArea' : null;
}

/**
 * Splits the selected contacts into the mailable ones and counts the others by reason.
 *
 * @param rows The selected contacts with their marks.
 * @param today Today in the club's time zone.
 * @returns The recipients.
 */
function split(rows: readonly SelectedRow[], today: string): ResolvedRecipients {
	const excluded = noExclusions();
	const mailable: ContactRow[] = [];
	for (const { contact, ...marks } of rows) {
		const reason = exclusionOf(contact, marks, today);
		if (reason === null) mailable.push(contact);
		else excluded[reason] += 1;
	}
	return { excluded, mailable };
}

/**
 * The conditions of a selection: the kind, the search and the filters of the contact list, the
 * single selection.
 *
 * @param selection The selection.
 * @param today Today in the club's time zone.
 * @returns The condition.
 */
function selectionCondition(
	selection: Readonly<RecipientSelection>,
	today: string,
): SQL | undefined {
	const { contactIds, filters, kind, query } = selection;
	return and(
		kind === 'both' ? undefined : eq(contacts.kind, kind),
		searchCondition(query),
		// Only the two filters of a selection, whatever else the object carries.
		...filterConditions({ group: filters.group, tag: filters.tag }, today),
		contactIds === null ? undefined : inArray(contacts.id, [...contactIds]),
	);
}

/**
 * The selected contacts with their suppression, the mark of their address and their opt-outs of
 * the occasion and its area. Each join finds at most one row: the keys of those tables.
 *
 * @param db The database.
 * @param occasion The occasion.
 * @param selection The selection.
 * @param today Today in the club's time zone.
 * @returns The contacts.
 */
// oxlint-disable-next-line max-params -- the database, the occasion, the selection and the day
async function selectedRows(
	db: Db,
	occasion: Readonly<Pick<OccasionRecord, 'areaId' | 'id'>>,
	selection: Readonly<RecipientSelection>,
	today: string,
): Promise<SelectedRow[]> {
	return (
		db
			.select({
				contact: contacts,
				invalidEmail: sql<boolean>`${contactBounces.email} is not null`,
				optedOutArea: sql<boolean>`${areaOptOuts.id} is not null`,
				optedOutOccasion: sql<boolean>`${occasionOptOuts.id} is not null`,
				suppressed: sql<boolean>`${contactSuppressions.contactKey} is not null`,
			})
			.from(contacts)
			.leftJoin(contactSuppressions, suppressionOfContact)
			// The rule of `isEmailInvalid`: the mark of the contact's current address.
			.leftJoin(
				contactBounces,
				and(
					eq(contactBounces.kind, contacts.kind),
					eq(contactBounces.contactKey, contacts.contactKey),
					eq(contactBounces.email, contacts.email),
				),
			)
			.leftJoin(
				areaOptOuts,
				and(
					eq(areaOptOuts.kind, contacts.kind),
					eq(areaOptOuts.contactKey, contacts.contactKey),
					eq(areaOptOuts.scope, 'area'),
					eq(areaOptOuts.areaId, occasion.areaId),
				),
			)
			.leftJoin(
				occasionOptOuts,
				and(
					eq(occasionOptOuts.kind, contacts.kind),
					eq(occasionOptOuts.contactKey, contacts.contactKey),
					eq(occasionOptOuts.scope, 'occasion'),
					eq(occasionOptOuts.occasionId, occasion.id),
				),
			)
			.where(selectionCondition(selection, today))
	);
}

/**
 * Resolves the recipients of a wave as the user selected them. The selection uses the user's view
 * of the contacts (sub-plan 2): its search and filters cover base fields only. Runs queries one
 * after another, but loads the user's access first: never inside a transaction.
 *
 * @param db The database.
 * @param actor Who sends; needs `send` in the occasion's area.
 * @param occasion The occasion.
 * @param selection The selection.
 * @param now The instant; the exit date compares with today in the club's time zone.
 * @returns The mailable contacts and the excluded ones by reason.
 * @throws {ForbiddenError} Without `send` in the occasion's area.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function resolveRecipients(
	db: Db,
	actor: Principal,
	occasion: Readonly<OccasionRecord>,
	selection: Readonly<RecipientSelection>,
	now: Date,
): Promise<ResolvedRecipients> {
	assertArea(actor, occasion.areaId, 'send');
	assertCanList(await loadContactAccess(db, actor));
	if (selection.contactIds?.length === 0) return { excluded: noExclusions(), mailable: [] };
	const today = todayInClubZone(now);
	return split(await selectedRows(db, occasion, selection, today), today);
}

export { resolveRecipients };
export type { ContactRow, ExclusionReason, RecipientSelection, ResolvedRecipients };
