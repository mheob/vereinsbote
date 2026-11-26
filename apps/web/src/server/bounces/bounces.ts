/*
 * The mark „E-Mail ungültig“ (Design 13): a hard bounce of a contact's address. Sub-plan 4b's
 * bounce task adds recording and clearing; the waves need the check only.
 */
import { and, eq } from 'drizzle-orm';

import { normalizeEmail } from '@/server/auth/email';
import type { Db } from '@/server/db/client';
import { contactBounces } from '@/server/db/schema';
import type { ContactRecord } from '@/server/db/schema';

/**
 * Whether the contact's current address is marked invalid. The mark hangs on kind, contact key
 * and address: an address that changed since the bounce is not marked. The recipients of a wave
 * apply the same rule in their query (`resolveRecipients`).
 *
 * @param db The database.
 * @param contact The contact's kind, key and current address.
 * @returns True when the address bounced hard; false without an address.
 */
async function isEmailInvalid(
	db: Db,
	contact: Readonly<Pick<ContactRecord, 'contactKey' | 'email' | 'kind'>>,
): Promise<boolean> {
	if (contact.email === null) return false;
	const email = normalizeEmail(contact.email);
	const [row] = await db
		.select({ email: contactBounces.email })
		.from(contactBounces)
		.where(
			and(
				eq(contactBounces.kind, contact.kind),
				eq(contactBounces.contactKey, contact.contactKey),
				eq(contactBounces.email, email),
			),
		)
		.limit(1);
	return row !== undefined;
}

export { isEmailInvalid };
