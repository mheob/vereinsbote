/**
 * Tells whether a mailing may go to a contact: not suppressed, with an address and not exited.
 * A contact whose exit day has come (`exitDate <= today`) gets no mail.
 *
 * @param c The contact's address and exit date.
 * @param suppressed Whether the contact is on the suppression list.
 * @param today Today in the club's time zone, `YYYY-MM-DD`.
 * @returns True when mail may go out.
 */
function isMailable(
	c: Readonly<{ email: string | null; exitDate: string | null }>,
	suppressed: boolean,
	today: string,
): boolean {
	if (suppressed || c.email === null || c.email === '') return false;
	return c.exitDate === null || c.exitDate > today;
}

export { isMailable };
