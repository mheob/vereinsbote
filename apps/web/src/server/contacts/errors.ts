/** No contact has the id, e.g. it was deleted in another tab. The message names no contact data. */
class ContactNotFoundError extends Error {
	public constructor() {
		super('Unknown contact.');
		this.name = 'ContactNotFoundError';
	}
}

/** The refusal of a change to a contact that is gone; the page says so. */
type ContactGone = Readonly<{ ok: false; failure: 'contactNotFound' }>;

const CONTACT_GONE: ContactGone = { failure: 'contactNotFound', ok: false };

export { CONTACT_GONE, ContactNotFoundError };
export type { ContactGone };
