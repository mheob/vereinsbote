/*
 * The limits of the attachments of a mail (Design 10.2). Browser-safe: the upload form imports
 * them without pulling in the database, so this module has no server imports. The limit per file
 * follows from the 4.5 MB request body of Vercel's functions.
 */

const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
/** 4 MiB. */
const MAX_ATTACHMENT_BYTES = 4_194_304;
const MAX_ATTACHMENTS = 5;
/** 20 MiB. */
const MAX_ATTACHMENTS_TOTAL = 20_971_520;

export { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_ATTACHMENTS_TOTAL };
