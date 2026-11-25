import { cleanHeaderText, escapeHtml, stripMarkers } from '@/mail/escape';
/*
 * Fills a compiled mail for one recipient. Values go in once, in their context: escaped in HTML,
 * as they are in plain text, on one line in the subject and the preview text. A value is never
 * read for placeholders or markers again.
 */
import { compareCodePoints } from '@/server/compare-code-points';

import type { CompiledMail } from './compile';
import type { Part } from './parts';

interface FilledMail {
	subject: string;
	preheader: string;
	html: string;
	text: string;
}

type FillResult = { ok: true; mail: FilledMail } | { ok: false; missing: string[] };

/**
 * The value of each slot: the recipient's value, else the fallback (`''` included). An empty
 * value counts as missing.
 *
 * @param compiled The compiled mail.
 * @param values The values per placeholder key.
 * @returns The value per slot, or the missing keys.
 */
function slotValues(
	compiled: Readonly<CompiledMail>,
	values: ReadonlyMap<string, string>,
): { ok: true; values: string[] } | { ok: false; missing: string[] } {
	const missing = new Set<string>();
	const resolved = compiled.slots.map((slot) => {
		const value = values.get(slot.key);
		if (value !== undefined && value.trim() !== '') return stripMarkers(value);
		if (slot.fallback === null) missing.add(slot.key);
		return slot.fallback ?? '';
	});
	if (missing.size > 0) return { missing: [...missing].toSorted(compareCodePoints), ok: false };
	return { ok: true, values: resolved };
}

/**
 * Joins parts with the slot values.
 *
 * @param parts The parts.
 * @param values The value per slot.
 * @param format How a value is written into this context.
 * @returns The text.
 */
function join(
	parts: readonly Part[],
	values: readonly string[],
	format: (value: string) => string,
): string {
	return parts
		.map((part) => (part.kind === 'text' ? part.value : format(values[part.index] ?? '')))
		.join('');
}

const asIs = (value: string): string => value;

/**
 * Fills a compiled mail with the values of one recipient.
 *
 * @param compiled The compiled mail.
 * @param values The values per placeholder key, e.g. from `contactPlaceholderValues`.
 * @returns The mail, or every missing required key once, sorted.
 */
function fillMail(
	compiled: Readonly<CompiledMail>,
	values: ReadonlyMap<string, string>,
): FillResult {
	const slots = slotValues(compiled, values);
	if (!slots.ok) return slots;
	return {
		mail: {
			html: join(compiled.html, slots.values, escapeHtml),
			preheader: cleanHeaderText(join(compiled.preheader, slots.values, asIs)),
			subject: cleanHeaderText(join(compiled.subject, slots.values, asIs)),
			text: join(compiled.text, slots.values, asIs),
		},
		ok: true,
	};
}

export { fillMail };
export type { FilledMail, FillResult };
