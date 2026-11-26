/*
 * Fills a compiled mail for one recipient. Values go in once, in their context: escaped in HTML
 * (text and quoted attributes alike), as they are in plain text, on one line in the subject and
 * the preview text. A value is never read for placeholders or markers again.
 *
 * The slot `unsubscribe.url` stands in an `href`; its value comes from the outbox. It takes only
 * an absolute `http:` or `https:` address, anything else counts as missing, so no other scheme can
 * reach the link.
 */

import { cleanHeaderText, escapeHtml, stripMarkers } from '@/mail/escape';
import { UNSUBSCRIBE_URL_KEY } from '@/mail/placeholders/registry';
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

/** The schemes the unsubscribe link takes. */
const WEB_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * The value a slot takes: the unsubscribe link only an absolute web address, every other slot
 * any text.
 *
 * @param key The placeholder key of the slot.
 * @param value The value without markers.
 * @returns The value, or `''` when the slot cannot take it.
 */
function usableValue(key: string, value: string): string {
	if (key !== UNSUBSCRIBE_URL_KEY) return value;
	return URL.canParse(value) && WEB_SCHEMES.has(new URL(value).protocol) ? value : '';
}

/**
 * The value of each slot: the recipient's value, else the fallback (`''` included). A value that
 * is empty once the markers are stripped (`U+E000`, `U+E001` and spaces only) counts as missing,
 * and so does an unsubscribe address that is no web address.
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
		const raw = values.get(slot.key);
		const value = raw === undefined ? '' : usableValue(slot.key, stripMarkers(raw));
		if (value.trim() !== '') return value;
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
