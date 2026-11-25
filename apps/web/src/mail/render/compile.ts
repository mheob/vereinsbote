/*
 * Compiles a template once: brand values go in, every other placeholder becomes a slot, and the
 * mail is rendered to HTML and plain text with a marker per slot. The result is split at the
 * markers; filling (`fill.ts`) only puts values into the slots. Runs in the browser (preview), on
 * Workers and on Node (sending).
 */
import { render, toPlainText } from '@react-email/render';
import { createElement } from 'react';

import { DEFAULT_LOCALE } from '@/i18n/locale';
import type { Locale } from '@/i18n/locale';
import {
	blockListSchema,
	collectMediaIds,
	collectPlaceholderRefs,
} from '@/mail/blocks/block-schema';
import type { Block } from '@/mail/blocks/block-schema';
import { brandSchema } from '@/mail/brand/brand-schema';
import type { Brand } from '@/mail/brand/brand-schema';
import { brandPlaceholderValues } from '@/mail/brand/brand-values';
import { Preheader } from '@/mail/components/preheader';
import { cleanHeaderText, escapeHtml, stripMarkers } from '@/mail/escape';
import { CONTENT_KEY } from '@/mail/placeholders/registry';
import { parsePlaceholders } from '@/mail/placeholders/syntax';
import type { PlaceholderRef } from '@/mail/placeholders/syntax';
import { compareCodePoints } from '@/server/compare-code-points';
import { mediaPath } from '@/server/media/ids';
import type { ImageType } from '@/server/media/ids';

import type { ResolvePlaceholder } from './inline-text';
import { slotMarker, splitParts } from './parts';
import type { Part } from './parts';
import { BlockContent, BlockRows } from './render-blocks';
import type { BlockContext } from './render-blocks';
import { StandardLayout } from './standard-layout';
import { mailTheme } from './theme';

interface MediaInfo {
	readonly type: ImageType;
	readonly width: number;
	readonly height: number;
}

type MailLayout = { readonly kind: 'standard' } | { readonly kind: 'html'; readonly html: string };

type MailBody =
	| { readonly kind: 'blocks'; readonly blocks: readonly Block[]; readonly layout: MailLayout }
	/** Cleaned HTML of an import; placeholders only in its text. */
	| { readonly kind: 'html'; readonly html: string };

interface MailSource {
	/** With placeholder syntax. */
	readonly subject: string;
	/** With placeholder syntax; `''` for none. */
	readonly preheader: string;
	readonly body: MailBody;
	/** The images the blocks use. */
	readonly media: ReadonlyMap<string, MediaInfo>;
}

interface CompiledMail {
	/** What each slot stands for; the index of a slot points here. */
	readonly slots: readonly Readonly<PlaceholderRef>[];
	readonly subject: readonly Part[];
	readonly preheader: readonly Part[];
	readonly html: readonly Part[];
	readonly text: readonly Part[];
}

/**
 * Why a source cannot be compiled: a broken placeholder, blocks or a brand that fail their
 * schema, a misplaced or missing `{{content}}`, or an image the source does not describe.
 */
type CompileFailure = 'syntax' | 'blocks' | 'brand' | 'content' | 'media';

type CompileResult =
	| { ok: true; mail: CompiledMail }
	| { ok: false; missingBrand: string[] }
	| { ok: false; invalid: CompileFailure };

type Segment =
	| { readonly kind: 'text'; readonly value: string }
	| { readonly kind: 'placeholder'; readonly ref: Readonly<PlaceholderRef> };

type Segments = readonly Segment[];

type PreparedBody =
	| { readonly kind: 'blocks'; readonly blocks: readonly Block[]; readonly layout: Segments | null }
	| { readonly kind: 'html'; readonly segments: Segments };

interface Prepared {
	readonly brand: Brand;
	readonly subject: Segments;
	readonly preheader: Segments;
	readonly body: PreparedBody;
}

interface Failure {
	ok: false;
	invalid: CompileFailure;
}

interface SlotTable {
	readonly slots: readonly Readonly<PlaceholderRef>[];
	readonly indexes: ReadonlyMap<string, number>;
}

const BRAND_PREFIX = 'brand.';
/** The comments React writes around a document's parts; mail clients need none of them. */
const REACT_COMMENTS = /<!--(?:\/?\$|html|head|body)-->/gu;
const DOCTYPE = /^<!DOCTYPE[^>]*>/u;
const BODY_TAG = /<body\b[^>]*>/iu;
/** Rows left out of the plain text (spacers, lines) still leave their line breaks behind. */
const BLANK_LINES = /\n{3,}/gu;
const PLAIN_TEXT_OPTIONS: Parameters<typeof toPlainText>[1] = {
	// Headings keep their case: a value filled in later could not follow an upper-case heading.
	selectors: ['h1', 'h2', 'h3'].map((selector) => ({ options: { uppercase: false }, selector })),
};

const fail = (invalid: CompileFailure): Failure => ({ invalid, ok: false });

/**
 * Removes the marker characters from every text of a value, so no template text and no brand
 * value can forge a marker.
 *
 * @param value A JSON-like value.
 * @returns The value with every string stripped.
 */
function stripDeep(value: unknown): unknown {
	if (typeof value === 'string') return stripMarkers(value);
	if (Array.isArray(value)) return value.map((item: unknown) => stripDeep(item));
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripDeep(item)]));
	}
	return value;
}

/**
 * Parses a text with placeholder syntax after removing the marker characters.
 *
 * @param text The text.
 * @returns The segments, or null when the syntax is broken.
 */
function segmentsOf(text: string): Segments | null {
	const parsed = parsePlaceholders(stripMarkers(text));
	return parsed.ok ? parsed.segments : null;
}

/**
 * The placeholders of segments.
 *
 * @param segments The segments.
 * @returns The references.
 */
function refsOf(segments: Segments): Readonly<PlaceholderRef>[] {
	return segments.flatMap((segment) => (segment.kind === 'placeholder' ? [segment.ref] : []));
}

/**
 * How often `{{content}}` appears.
 *
 * @param refs The placeholders.
 * @returns The count.
 */
function countContent(refs: readonly Readonly<PlaceholderRef>[]): number {
	return refs.filter((ref) => ref.key === CONTENT_KEY).length;
}

/**
 * Strips, parses and validates a body.
 *
 * @param body The body of the source.
 * @returns The prepared body, or why it cannot be compiled.
 */
function prepareBody(body: MailBody): PreparedBody | Failure {
	if (body.kind === 'html') {
		const segments = segmentsOf(body.html);
		return segments === null ? fail('syntax') : { kind: 'html', segments };
	}
	const layout = body.layout.kind === 'html' ? segmentsOf(body.layout.html) : null;
	if (body.layout.kind === 'html' && layout === null) return fail('syntax');
	const blocks = blockListSchema.safeParse(stripDeep(body.blocks));
	return blocks.success ? { blocks: blocks.data, kind: 'blocks', layout } : fail('blocks');
}

/**
 * Whether `{{content}}` stands where it belongs: exactly once in an HTML layout, nowhere else.
 *
 * @param prepared The prepared source.
 * @returns Whether the source places it right.
 */
function contentInPlace(prepared: Prepared): boolean {
	const { body } = prepared;
	const outside = [
		...refsOf(prepared.subject),
		...refsOf(prepared.preheader),
		...(body.kind === 'html' ? refsOf(body.segments) : collectPlaceholderRefs(body.blocks)),
	];
	if (countContent(outside) > 0) return false;
	return body.kind === 'html' || body.layout === null || countContent(refsOf(body.layout)) === 1;
}

/**
 * Whether the source describes every image its blocks show.
 *
 * @param prepared The prepared source.
 * @param media The images of the source.
 * @returns Whether no image is unknown.
 */
function mediaKnown(prepared: Prepared, media: ReadonlyMap<string, MediaInfo>): boolean {
	const { body } = prepared;
	return body.kind === 'html' || collectMediaIds(body.blocks).every((id) => media.has(id));
}

/**
 * Strips the marker characters from the source and the brand, parses the placeholder syntax and
 * validates blocks, brand, images and the place of `{{content}}`.
 *
 * @param source The source.
 * @param brand The brand.
 * @returns The prepared source, or why it cannot be compiled.
 */
function prepare(source: Readonly<MailSource>, brand: Brand): ({ ok: true } & Prepared) | Failure {
	const subject = segmentsOf(source.subject);
	const preheader = segmentsOf(source.preheader);
	if (subject === null || preheader === null) return fail('syntax');
	const body = prepareBody(source.body);
	if ('invalid' in body) return body;
	const parsedBrand = brandSchema.safeParse(stripDeep(brand));
	if (!parsedBrand.success) return fail('brand');
	const prepared: Prepared = { body, brand: parsedBrand.data, preheader, subject };
	if (!contentInPlace(prepared)) return fail('content');
	return mediaKnown(prepared, source.media) ? { ok: true, ...prepared } : fail('media');
}

/**
 * Every placeholder of a prepared source except `{{content}}`, in the order of the mail.
 *
 * @param prepared The prepared source.
 * @returns The references.
 */
function allRefs(prepared: Prepared): Readonly<PlaceholderRef>[] {
	const { body } = prepared;
	const bodyRefs =
		body.kind === 'html'
			? refsOf(body.segments)
			: [...collectPlaceholderRefs(body.blocks), ...refsOf(body.layout ?? [])];
	return [...refsOf(prepared.subject), ...refsOf(prepared.preheader), ...bodyRefs].filter(
		(ref) => ref.key !== CONTENT_KEY,
	);
}

/**
 * The key of a slot: placeholders with the same key and fallback share one.
 *
 * @param ref The placeholder.
 * @returns The key.
 */
function slotKey(ref: Readonly<PlaceholderRef>): string {
	return JSON.stringify([ref.key, ref.fallback]);
}

/**
 * The slots of every placeholder that is not a brand value, in the order they appear.
 *
 * @param refs The placeholders.
 * @returns The slot table.
 */
function slotTable(refs: readonly Readonly<PlaceholderRef>[]): SlotTable {
	const slots: PlaceholderRef[] = [];
	const indexes = new Map<string, number>();
	for (const ref of refs) {
		if (!ref.key.startsWith(BRAND_PREFIX) && !indexes.has(slotKey(ref))) {
			indexes.set(slotKey(ref), slots.length);
			slots.push({ fallback: ref.fallback, key: ref.key });
		}
	}
	return { indexes, slots };
}

/**
 * The required brand placeholders the brand has no value for.
 *
 * @param refs The placeholders.
 * @param brandValues The values of the brand.
 * @returns The keys, each once, sorted.
 */
function missingBrandKeys(
	refs: readonly Readonly<PlaceholderRef>[],
	brandValues: ReadonlyMap<string, string>,
): string[] {
	const missing = refs
		.filter((ref) => ref.key.startsWith(BRAND_PREFIX) && ref.fallback === null)
		.map((ref) => ref.key)
		.filter((key) => !brandValues.has(key));
	return [...new Set(missing)].toSorted(compareCodePoints);
}

/**
 * The text of a placeholder while rendering: a brand value (or its fallback) directly, any other
 * placeholder as the marker of its slot.
 *
 * @param table The slot table.
 * @param brandValues The values of the brand.
 * @returns The resolver.
 */
function resolverFor(
	table: SlotTable,
	brandValues: ReadonlyMap<string, string>,
): ResolvePlaceholder {
	return (ref) =>
		ref.key.startsWith(BRAND_PREFIX)
			? (brandValues.get(ref.key) ?? ref.fallback ?? '')
			: slotMarker(table.indexes.get(slotKey(ref)) ?? 0);
}

/**
 * Joins segments to a text, with a placeholder's value from the resolver.
 *
 * @param segments The segments.
 * @param resolve The placeholder values.
 * @param content The text for `{{content}}`.
 * @returns The text.
 */
function joinSegments(segments: Segments, resolve: ResolvePlaceholder, content = ''): string {
	return segments
		.map((segment) => {
			if (segment.kind === 'text') return segment.value;
			return segment.ref.key === CONTENT_KEY ? content : resolve(segment.ref);
		})
		.join('');
}

/**
 * Renders an element to HTML without React's comments.
 *
 * @param element The element.
 * @returns The HTML, a document with its doctype.
 */
async function renderDocument(element: Parameters<typeof render>[0]): Promise<string> {
	const html = await render(element);
	return html.replaceAll(REACT_COMMENTS, '');
}

/**
 * Renders an element as a part of a document, without the doctype `render` adds.
 *
 * @param element The element.
 * @returns The HTML.
 */
async function renderFragment(element: Parameters<typeof render>[0]): Promise<string> {
	const html = await renderDocument(element);
	return html.replace(DOCTYPE, '');
}

/**
 * Puts the preview text at the start of an HTML document's body.
 *
 * @param html The document.
 * @param preheader The preview text with markers.
 * @returns The document with the hidden preview text.
 */
async function withPreheader(html: string, preheader: string): Promise<string> {
	if (preheader === '') return html;
	const element = await renderFragment(createElement(Preheader, { text: preheader }));
	const body = BODY_TAG.exec(html);
	if (body === null) return `${element}${html}`;
	const end = body.index + body[0].length;
	return `${html.slice(0, end)}${element}${html.slice(end)}`;
}

interface RenderInput {
	readonly prepared: Prepared;
	readonly resolve: ResolvePlaceholder;
	readonly media: ReadonlyMap<string, MediaInfo>;
	readonly origin: string;
	readonly locale: Locale;
	readonly subject: string;
	readonly preheader: string;
}

/**
 * What the block renderer needs: theme, placeholder values and image addresses.
 *
 * @param input The render input.
 * @returns The block context.
 */
function blockContext(input: RenderInput): BlockContext {
	const { media, origin } = input;
	return {
		image: (mediaId) => {
			const info = media.get(mediaId);
			if (info === undefined) return null;
			const src = `${origin}${mediaPath(mediaId, info.type)}`;
			return { height: info.height, src, width: info.width };
		},
		resolve: input.resolve,
		theme: mailTheme(input.prepared.brand),
	};
}

/**
 * Renders blocks in the standard layout, or into `{{content}}` of an HTML layout.
 *
 * @param input The render input.
 * @param blocks The blocks.
 * @param layout The segments of an HTML layout, or null for the standard layout.
 * @returns The HTML.
 */
async function renderBlocks(
	input: RenderInput,
	blocks: readonly Block[],
	layout: Segments | null,
): Promise<string> {
	const context = blockContext(input);
	if (layout === null) {
		const { locale, origin, prepared, preheader, subject } = input;
		const layoutContext = { brand: prepared.brand, locale, origin, theme: context.theme };
		const children = createElement(BlockRows, { blocks, context });
		return renderDocument(
			createElement(StandardLayout, { children, context: layoutContext, preheader, subject }),
		);
	}
	const content = await renderFragment(createElement(BlockContent, { blocks, context }));
	const html = joinSegments(layout, (ref) => escapeHtml(input.resolve(ref)), content);
	return withPreheader(html, input.preheader);
}

/**
 * Renders the HTML of the mail with markers.
 *
 * @param input The prepared source, the resolver and the render settings.
 * @returns The HTML.
 */
async function renderHtml(input: RenderInput): Promise<string> {
	const { body } = input.prepared;
	if (body.kind === 'blocks') return renderBlocks(input, body.blocks, body.layout);
	const html = joinSegments(body.segments, (ref) => escapeHtml(input.resolve(ref)));
	return withPreheader(html, input.preheader);
}

/**
 * Removes the trailing slashes of an origin.
 *
 * @param origin The origin.
 * @returns The origin without them.
 */
function trimOrigin(origin: string): string {
	const clean = stripMarkers(origin);
	let end = clean.length;
	while (end > 0 && clean.charAt(end - 1) === '/') end -= 1;
	return clean.slice(0, end);
}

interface MailInput {
	readonly prepared: Prepared;
	readonly refs: readonly Readonly<PlaceholderRef>[];
	readonly brandValues: ReadonlyMap<string, string>;
	readonly media: ReadonlyMap<string, MediaInfo>;
	readonly origin: string;
	readonly locale: Locale;
}

/**
 * Renders a prepared source with a marker per slot and splits it into parts.
 *
 * @param input The prepared source, its placeholders, the brand values and the render settings.
 * @returns The compiled mail.
 */
async function renderMail(input: MailInput): Promise<CompiledMail> {
	const { locale, media, origin, prepared } = input;
	const table = slotTable(input.refs);
	const resolve = resolverFor(table, input.brandValues);
	const subject = cleanHeaderText(joinSegments(prepared.subject, resolve));
	const preheader = cleanHeaderText(joinSegments(prepared.preheader, resolve));
	const html = await renderHtml({ locale, media, origin, preheader, prepared, resolve, subject });
	const text = toPlainText(html, PLAIN_TEXT_OPTIONS).replaceAll(BLANK_LINES, '\n\n').trim();
	return {
		html: splitParts(html),
		preheader: splitParts(preheader),
		slots: table.slots,
		subject: splitParts(subject),
		text: splitParts(text),
	};
}

/**
 * Compiles a template for sending or a preview.
 *
 * @param source The subject, preview text, body and images.
 * @param brand The brand.
 * @param appOrigin The origin of the app (`APP_URL`), for absolute image URLs.
 * @param locale The language of the layout's fixed texts.
 * @returns The compiled mail, the missing required brand values, or why the source is invalid.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function compileMail(
	source: Readonly<MailSource>,
	brand: Brand,
	appOrigin: string,
	locale: Locale = DEFAULT_LOCALE,
): Promise<CompileResult> {
	const prepared = prepare(source, brand);
	if (!prepared.ok) return prepared;
	const origin = trimOrigin(appOrigin);
	const brandValues = brandPlaceholderValues(prepared.brand, origin);
	const refs = allRefs(prepared);
	const missingBrand = missingBrandKeys(refs, brandValues);
	if (missingBrand.length > 0) return { missingBrand, ok: false };
	const mail = await renderMail({
		brandValues,
		locale,
		media: source.media,
		origin,
		prepared,
		refs,
	});
	return { mail, ok: true };
}

export { compileMail };
export type {
	CompiledMail,
	CompileFailure,
	CompileResult,
	MailBody,
	MailLayout,
	MailSource,
	MediaInfo,
};
