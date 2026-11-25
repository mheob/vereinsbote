/*
 * The length limits of a template's name, subject and preview text. A module of its own with no
 * imports: the forms in the browser read them, and `save-checks.ts` (which brings the HTML import
 * and its data) must not reach the client bundle for three numbers.
 */

/** The longest template name, counted after trimming. */
const MAX_TEMPLATE_NAME_LENGTH = 100;
/** The longest subject. */
const MAX_TEMPLATE_SUBJECT_LENGTH = 200;
/** The longest preview text. */
const MAX_TEMPLATE_PREHEADER_LENGTH = 200;

export { MAX_TEMPLATE_NAME_LENGTH, MAX_TEMPLATE_PREHEADER_LENGTH, MAX_TEMPLATE_SUBJECT_LENGTH };
