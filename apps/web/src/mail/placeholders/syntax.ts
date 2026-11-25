/*
 * The placeholder syntax: `{{key}}` and `{{key | "fallback"}}`. A linear scanner, no regular
 * expression with nested quantifiers. Without a fallback a placeholder is required; an empty
 * fallback makes it optional.
 */

interface PlaceholderRef {
	key: string;
	/** `null`: required; `''`: optional; else the text used when the value is missing. */
	fallback: string | null;
}

type TextSegment = { kind: 'text'; value: string } | { kind: 'placeholder'; ref: PlaceholderRef };

type ParseResult =
	| { ok: true; segments: TextSegment[] }
	| { ok: false; error: 'unclosed' | 'invalidKey' | 'invalidFallback'; index: number };

const NOT_FOUND = -1;
const OPEN = '{{';
const CLOSE = '}}';

const isLower = (character: string): boolean => character >= 'a' && character <= 'z';
const isDigit = (character: string): boolean => character >= '0' && character <= '9';
const isAlphanumeric = (character: string): boolean =>
	isLower(character) || (character >= 'A' && character <= 'Z') || isDigit(character);
const isWhitespace = (character: string): boolean =>
	character === ' ' || character === '\t' || character === '\n' || character === '\r';

/**
 * Checks a key against `[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9_]*)*`.
 *
 * @param key The key.
 * @returns Whether the key is valid.
 */
function isValidKey(key: string): boolean {
	let startOfSegment = true;
	let first = true;
	for (const character of key) {
		if (startOfSegment) {
			if (!isLower(character)) return false;
			startOfSegment = false;
		} else if (character === '.') {
			startOfSegment = true;
			first = false;
		} else if (!(isAlphanumeric(character) || (!first && character === '_'))) {
			return false;
		}
	}
	return key !== '' && !startOfSegment;
}

interface Failure {
	ok: false;
	error: 'unclosed' | 'invalidKey' | 'invalidFallback';
	index: number;
}

/** A successful read: the value and the index of the first character after it. */
type Step<T> = { ok: true; value: T; next: number } | Failure;

const fail = (error: Failure['error'], index: number): Failure => ({ error, index, ok: false });
const succeed = <T>(value: T, next: number): Step<T> => ({ next, ok: true, value });

/**
 * Finds the first character that is no white space.
 *
 * @param text The text.
 * @param from The start.
 * @returns The index of that character, or the length of the text.
 */
function skipWhitespace(text: string, from: number): number {
	let index = from;
	while (index < text.length && isWhitespace(text.charAt(index))) index += 1;
	return index;
}

/**
 * Whether the key ends at an index: at white space, `|` or the closing braces.
 *
 * @param text The text.
 * @param index The index.
 * @returns Whether the key ends there.
 */
function endsKey(text: string, index: number): boolean {
	const character = text.charAt(index);
	return isWhitespace(character) || character === '|' || text.startsWith(CLOSE, index);
}

/**
 * Reads the key of a placeholder.
 *
 * @param text The text.
 * @param from The index behind the opening braces.
 * @param start The index of the opening braces.
 * @returns The key, or the failure.
 */
function readKey(text: string, from: number, start: number): Step<string> {
	const keyStart = skipWhitespace(text, from);
	let index = keyStart;
	while (index < text.length && !endsKey(text, index)) index += 1;
	if (index >= text.length) return fail('unclosed', start);
	const key = text.slice(keyStart, index);
	return isValidKey(key) ? succeed(key, index) : fail('invalidKey', keyStart);
}

/**
 * Takes the character of a quoted text at an index; `\"` and `\\` are escapes, any other
 * backslash stays.
 *
 * @param text The text.
 * @param index The index.
 * @returns The character the text has there and the index after it.
 */
function takeQuotedCharacter(text: string, index: number): { character: string; next: number } {
	const character = text.charAt(index);
	const following = text.charAt(index + 1);
	const escaped = character === '\\' && (following === '"' || following === '\\');
	return { character: escaped ? following : character, next: index + (escaped ? 2 : 1) };
}

/**
 * Reads the quoted fallback.
 *
 * @param text The text.
 * @param from The index of the opening quote.
 * @param start The index of the opening braces.
 * @returns The fallback, or the failure when the text ends first.
 */
function readQuoted(text: string, from: number, start: number): Step<string> {
	let value = '';
	let index = from + 1;
	while (index < text.length && text.charAt(index) !== '"') {
		const taken = takeQuotedCharacter(text, index);
		value += taken.character;
		index = taken.next;
	}
	if (index >= text.length) return fail('unclosed', start);
	return succeed(value, index + 1);
}

/**
 * Reads the part after the key: nothing (required) or `| "fallback"`.
 *
 * @param text The text.
 * @param from The index behind the key.
 * @param start The index of the opening braces.
 * @returns The fallback (null without one), or the failure.
 */
function readFallback(text: string, from: number, start: number): Step<string | null> {
	const index = skipWhitespace(text, from);
	if (index >= text.length) return fail('unclosed', start);
	if (text.charAt(index) !== '|') return succeed(null, index);
	const quote = skipWhitespace(text, index + 1);
	if (quote >= text.length) return fail('unclosed', start);
	if (text.charAt(quote) !== '"') return fail('invalidFallback', quote);
	return readQuoted(text, quote, start);
}

/**
 * Reads one placeholder.
 *
 * @param text The text.
 * @param from The index behind the opening braces.
 * @param start The index of the opening braces.
 * @returns The reference, or the failure.
 */
function readPlaceholder(text: string, from: number, start: number): Step<PlaceholderRef> {
	const key = readKey(text, from, start);
	if (!key.ok) return key;
	const fallback = readFallback(text, key.next, start);
	if (!fallback.ok) return fallback;
	const index = skipWhitespace(text, fallback.next);
	if (index >= text.length) return fail('unclosed', start);
	if (!text.startsWith(CLOSE, index)) {
		return fail(fallback.value === null ? 'invalidKey' : 'invalidFallback', index);
	}
	return succeed({ fallback: fallback.value, key: key.value }, index + CLOSE.length);
}

/**
 * Reads the next segment: the text up to the next placeholder, or the placeholder.
 *
 * @param text The text.
 * @param index The index, before the end of the text.
 * @returns The segment, or the failure.
 */
function readSegment(text: string, index: number): Step<TextSegment> {
	const start = text.indexOf(OPEN, index);
	if (start === index) {
		const ref = readPlaceholder(text, start + OPEN.length, start);
		return ref.ok ? succeed({ kind: 'placeholder', ref: ref.value }, ref.next) : ref;
	}
	const end = start === NOT_FOUND ? text.length : start;
	return succeed({ kind: 'text', value: text.slice(index, end) }, end);
}

/**
 * Splits a text into text and placeholders.
 *
 * @param text The text.
 * @returns The segments, or the first error with its index.
 */
function parsePlaceholders(text: string): ParseResult {
	const segments: TextSegment[] = [];
	let index = 0;
	while (index < text.length) {
		const segment = readSegment(text, index);
		if (!segment.ok) return segment;
		segments.push(segment.value);
		index = segment.next;
	}
	return { ok: true, segments };
}

/**
 * Writes a placeholder in its syntax.
 *
 * @param ref The reference.
 * @returns `{{key}}` or `{{key | "fallback"}}`.
 */
function formatPlaceholder(ref: Readonly<PlaceholderRef>): string {
	if (ref.fallback === null) return `${OPEN}${ref.key}${CLOSE}`;
	const escaped = ref.fallback.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
	return `${OPEN}${ref.key} | "${escaped}"${CLOSE}`;
}

export { formatPlaceholder, parsePlaceholders };
export type { ParseResult, PlaceholderRef, TextSegment };
