import { z } from 'zod';

/** The fields of the setup form. */
type SetupField = 'email' | 'name' | 'token';

/** Limits that no real input reaches; they keep oversized values away from the database. */
const MAX_TOKEN_LENGTH = 1024;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;

const emailSchema = z.string().trim().max(MAX_EMAIL_LENGTH).pipe(z.email());

/**
 * Tells whether a name can be the admin's: not only spaces, at most `MAX_NAME_LENGTH` long.
 *
 * @param name The name as typed.
 * @returns True when the server accepts it.
 */
function isValidAdminName(name: string): boolean {
	const trimmed = name.trim();
	return trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH;
}

/**
 * Tells whether an address can be the admin's: with a domain (`admin@localhost` is refused),
 * at most `MAX_EMAIL_LENGTH` long, spaces around it are ignored.
 *
 * @param email The address as typed.
 * @returns True when the server accepts it.
 */
function isValidAdminEmail(email: string): boolean {
	return emailSchema.safeParse(email).success;
}

/**
 * The fields of the setup form the server refuses, in form order. The page shows each at its
 * field; the browser checks the same rules before sending. Whether the token is right is
 * checked later; here only its length.
 *
 * @param values The submitted values.
 * @param values.token The setup token.
 * @param values.name The admin's name.
 * @param values.email The admin's address.
 * @returns The refused fields; empty when the form can be processed.
 */
function invalidSetupFields(
	values: Readonly<{ token: string; name: string; email: string }>,
): SetupField[] {
	const fields: SetupField[] = [];
	if (values.token.length === 0 || values.token.length > MAX_TOKEN_LENGTH) fields.push('token');
	if (!isValidAdminName(values.name)) fields.push('name');
	if (!isValidAdminEmail(values.email)) fields.push('email');
	return fields;
}

export {
	MAX_EMAIL_LENGTH,
	MAX_NAME_LENGTH,
	MAX_TOKEN_LENGTH,
	invalidSetupFields,
	isValidAdminEmail,
	isValidAdminName,
};
export type { SetupField };
