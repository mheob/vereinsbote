/* oxlint-disable typescript/prefer-readonly-parameter-types -- the state of an import (refs, refusals, counters) is mutable by design */
/*
 * The placeholders of an imported mail. Before the cleaning every placeholder in a text, an
 * attribute or a style sheet becomes a token of two private-use characters (`U+E002 <index>
 * U+E003`), so the HTML writer cannot change it (it escapes quotes and ampersands) and the CSS
 * parser sees a name. After the writing each token becomes its placeholder again. The tokens are
 * not the compiler's markers (`U+E000`, `U+E001`); `import-html.ts` removes all four characters from
 * the source first.
 *
 * Contact data and `{{content}}` live in text only; attributes, `<style>` and `<title>` take
 * brand values (Design 10).
 */
import { BUILTIN_PLACEHOLDERS, CONTENT_KEY } from '@/mail/placeholders/registry';
import { formatPlaceholder, parsePlaceholders } from '@/mail/placeholders/syntax';
import type { PlaceholderRef, TextSegment } from '@/mail/placeholders/syntax';

import type { ImportRefusal } from './import-html';

/** The keys a template or layout may use. */
interface PlaceholderKeys {
	/** Allowed here. */
	readonly keys: ReadonlySet<string>;
	/** Every key that exists; one outside it is unknown, one inside but not allowed is forbidden. */
	readonly known: ReadonlySet<string>;
}

/** Where a text stands. Attributes, `<style>` and `<title>` take brand values only. */
type Place =
	| { readonly kind: 'text' }
	| { readonly kind: 'attribute'; readonly name: string }
	| { readonly kind: 'style' }
	| { readonly kind: 'title' };

/** The first private-use character, `U+E000`. */
const PRIVATE_USE_START = 57_344;
/** The compiler's two markers and the import's two tokens. */
const PRIVATE_USE_COUNT = 4;
const TOKEN_START_OFFSET = 2;
const TOKEN_END_OFFSET = 3;
const NOT_FOUND = -1;

/**
 * A private-use character.
 *
 * @param offset The distance from `U+E000`.
 * @returns The character.
 */
function privateUse(offset: number): string {
	return String.fromCodePoint(PRIVATE_USE_START + offset);
}

const PRIVATE_USE: ReadonlySet<string> = new Set(
	Array.from({ length: PRIVATE_USE_COUNT }, (_item, offset) => privateUse(offset)),
);
const TOKEN_START = privateUse(TOKEN_START_OFFSET);
const TOKEN_END = privateUse(TOKEN_END_OFFSET);
const TOKEN = new RegExp(`${TOKEN_START}(?<index>\\d+)${TOKEN_END}`, 'gu');
const LEADING_TOKEN = new RegExp(`^${TOKEN_START}(?<index>\\d+)${TOKEN_END}`, 'u');
const CSS_TOKEN = /vbph(?<index>\d+)x/gu;
const FALLBACK_REFERENCE = /[\w#]/u;
/** The brand values; the only placeholders outside text. */
const BRAND_KEYS: ReadonlySet<string> = new Set(
	BUILTIN_PLACEHOLDERS.filter(({ context }) => context === 'attribute').map(({ key }) => key),
);

/**
 * Removes the compiler's markers and the import's tokens from a source, so no text can forge one.
 *
 * @param text The source.
 * @returns The text without `U+E000` to `U+E003`.
 */
function stripPrivateUse(text: string): string {
	let result = '';
	for (const character of text) if (!PRIVATE_USE.has(character)) result += character;
	return result;
}

/**
 * Whether a text has the characters of a token.
 *
 * @param text The text.
 * @returns True when it has one.
 */
function hasToken(text: string): boolean {
	return text.includes(TOKEN_START) || text.includes(TOKEN_END);
}

/**
 * The attribute-like name of a place, for a refusal.
 *
 * @param place The place.
 * @returns The attribute name, `style` or `title`.
 */
function placeName(place: Place): string {
	if (place.kind === 'attribute') return place.name;
	return place.kind === 'text' ? 'text' : place.kind;
}

/**
 * Whether a fallback can be written back into the HTML as it is: no markup, no character
 * reference that a second import would read differently. In an attribute the writer quotes with
 * `'`, so that quote is out as well.
 *
 * @param fallback The fallback text.
 * @param place Where the placeholder stands.
 * @returns True when the fallback is fine.
 */
function fallbackFits(fallback: string, place: Place): boolean {
	if (fallback.includes('<') || fallback.includes('>')) return false;
	if (place.kind === 'attribute' && fallback.includes("'")) return false;
	let index = fallback.indexOf('&');
	while (index !== NOT_FOUND) {
		if (FALLBACK_REFERENCE.test(fallback.charAt(index + 1))) return false;
		index = fallback.indexOf('&', index + 1);
	}
	return true;
}

/** What an import has met so far. */
interface State {
	readonly allowed: PlaceholderKeys;
	readonly refs: PlaceholderRef[];
	readonly refusals: Map<string, ImportRefusal>;
	/** How often `{{content}}` stood in a text, and how often as a text node of its own. */
	content: { own: number; total: number };
}

/**
 * Records a refusal, each once.
 *
 * @param state The state.
 * @param refusal The refusal.
 */
function refuse(state: State, refusal: ImportRefusal): void {
	state.refusals.set(JSON.stringify(refusal), refusal);
}

/**
 * Judges a placeholder in text: it must be allowed in the area.
 *
 * @param state The state.
 * @param key The key.
 */
function judgeInText(state: State, key: string): void {
	if (key === CONTENT_KEY) state.content.total += 1;
	if (state.allowed.keys.has(key)) return;
	refuse(state, {
		key,
		kind: state.allowed.known.has(key) ? 'placeholderForbidden' : 'placeholderUnknown',
	});
}

/**
 * Judges a placeholder: in text it must be allowed in the area, elsewhere it must be a brand
 * value.
 *
 * @param state The state.
 * @param ref The placeholder.
 * @param place Where it stands.
 */
function judge(state: State, ref: Readonly<PlaceholderRef>, place: Place): void {
	const { key } = ref;
	if (ref.fallback !== null && !fallbackFits(ref.fallback, place)) {
		refuse(state, { kind: 'syntax' });
	} else if (place.kind === 'text') {
		judgeInText(state, key);
	} else if (!BRAND_KEYS.has(key)) {
		refuse(
			state,
			state.allowed.known.has(key)
				? { attribute: placeName(place), key, kind: 'placeholderInAttribute' }
				: { key, kind: 'placeholderUnknown' },
		);
	}
}

/**
 * Whether a text consists of one `{{content}}` without a fallback and white space.
 *
 * @param segments The segments of the text.
 * @returns True when it does.
 */
function isOwnContent(segments: readonly TextSegment[]): boolean {
	const placeholders = segments.filter((segment) => segment.kind === 'placeholder');
	const onlyWhiteSpace = segments.every(
		(segment) => segment.kind === 'placeholder' || segment.value.trim() === '',
	);
	const [only] = placeholders;
	return (
		onlyWhiteSpace &&
		placeholders.length === 1 &&
		only?.ref.key === CONTENT_KEY &&
		only.ref.fallback === null
	);
}

/**
 * Replaces the placeholders of a text by names and judges them.
 *
 * @param state The state.
 * @param text The text.
 * @param place Where it stands.
 * @param name Writes the name of the placeholder with an index.
 * @returns The text with names; the text itself when its syntax is broken.
 */
// oxlint-disable-next-line max-params -- the state, the text, its place and the writer of the names
function replace(
	state: State,
	text: string,
	place: Place,
	name: (index: number) => string,
): string {
	const parsed = parsePlaceholders(text);
	if (!parsed.ok) {
		refuse(state, { kind: 'syntax' });
		return text;
	}
	const pieces = parsed.segments.map((segment) => {
		if (segment.kind === 'text') return segment.value;
		judge(state, segment.ref, place);
		state.refs.push(segment.ref);
		return name(state.refs.length - 1);
	});
	if (place.kind === 'text' && isOwnContent(parsed.segments)) state.content.own += 1;
	return pieces.join('');
}

/**
 * The token of a placeholder.
 *
 * @param index The index of the placeholder.
 * @returns The token.
 */
function tokenAt(index: number): string {
	return `${TOKEN_START}${String(index)}${TOKEN_END}`;
}

/**
 * The name of a placeholder in CSS.
 *
 * @param index The index of the placeholder.
 * @returns A name the CSS parser takes as an identifier.
 */
function cssNameAt(index: number): string {
	return `vbph${String(index)}x`;
}

/** The placeholders of one import: the tokens, the refusals and how often `{{content}}` stands. */
interface PlaceholderTokens {
	/** Checks a text and replaces its placeholders by tokens. */
	readonly protect: (text: string, place: Place) => string;
	/** Like `protect` for CSS: a placeholder becomes a name the CSS parser accepts. */
	readonly protectCss: (css: string, place: Place) => string;
	/** Turns the names of `protectCss` into tokens. */
	readonly cssToTokens: (css: string) => string;
	/** Writes every token as its placeholder again. */
	readonly restore: (html: string) => string;
	/** The placeholder a value starts with, or null. */
	readonly leading: (value: string) => Readonly<PlaceholderRef> | null;
	/** The refusals so far, each once. */
	readonly refusals: () => ImportRefusal[];
	/** How many `{{content}}` stand as a text node of their own, and how many in a text at all. */
	readonly contentCounts: () => { own: number; total: number };
}

/**
 * Starts the placeholders of an import.
 *
 * @param allowed The keys the mail may use in text.
 * @returns The tokens.
 */
function createPlaceholderTokens(allowed: PlaceholderKeys): PlaceholderTokens {
	const state: State = { allowed, content: { own: 0, total: 0 }, refs: [], refusals: new Map() };
	const refAt = (index: string): PlaceholderRef | undefined => state.refs[Number(index)];
	return {
		contentCounts: () => state.content,
		cssToTokens: (css) =>
			css.replaceAll(CSS_TOKEN, (match, index: string) =>
				refAt(index) === undefined ? match : tokenAt(Number(index)),
			),
		leading: (value) => {
			const index = LEADING_TOKEN.exec(value.trim())?.groups?.index;
			return index === undefined ? null : (refAt(index) ?? null);
		},
		protect: (text, place) => replace(state, text, place, tokenAt),
		protectCss: (css, place) => replace(state, css, place, cssNameAt),
		refusals: () => [...state.refusals.values()],
		restore: (html) =>
			html.replaceAll(TOKEN, (match, index: string) => {
				const ref = refAt(index);
				return ref === undefined ? match : formatPlaceholder(ref);
			}),
	};
}

export { createPlaceholderTokens, hasToken, stripPrivateUse };
export type { Place, PlaceholderKeys, PlaceholderTokens };
