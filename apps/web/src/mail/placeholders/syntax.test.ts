import { describe, expect, it } from 'vite-plus/test';

import { formatPlaceholder, parsePlaceholders } from './syntax';
import type { ParseResult, TextSegment } from './syntax';

const text = (value: string): TextSegment => ({ kind: 'text', value });
const ph = (key: string, fallback: string | null): TextSegment => ({
	kind: 'placeholder',
	ref: { fallback, key },
});

describe(parsePlaceholders, () => {
	it.each<[string, ParseResult]>([
		[
			'Hallo {{contact.firstName}}!',
			{ ok: true, segments: [text('Hallo '), ph('contact.firstName', null), text('!')] },
		],
		['{{contact.city | "unbekannt"}}', { ok: true, segments: [ph('contact.city', 'unbekannt')] }],
		['{{contact.city | ""}}', { ok: true, segments: [ph('contact.city', '')] }],
		['{{ salutation }}', { ok: true, segments: [ph('salutation', null)] }],
		[String.raw`{{a | "mit \" Anführung"}}`, { ok: true, segments: [ph('a', 'mit " Anführung')] }],
		[String.raw`{{a | "back\\slash"}}`, { ok: true, segments: [ph('a', String.raw`back\slash`)] }],
		['{{a | "}} drin"}}', { ok: true, segments: [ph('a', '}} drin')] }],
		['{{contact.custom.size_2}}', { ok: true, segments: [ph('contact.custom.size_2', null)] }],
		['plain', { ok: true, segments: [text('plain')] }],
		['', { ok: true, segments: [] }],
		['{{a}}{{b}}', { ok: true, segments: [ph('a', null), ph('b', null)] }],
		['a {{x', { error: 'unclosed', index: 2, ok: false }],
		['{{a | "x', { error: 'unclosed', index: 0, ok: false }],
		['{{1a}}', { error: 'invalidKey', index: 2, ok: false }],
		['{{}}', { error: 'invalidKey', index: 2, ok: false }],
		['{{a b}}', { error: 'invalidKey', index: 4, ok: false }],
		['{{a.}}', { error: 'invalidKey', index: 2, ok: false }],
		['{{a | unquoted}}', { error: 'invalidFallback', index: 6, ok: false }],
		['{{a | "x" y}}', { error: 'invalidFallback', index: 10, ok: false }],
	])('parses %s', (input, expected) => {
		expect(parsePlaceholders(input)).toStrictEqual(expected);
	});
});

describe(formatPlaceholder, () => {
	it.each([
		[{ fallback: null, key: 'contact.city' }, '{{contact.city}}'],
		[{ fallback: '', key: 'contact.city' }, '{{contact.city | ""}}'],
		[{ fallback: String.raw`a "b" \c`, key: 'x' }, String.raw`{{x | "a \"b\" \\c"}}`],
	])('formats %j', (ref, expected) => {
		expect(formatPlaceholder(ref)).toBe(expected);
	});

	it('round-trips through the parser', () => {
		const ref = { fallback: String.raw`ein "Wert" \ }}`, key: 'brand.name' };
		expect(parsePlaceholders(formatPlaceholder(ref))).toStrictEqual({
			ok: true,
			segments: [{ kind: 'placeholder', ref }],
		});
	});
});
