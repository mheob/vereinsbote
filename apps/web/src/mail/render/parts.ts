/*
 * A compiled text: fixed text and slots for placeholder values. The compiler writes a marker
 * `U+E000 <index> U+E001` for each placeholder before rendering and splits the result at the
 * markers afterwards. Every template text loses these two characters before rendering, so the
 * only markers in the result are the compiler's own.
 */

type Part =
	| { readonly kind: 'text'; readonly value: string }
	| { readonly kind: 'slot'; readonly index: number };

const MARKER_START = '\uE000';
const MARKER_END = '\uE001';
const MARKER = /\uE000(?<index>\d+)\uE001/gu;
/** The code points of the two marker characters. */
const MARKER_CODE_POINTS: ReadonlySet<number> = new Set(
	[MARKER_START, MARKER_END].flatMap((marker) => marker.codePointAt(0) ?? []),
);
/** A numeric character reference, with or without `;`. HTML has no named one for a marker. */
const NUMERIC_REFERENCE = /&#(?:x(?<hex>[\da-f]+)|(?<decimal>\d+))/giu;
const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;

/**
 * The marker of a slot.
 *
 * @param index The index of the slot in the slot table.
 * @returns The marker text.
 */
function slotMarker(index: number): string {
	return `${MARKER_START}${String(index)}${MARKER_END}`;
}

/**
 * Splits a rendered text at its markers.
 *
 * @param text The text with markers.
 * @returns The parts in order; no empty text parts.
 */
function splitParts(text: string): Part[] {
	const parts: Part[] = [];
	let start = 0;
	for (const match of text.matchAll(MARKER)) {
		if (match.index > start) parts.push({ kind: 'text', value: text.slice(start, match.index) });
		parts.push({ index: Number(match.groups?.index), kind: 'slot' });
		start = match.index + match[0].length;
	}
	if (start < text.length) parts.push({ kind: 'text', value: text.slice(start) });
	return parts;
}

/**
 * Whether HTML has a character reference to a marker character. Decoding HTML (the plain text
 * is made from it) would turn such a reference into a marker, so the compiler refuses it.
 *
 * @param html The HTML of a template or a layout.
 * @returns True when a reference such as `&#xE000;` or `&#57345` stands for `U+E000` or `U+E001`.
 */
function referencesMarker(html: string): boolean {
	for (const match of html.matchAll(NUMERIC_REFERENCE)) {
		const { decimal, hex } = match.groups ?? {};
		const codePoint =
			hex === undefined
				? Number.parseInt(decimal ?? '', DECIMAL_RADIX)
				: Number.parseInt(hex, HEX_RADIX);
		if (MARKER_CODE_POINTS.has(codePoint)) return true;
	}
	return false;
}

export { referencesMarker, slotMarker, splitParts };
export type { Part };
