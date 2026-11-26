/** The sign-in page: where signed-out visitors go, where invitations and failed sign-ins lead. */
export const LOGIN_PATH = '/login';

/** The page a login link opens; its button signs in (`?token=…`). */
export const LOGIN_CONFIRM_PATH = '/login/confirm';

/** Where a successful sign-in leads. */
export const AFTER_SIGN_IN_PATH = '/';

/** The unsubscribe page; the link of a mail adds its token (`/unsubscribe/<token>`). */
export const UNSUBSCRIBE_PATH = '/unsubscribe';

/** The token of the unsubscribe link of a test mail and of a preview; no sealed token is `test`. */
export const TEST_UNSUBSCRIBE_TOKEN = 'test';

/** Where the unsubscribe link of a test mail and of a preview leads: a page that changes nothing. */
export const TEST_UNSUBSCRIBE_PATH = `${UNSUBSCRIBE_PATH}/${TEST_UNSUBSCRIBE_TOKEN}`;

/**
 * Whether a path is an unsubscribe link: a public page for the recipients of a mail, without the
 * frame of a signed-in user.
 *
 * @param pathname The path of the request.
 * @returns True for `/unsubscribe/<token>`.
 */
export function isUnsubscribePath(pathname: string): boolean {
	return pathname.startsWith(`${UNSUBSCRIBE_PATH}/`);
}
