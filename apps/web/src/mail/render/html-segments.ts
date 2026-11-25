/*
 * Writes the HTML of an import (a template or a layout, from `server/html-import`) with its
 * placeholders filled or marked. The text around a placeholder decides how its value is written:
 * HTML-escaped in text and attributes, reduced to plain characters inside `<style>`, where
 * entities do not work and nothing may leave the element. Values come from the brand or are
 * markers; nothing here parses a value.
 */
import { escapeHtml } from '@/mail/escape';
import { CONTENT_KEY } from '@/mail/placeholders/registry';
import type { PlaceholderRef } from '@/mail/placeholders/syntax';

import type { ResolvePlaceholder } from './inline-text';

type Segment =
	| { readonly kind: 'text'; readonly value: string }
	| { readonly kind: 'placeholder'; readonly ref: Readonly<PlaceholderRef> };

/** A text with its placeholders, as `parsePlaceholders` gives it. */
type Segments = readonly Segment[];

const STYLE_OPEN = '<style';
const STYLE_CLOSE = '</style';
const HEAD_CLOSE = '</head';
const NOT_FOUND = -1;
/** What stands in front of an image path of the app: an `src` attribute or a CSS `url()`. */
const IMAGE_PREFIXES = ["src='", 'src="', 'url(', "url('", 'url("'];
/** What may stand in a value inside `<style>`: letters, digits, space and `# , . % _ - "`. */
const NOT_CSS_SAFE = /[^\p{L}\p{N} #,.%_"-]/gu;

/**
 * Finds the next `<style` that opens an element (`<styles` does not).
 *
 * @param lower A lower-case text.
 * @param from Where to start.
 * @returns The index, or -1.
 */
function indexOfStyleOpen(lower: string, from: number): number {
	let index = lower.indexOf(STYLE_OPEN, from);
	while (index !== NOT_FOUND && !/[\s/>]/u.test(lower.charAt(index + STYLE_OPEN.length))) {
		index = lower.indexOf(STYLE_OPEN, index + STYLE_OPEN.length);
	}
	return index;
}

/**
 * Whether a placeholder that follows a text stands inside a `<style>` element, given where the
 * text before it ended. A `<style` in an attribute or a comment makes this say yes where a
 * browser says no; the value is then reduced to plain characters, which is the safe direction.
 *
 * @param text The text.
 * @param inStyle Whether the text starts inside `<style>`.
 * @returns Whether it ends inside `<style>`.
 */
function endsInStyle(text: string, inStyle: boolean): boolean {
	const lower = text.toLowerCase();
	let inside = inStyle;
	let from = 0;
	for (;;) {
		const index = inside ? lower.indexOf(STYLE_CLOSE, from) : indexOfStyleOpen(lower, from);
		if (index === NOT_FOUND) return inside;
		inside = !inside;
		from = index + (inside ? STYLE_OPEN : STYLE_CLOSE).length;
	}
}

/**
 * A value for a place inside `<style>`: only plain characters stay, so it cannot close the
 * element, end a rule or start a URL. Brand colours (`#rrggbb`) and font stacks pass unchanged.
 *
 * @param value The value.
 * @returns The value without the other characters.
 */
function cssValue(value: string): string {
	return value.replaceAll(NOT_CSS_SAFE, '');
}

/**
 * Gives the images of the app in the text (`src` and CSS `url()`) the origin of the app: an import writes them as
 * `/media/<file>`, a mail needs the address.
 *
 * @param text The fixed text of an import.
 * @param origin The origin of the app, without a trailing slash.
 * @returns The text with absolute image addresses.
 */
function withImageOrigin(text: string, origin: string): string {
	let result = text;
	for (const prefix of IMAGE_PREFIXES) {
		result = result.replaceAll(`${prefix}/media/`, `${prefix}${origin}/media/`);
	}
	return result;
}

/** What to write for a placeholder of an import. */
interface HtmlValues {
	readonly resolve: ResolvePlaceholder;
	/** The origin of the app, for the images in the text. */
	readonly origin: string;
	/** The HTML for `{{content}}`. */
	readonly content?: string;
}

/**
 * Joins the segments of an HTML text: text as it is (images with the origin), a placeholder in
 * the way its place needs.
 *
 * @param segments The segments.
 * @param values The values to write.
 * @returns The HTML.
 */
function joinHtml(segments: Segments, values: HtmlValues): string {
	let inStyle = false;
	return segments
		.map((segment) => {
			if (segment.kind === 'text') {
				inStyle = endsInStyle(segment.value, inStyle);
				return withImageOrigin(segment.value, values.origin);
			}
			if (segment.ref.key === CONTENT_KEY) return values.content ?? '';
			const value = values.resolve(segment.ref);
			return inStyle ? cssValue(value) : escapeHtml(value);
		})
		.join('');
}

/**
 * Adds a `<style>` to an HTML layout: at the end of its `<head>`, or right before `{{content}}`
 * when it has none.
 *
 * @param layout The segments of the layout.
 * @param style The element.
 * @returns The segments with the element.
 */
function withStyleInHead(layout: Segments, style: string): Segments {
	const head = layout.findIndex(
		(segment) => segment.kind === 'text' && segment.value.toLowerCase().includes(HEAD_CLOSE),
	);
	const element: Segment = { kind: 'text', value: style };
	if (head !== NOT_FOUND) {
		const segment = layout[head];
		if (segment?.kind !== 'text') return layout;
		const split = segment.value.toLowerCase().indexOf(HEAD_CLOSE);
		return [
			...layout.slice(0, head),
			{
				kind: 'text',
				value: `${segment.value.slice(0, split)}${style}${segment.value.slice(split)}`,
			},
			...layout.slice(head + 1),
		];
	}
	const content = layout.findIndex(
		(segment) => segment.kind === 'placeholder' && segment.ref.key === CONTENT_KEY,
	);
	return content === NOT_FOUND
		? layout
		: [...layout.slice(0, content), element, ...layout.slice(content)];
}

export { cssValue, joinHtml, withStyleInHead };
export type { Segments };
