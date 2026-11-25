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

export { slotMarker, splitParts };
export type { Part };
