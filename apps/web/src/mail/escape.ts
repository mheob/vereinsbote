/*
 * Escaping for the three places a value can end up in a mail. Pure: it runs in the browser, on
 * Workers and on Node.
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
	'"': '&quot;',
	'&': '&amp;',
	"'": '&#39;',
	'<': '&lt;',
	'>': '&gt;',
};

const HTML_SPECIAL = /[&<>"']/gu;
const LINE_BREAK = /\r\n|[\r\n\p{Zl}\p{Zp}]/gu;
const CONTROL = /\p{Cc}/gu;
const MARKERS = /[\uE000\uE001]/gu;

/**
 * Escapes a value for HTML text and attribute values.
 *
 * @param value The value.
 * @returns The value with `& < > " '` escaped.
 */
function escapeHtml(value: string): string {
	return value.replaceAll(HTML_SPECIAL, (character) => HTML_ESCAPES[character] ?? character);
}

/**
 * Makes a value safe for a header (subject, preview text): a line break becomes a space, so a
 * value cannot add a header line, and control characters go.
 *
 * @param value The value.
 * @returns The one-line text.
 */
function cleanHeaderText(value: string): string {
	return value.replaceAll(LINE_BREAK, ' ').replaceAll(CONTROL, '').trim();
}

/**
 * Removes the two private-use characters the compiler uses to mark placeholders, so no text can
 * forge a marker.
 *
 * @param value The text.
 * @returns The text without `U+E000` and `U+E001`.
 */
function stripMarkers(value: string): string {
	return value.replaceAll(MARKERS, '');
}

export { cleanHeaderText, escapeHtml, stripMarkers };
