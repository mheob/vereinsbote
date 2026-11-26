/** The marks that keep any mail from a contact, whatever its occasion. */
interface MailingMarks {
	/** The contact is on the suppression list. */
	readonly suppressed: boolean;
	/** The contact's current address bounced hard („E-Mail ungültig“, `isEmailInvalid`). */
	readonly invalidEmail: boolean;
}

/**
 * Tells whether a contact's exit day has come (`exitDate <= today`).
 *
 * @param exitDate The exit date, `YYYY-MM-DD`, or null.
 * @param today Today in the club's time zone, `YYYY-MM-DD`.
 * @returns True from the exit day on.
 */
function hasExited(exitDate: string | null, today: string): boolean {
	return exitDate !== null && exitDate <= today;
}

/**
 * Tells whether a mailing may go to a contact: not suppressed, with an address that is not marked
 * invalid, and not exited. A contact whose exit day has come gets no mail.
 *
 * @param c The contact's address and exit date.
 * @param marks Whether the contact is suppressed and whether its address is marked invalid.
 * @param today Today in the club's time zone, `YYYY-MM-DD`.
 * @returns True when mail may go out.
 */
function isMailable(
	c: Readonly<{ email: string | null; exitDate: string | null }>,
	marks: MailingMarks,
	today: string,
): boolean {
	if (marks.suppressed || marks.invalidEmail || c.email === null || c.email === '') return false;
	return !hasExited(c.exitDate, today);
}

export { hasExited, isMailable };
export type { MailingMarks };
