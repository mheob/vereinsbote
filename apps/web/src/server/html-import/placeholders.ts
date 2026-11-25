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
import { URL_BRAND_KEYS } from './media-refs';

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

/** The brand values a style attribute and a style sheet take: colours and font stacks. */
const CSS_BRAND_KEYS: ReadonlySet<string> = new Set([
	'brand.primaryColor',
	'brand.secondaryColor',
	'brand.textColor',
	'brand.backgroundColor',
	'brand.linkColor',
	'brand.fontFamily',
	'brand.headingFontFamily',
]);

/** What a place takes: text takes what the area allows, an address attribute only address brand values. */
type PlaceRule = 'text' | 'url' | 'css' | 'free';

/**
 * What kind of values a place takes.
 *
 * @param place The place.
 * @returns `url` for `href` and `src`, `css` for CSS, `free` for the other attributes and the title.
 */
function ruleOf(place: Place): PlaceRule {
	if (place.kind === 'text') return 'text';
	if (place.kind === 'style') return 'css';
	if (place.kind === 'title') return 'free';
	if (place.name === 'href' || place.name === 'src') return 'url';
	return place.name === 'style' ? 'css' : 'free';
}

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
	/** Whether the cleaning is inside a conditional comment, where no placeholder may stand. */
	inComment: boolean;
	/** The names `protectCss` wrote for the CSS being cleaned; only they turn into tokens. */
	cssNames: Set<number>;
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

/** Where a placeholder stands and whether it is the whole value of its attribute. */
interface Site {
	readonly place: Place;
	readonly whole: boolean;
}

/**
 * The brand keys a kind of place takes.
 *
 * @param rule The kind of place.
 * @returns The keys.
 */
function keysFor(rule: PlaceRule): ReadonlySet<string> {
	if (rule === 'url') return URL_BRAND_KEYS;
	return rule === 'css' ? CSS_BRAND_KEYS : BRAND_KEYS;
}

/**
 * Judges a placeholder outside text. An address attribute takes an address brand value as its
 * whole value, CSS takes a colour or font brand value, any other attribute and the title any brand
 * value. A fallback is written into the mail as it is, so an address and CSS take none.
 *
 * @param state The state.
 * @param ref The placeholder.
 * @param site Where it stands.
 */
function judgeOutsideText(state: State, ref: Readonly<PlaceholderRef>, site: Site): void {
	const { key } = ref;
	const rule = ruleOf(site.place);
	if (!keysFor(rule).has(key) || (rule === 'url' && !site.whole)) {
		refuse(
			state,
			state.allowed.known.has(key) || BRAND_KEYS.has(key)
				? { attribute: placeName(site.place), key, kind: 'placeholderInAttribute' }
				: { key, kind: 'placeholderUnknown' },
		);
	} else if (ref.fallback !== null && rule !== 'free') {
		refuse(state, { attribute: placeName(site.place), key, kind: 'fallbackNotAllowed' });
	}
}

/**
 * Judges a placeholder: none stands in a conditional comment, in text it must be allowed in the
 * area, elsewhere it must be a brand value that fits its place.
 *
 * @param state The state.
 * @param ref The placeholder.
 * @param site Where it stands.
 */
function judge(state: State, ref: Readonly<PlaceholderRef>, site: Site): void {
	if (state.inComment) {
		refuse(state, { key: ref.key, kind: 'placeholderInComment' });
	} else if (ref.fallback !== null && !fallbackFits(ref.fallback, site.place)) {
		refuse(state, { kind: 'syntax' });
	} else if (site.place.kind === 'text') {
		judgeInText(state, ref.key);
	} else {
		judgeOutsideText(state, ref, site);
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
 * Whether a text is one placeholder and white space only.
 *
 * @param segments The segments of the text.
 * @returns True when it is.
 */
function isWholeValue(segments: readonly TextSegment[]): boolean {
	const placeholders = segments.filter((segment) => segment.kind === 'placeholder');
	return (
		placeholders.length === 1 &&
		segments.every((segment) => segment.kind === 'placeholder' || segment.value.trim() === '')
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
	const whole = isWholeValue(parsed.segments);
	const pieces = parsed.segments.map((segment) => {
		if (segment.kind === 'text') return segment.value;
		judge(state, segment.ref, { place, whole });
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

/**
 * Replaces the placeholders of a CSS text by names the CSS parser takes. A name the source wrote
 * itself is refused: it could stand for a placeholder judged somewhere else.
 *
 * @param state The state.
 * @param css The CSS.
 * @param place Where it stands.
 * @returns The CSS with names; the CSS itself when it is refused.
 */
function protectCss(state: State, css: string, place: Place): string {
	state.cssNames.clear();
	CSS_TOKEN.lastIndex = 0;
	if (CSS_TOKEN.test(css)) {
		refuse(state, { kind: 'syntax' });
		return css;
	}
	return replace(state, css, place, (index) => {
		state.cssNames.add(index);
		return cssNameAt(index);
	});
}

/**
 * Whether written HTML hides a placeholder.
 *
 * @param written The HTML as written, with tokens.
 * @param count How many placeholders the cleaning judged.
 * @returns True when a `{{` stands outside a token, or a token stands twice or out of range.
 */
function hasHiddenPlaceholder(written: string, count: number): boolean {
	if (written.includes('{{')) return true;
	const seen = new Set<number>();
	for (const match of written.matchAll(TOKEN)) {
		const index = Number(match.groups?.index);
		if (index >= count || seen.has(index)) return true;
		seen.add(index);
	}
	return false;
}

/** The placeholders of one import: the tokens, the refusals and how often `{{content}}` stands. */
interface PlaceholderTokens {
	/** Checks a text and replaces its placeholders by tokens. */
	readonly protect: (text: string, place: Place) => string;
	/** Like `protect` for CSS: a placeholder becomes a name the CSS parser accepts. */
	readonly protectCss: (css: string, place: Place) => string;
	/** Turns the names `protectCss` wrote for the last CSS into tokens. */
	readonly cssToTokens: (css: string) => string;
	/**
	 * Whether the written HTML (with tokens) hides a placeholder: a `{{` that is no token, a token
	 * that stands twice or has no placeholder. Every real placeholder is exactly one token there.
	 */
	readonly hidden: (written: string) => boolean;
	/** Writes every token as its placeholder again. */
	readonly restore: (html: string) => string;
	/** The placeholder a value starts with, or null. */
	readonly leading: (value: string) => Readonly<PlaceholderRef> | null;
	/** Runs a cleaning inside a conditional comment, where every placeholder is refused. */
	readonly withinComment: <T>(clean: () => T) => T;
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
	const state: State = {
		allowed,
		content: { own: 0, total: 0 },
		cssNames: new Set(),
		inComment: false,
		refs: [],
		refusals: new Map(),
	};
	const refAt = (index: string): PlaceholderRef | undefined => state.refs[Number(index)];
	return {
		contentCounts: () => state.content,
		cssToTokens: (css) =>
			css.replaceAll(CSS_TOKEN, (match, index: string) =>
				state.cssNames.has(Number(index)) ? tokenAt(Number(index)) : match,
			),
		hidden: (written) => hasHiddenPlaceholder(written, state.refs.length),
		leading: (value) => {
			const index = LEADING_TOKEN.exec(value.trim())?.groups?.index;
			return index === undefined ? null : (refAt(index) ?? null);
		},
		protect: (text, place) => replace(state, text, place, tokenAt),
		protectCss: (css, place) => protectCss(state, css, place),
		refusals: () => [...state.refusals.values()],
		restore: (html) =>
			html.replaceAll(TOKEN, (match, index: string) => {
				const ref = refAt(index);
				return ref === undefined ? match : formatPlaceholder(ref);
			}),
		withinComment: (clean) => {
			const before = state.inComment;
			state.inComment = true;
			try {
				return clean();
			} finally {
				state.inComment = before;
			}
		},
	};
}

export { createPlaceholderTokens, hasToken, stripPrivateUse };
export type { Place, PlaceholderKeys, PlaceholderTokens };
