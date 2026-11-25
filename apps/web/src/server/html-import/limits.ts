/*
 * The sizes of an HTML import. Apart from the import, the import form in the browser reads them,
 * so they stand in a file that pulls in nothing.
 */

const KIBIBYTE = 1024;
const MAX_IMPORT_KIBIBYTES = 500;
const GMAIL_CLIP_KIBIBYTES = 102;
/** The most an import takes: 500 KB. */
const MAX_IMPORT_BYTES = MAX_IMPORT_KIBIBYTES * KIBIBYTE;
/** Gmail clips a mail above this size; the import warns. */
const GMAIL_CLIP_BYTES = GMAIL_CLIP_KIBIBYTES * KIBIBYTE;

export { GMAIL_CLIP_BYTES, MAX_IMPORT_BYTES };
