/*
 * Link texts that say nothing about where a link leads (Design 12): a screen reader user who
 * lists the links of a mail hears only these words. A fixed German list, because the mails are
 * German; a bare address counts as well. Runs in the browser, on Workers and on Node.
 */

/** The texts, lower case and without punctuation, as `normalize` leaves them. */
const VAGUE_LINK_TEXTS: readonly string[] = [
	'hier',
	'hier klicken',
	'klicke hier',
	'klicken sie hier',
	'mehr',
	'weiter',
	'weiterlesen',
	'mehr lesen',
	'link',
	'details',
];

const VAGUE: ReadonlySet<string> = new Set(VAGUE_LINK_TEXTS);

/** Punctuation and symbols, one character at a time (no backtracking). */
const PUNCTUATION = /[\p{P}\p{S}]/gu;
const WHITESPACE = /\s+/gu;
const WHITESPACE_INSIDE = /\s/u;
/** The starts of a bare web address. */
const ADDRESS_PREFIXES = ['https://', 'http://', 'www.'];

/**
 * The words of a text: lower case, without punctuation, single spaces.
 *
 * @param text The text.
 * @returns The normalized text.
 */
function normalize(text: string): string {
	return text
		.toLocaleLowerCase('de')
		.replaceAll(PUNCTUATION, ' ')
		.replaceAll(WHITESPACE, ' ')
		.trim();
}

/**
 * Whether a text is a bare address, e.g. `https://example.org` or `www.example.org`.
 *
 * @param text The text.
 * @returns True when the text is one address without other words.
 */
function isBareAddress(text: string): boolean {
	const trimmed = text.trim().toLocaleLowerCase('de');
	return (
		!WHITESPACE_INSIDE.test(trimmed) &&
		ADDRESS_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
	);
}

/**
 * Whether a link text says nothing about the target: a text of the list (ignoring case and
 * punctuation), a bare address, or no words at all.
 *
 * @param text The visible text of the link.
 * @returns True for a vague text.
 */
function isVagueLinkText(text: string): boolean {
	const words = normalize(text);
	return words === '' || VAGUE.has(words) || isBareAddress(text);
}

export { isVagueLinkText, VAGUE_LINK_TEXTS };
