/*
 * The most a JSON request of the template functions may carry per string. Form requests have
 * their own bounds and `formBodyLimit`; JSON bodies have neither, so these keep an authenticated
 * client from sending megabytes where the save checks (later, and with messages) look at kilobytes.
 * No server imports: plain data checks.
 */
import type { SalutationTexts } from '@/mail/placeholders/salutation';
import type { TemplateInput } from '@/mail/templates/template-schema';

/** The most characters of HTML (an imported mail or an own layout) before its bytes are counted (500 KB). */
const MAX_REQUEST_HTML = 4_000_000;
/** The most characters of a name, subject, preview text or salutation text before the save checks' own limits. */
const MAX_REQUEST_TEXT = 10_000;

/**
 * Whether the salutation texts are short enough.
 *
 * @param texts The texts.
 * @returns True when every text is within `MAX_REQUEST_TEXT`.
 */
function salutationWithinBounds(texts: Readonly<SalutationTexts>): boolean {
	return Object.values(texts).every((text) => text.length <= MAX_REQUEST_TEXT);
}

/**
 * Whether the strings of a template request are bounded: the texts, the salutation texts and the
 * HTML of an HTML body or an own layout. The blocks are bounded by their schema.
 *
 * @param input The template of a request.
 * @returns True when no string is above its bound.
 */
function templateWithinBounds(input: Readonly<TemplateInput>): boolean {
	const { body, name, preheader, salutationTexts, subject } = input;
	const html = body.kind === 'html' ? body.html : '';
	const layoutHtml = body.kind === 'blocks' && body.layout.kind === 'own' ? body.layout.html : '';
	return (
		[name, subject, preheader].every((text) => text.length <= MAX_REQUEST_TEXT) &&
		salutationWithinBounds(salutationTexts) &&
		html.length <= MAX_REQUEST_HTML &&
		layoutHtml.length <= MAX_REQUEST_HTML
	);
}

export { MAX_REQUEST_HTML, MAX_REQUEST_TEXT, salutationWithinBounds, templateWithinBounds };
