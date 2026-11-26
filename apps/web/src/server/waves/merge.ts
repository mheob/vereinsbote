/*
 * Which mails a wave plans (Design 11.1, 11.2): a personal occasion one per contact, a circular
 * one per address, so a household gets one invitation. Pure: no database.
 */
import { normalizeEmail } from '@/server/auth/email';
import { compareCodePoints } from '@/server/compare-code-points';
import type { ContactRecord } from '@/server/db/schema';
import type { OccasionKind } from '@/server/occasions/limits';

import type { ContactRow } from './recipients';

/** One mail of a wave: its address and its contacts; `contacts[0]` fills the mail. */
interface PlannedMail {
	readonly address: string;
	readonly contacts: readonly ContactRow[];
}

/** The fields that order contacts. */
type Ordered = Readonly<Pick<ContactRecord, 'customerNumber' | 'id' | 'kind' | 'memberNumber'>>;

/**
 * The number that orders a contact: the member number of a member, the customer number of a
 * partner.
 *
 * @param contact The contact.
 * @returns The number, or null for a partner without one.
 */
function numberOf(contact: Ordered): string | null {
	return contact.kind === 'member' ? contact.memberNumber : contact.customerNumber;
}

/**
 * Orders contacts as Design 11.2 does: members before partners, then by number (a contact without
 * one after those with one), then by id.
 *
 * @param a A contact.
 * @param b Another contact.
 * @returns Negative when `a` comes first.
 */
function compareContacts(a: Ordered, b: Ordered): number {
	// `member` comes before `partner` by code point.
	if (a.kind !== b.kind) return compareCodePoints(a.kind, b.kind);
	const first = numberOf(a);
	const second = numberOf(b);
	if (first === null || second === null) {
		const withoutNumber = Number(first === null) - Number(second === null);
		if (withoutNumber !== 0) return withoutNumber;
	} else if (first !== second) {
		return compareCodePoints(first, second);
	}
	return compareCodePoints(a.id, b.id);
}

/**
 * Plans the mails of a wave. Contacts without an address get none. The mails come in the order of
 * their first contacts.
 *
 * @param kind The kind of the occasion: `personal` mails one per contact, `circular` one per
 *   address, its contacts in the order of Design 11.2.
 * @param contacts The mailable contacts.
 * @returns The mails.
 */
function planMails(kind: OccasionKind, contacts: readonly ContactRow[]): PlannedMail[] {
	const addressed = contacts
		.map((contact) => ({ address: normalizeEmail(contact.email ?? ''), contact }))
		.filter(({ address }) => address !== '')
		.toSorted((a, b) => compareContacts(a.contact, b.contact));
	if (kind === 'personal') {
		return addressed.map(({ address, contact }) => ({ address, contacts: [contact] }));
	}
	// `Map.groupBy` keeps the order in which each address first comes.
	const byAddress = Map.groupBy(addressed, ({ address }) => address);
	return [...byAddress].map(([address, merged]) => ({
		address,
		contacts: merged.map(({ contact }) => contact),
	}));
}

export { planMails };
export type { PlannedMail };
