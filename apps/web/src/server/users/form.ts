import { z } from 'zod';

/** The fields of the invitation form the server checks. */
type InviteField = 'email' | 'name';

/** Limits that no real input reaches; they keep oversized values away from the database. */
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;

const emailSchema = z.string().trim().max(MAX_EMAIL_LENGTH).pipe(z.email());

/**
 * Tells whether a name can be a user's: not only spaces, at most `MAX_NAME_LENGTH` long.
 *
 * @param name The name as typed.
 * @returns True when the server accepts it.
 */
function isValidUserName(name: string): boolean {
	const trimmed = name.trim();
	return trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH;
}

/**
 * Tells whether an address can be a user's: with a domain (`admin@localhost` is refused), at most
 * `MAX_EMAIL_LENGTH` long, spaces around it are ignored.
 *
 * @param email The address as typed.
 * @returns True when the server accepts it.
 */
function isValidUserEmail(email: string): boolean {
	return emailSchema.safeParse(email).success;
}

/**
 * The fields of the invitation form the server refuses, in form order. The page shows each at
 * its field; the browser checks the same rules before sending.
 *
 * @param values The submitted values.
 * @param values.name The name of the invited user.
 * @param values.email The address of the invited user.
 * @returns The refused fields; empty when the form can be processed.
 */
function invalidInviteFields(values: Readonly<{ name: string; email: string }>): InviteField[] {
	const fields: InviteField[] = [];
	if (!isValidUserName(values.name)) fields.push('name');
	if (!isValidUserEmail(values.email)) fields.push('email');
	return fields;
}

export {
	MAX_EMAIL_LENGTH,
	MAX_NAME_LENGTH,
	invalidInviteFields,
	isValidUserEmail,
	isValidUserName,
};
export type { InviteField };
