/* oxlint-disable max-classes-per-file -- the typed refusals of the contact modules live together */
/** No contact has the id, e.g. it was deleted in another tab. The message names no contact data. */
class ContactNotFoundError extends Error {
	public constructor() {
		super('Unknown contact.');
		this.name = 'ContactNotFoundError';
	}
}

/** An area does not exist, e.g. it was deleted in another tab. The message names no data. */
class UnknownAreaError extends Error {
	public constructor() {
		super('Unknown area.');
		this.name = 'UnknownAreaError';
	}
}

/**
 * The field is not (or no longer) a protected field of the kind, e.g. a custom field that became
 * a base field in another tab.
 */
class NotProtectedFieldError extends Error {
	public constructor() {
		super('The field is not a protected field of this kind.');
		this.name = 'NotProtectedFieldError';
	}
}

/** No custom field has the id. */
class UnknownCustomFieldError extends Error {
	public constructor() {
		super('The custom field does not exist.');
		this.name = 'UnknownCustomFieldError';
	}
}

/** The refusal of a change to a contact that is gone; the page says so. */
type ContactGone = Readonly<{ ok: false; failure: 'contactNotFound' }>;

const CONTACT_GONE: ContactGone = { failure: 'contactNotFound', ok: false };

export {
	CONTACT_GONE,
	ContactNotFoundError,
	NotProtectedFieldError,
	UnknownAreaError,
	UnknownCustomFieldError,
};
export type { ContactGone };
