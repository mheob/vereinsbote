import { isValidUserEmail, isValidUserName } from '@/server/users/form';

/** The fields of the setup form. */
type SetupField = 'email' | 'name' | 'token';

/** Longer than any real token; keeps oversized values away from the hash. */
const MAX_TOKEN_LENGTH = 1024;

/** The admin's name follows the rules of every user's name. */
const isValidAdminName = isValidUserName;

/** The admin's address follows the rules of every user's address. */
const isValidAdminEmail = isValidUserEmail;

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

// The limits of every user's name and address apply to the admin's.
export { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH } from '@/server/users/form';
export { MAX_TOKEN_LENGTH, invalidSetupFields, isValidAdminEmail, isValidAdminName };
export type { SetupField };
