/** The sign-in page: where signed-out visitors go, where invitations and failed sign-ins lead. */
export const LOGIN_PATH = '/login';

/** The page a login link opens; its button signs in (`?token=…`). */
export const LOGIN_CONFIRM_PATH = '/login/confirm';

/** Where a successful sign-in leads. */
export const AFTER_SIGN_IN_PATH = '/';

/** The unsubscribe page; the link of a mail adds its token (`/unsubscribe/<token>`). */
export const UNSUBSCRIBE_PATH = '/unsubscribe';

/** Where the unsubscribe link of a test mail and of a preview leads: a page that changes nothing. */
export const TEST_UNSUBSCRIBE_PATH = `${UNSUBSCRIBE_PATH}/test`;
