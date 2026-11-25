/*
 * The stable placeholder key of a custom field (`{{contact.custom.<key>}}`). No server imports:
 * the browser may use it too.
 */

const TRANSLITERATIONS: Readonly<Record<string, string>> = {
	ß: 'ss',
	ä: 'ae',
	ö: 'oe',
	ü: 'ue',
};

const NON_ALPHANUMERIC = /[^a-z0-9]+/u;
const COMBINING_MARKS = /\p{M}/gu;
const GERMAN_LETTERS = /[äöüß]/gu;

/**
 * Lowercases a name and writes it with ASCII letters: German umlauts and ß as `ae`, `oe`, `ue`,
 * `ss`, other accents dropped.
 *
 * @param name The name.
 * @returns The ASCII text.
 */
function asciiLower(name: string): string {
	return name
		.toLowerCase()
		.replaceAll(GERMAN_LETTERS, (letter) => TRANSLITERATIONS[letter] ?? letter)
		.normalize('NFD')
		.replaceAll(COMBINING_MARKS, '');
}

/**
 * Builds the camelCase key of a custom field from its name; a key that starts with a digit or is
 * empty gets the prefix `field`.
 *
 * @param name The name of the field.
 * @returns The key without a collision check.
 */
function camelCaseKey(name: string): string {
	const words = asciiLower(name)
		.split(NON_ALPHANUMERIC)
		.filter((word) => word !== '');
	const key = words
		.map((word, index) =>
			index === 0 ? word : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`,
		)
		.join('');
	return /^\d/u.test(key) || key === '' ? `field${key}` : key;
}

/**
 * The key for a new custom field: the name in camelCase, numbered (`2`, `3`, …) when the kind
 * already uses it.
 *
 * @param name The name of the field.
 * @param taken The keys the kind already uses.
 * @returns The free key.
 */
function placeholderKeyFromName(name: string, taken: ReadonlySet<string>): string {
	const key = camelCaseKey(name);
	if (!taken.has(key)) return key;
	let number = 2;
	while (taken.has(`${key}${number}`)) number += 1;
	return `${key}${number}`;
}

export { placeholderKeyFromName };
