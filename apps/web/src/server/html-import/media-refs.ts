/* oxlint-disable typescript/prefer-readonly-parameter-types -- the nodes of the HTML tree are mutable */
/*
 * The URLs of an imported mail. `href` takes `https:`, `http:`, `mailto:` and `tel:`; `src` takes
 * `https:`, `http:` and the app's `/media/<file>` paths, which are written back as the relative
 * path whichever form they came in (a stored mail is the same on every origin; `compileMail`
 * gives it the origin when it renders). Nothing else survives: not `javascript:`, not `data:`,
 * not a protocol-relative URL, not a relative path that is no image of the app.
 */
import type { Nodes } from 'hast';
import { fromHtml } from 'hast-util-from-html';

import type { PlaceholderRef } from '@/mail/placeholders/syntax';
import { parseMediaFileName } from '@/server/media/ids';

type UrlAttribute = 'href' | 'src';

/** What the import does with a URL. */
type UrlVerdict =
	| { readonly kind: 'drop' }
	| {
			readonly kind: 'keep';
			readonly value: string;
			/** An image of the app. */
			readonly mediaId?: string;
			/** The host of an image from elsewhere. */
			readonly externalHost?: string;
	  };

const DROP: UrlVerdict = { kind: 'drop' };
const HREF_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto', 'tel']);
const SRC_SCHEMES: ReadonlySet<string> = new Set(['http', 'https']);
/** Brand values that are addresses; the brand schema allows only `https:` and `mailto:` in them. */
const URL_BRAND_KEYS: ReadonlySet<string> = new Set([
	'brand.website',
	'brand.imprintUrl',
	'brand.privacyUrl',
	'brand.logoUrl',
	'brand.footerLogoUrl',
]);
const MEDIA_PREFIX = '/media/';
const CONDITIONAL_END = '<![endif]';
const CONDITIONAL_TAIL = ']>';
const NOT_FOUND = -1;
const SCHEME = /^(?<scheme>[a-z][\d+.a-z-]*):/iu;
/** What a browser removes from a URL before it reads it: a tab and line breaks anywhere. */
const URL_NOISE: ReadonlySet<string> = new Set(['\t', '\n', '\r']);
const SPACE = 32;

/**
 * Reads the way a browser does: C0 controls and spaces at both ends and tabs and line breaks
 * anywhere are away.
 *
 * @param value The attribute value.
 * @returns The value a browser reads.
 */
function readUrl(value: string): string {
	let start = 0;
	let end = value.length;
	while (start < end && (value.codePointAt(start) ?? 0) <= SPACE) start += 1;
	while (end > start && (value.codePointAt(end - 1) ?? 0) <= SPACE) end -= 1;
	let result = '';
	for (const character of value.slice(start, end))
		if (!URL_NOISE.has(character)) result += character;
	return result;
}

/**
 * The image of the app a URL names.
 *
 * @param url The URL as read.
 * @param origin The origin of the app.
 * @returns The id and the relative path, or null when the URL is no `/media/<file>` of the app.
 */
function appMedia(url: string, origin: string): { id: string; path: string } | null {
	const path = url.toLowerCase().startsWith(origin.toLowerCase()) ? url.slice(origin.length) : url;
	if (!path.startsWith(MEDIA_PREFIX)) return null;
	const parsed = parseMediaFileName(path.slice(MEDIA_PREFIX.length));
	return parsed === null ? null : { id: parsed.id, path };
}

/**
 * The host of an absolute `http:` or `https:` URL.
 *
 * @param url The URL.
 * @returns The host, or null when the URL has none or does not parse.
 */
function hostOf(url: string): string | null {
	try {
		const { host } = new URL(url);
		return host === '' ? null : host;
	} catch {
		return null;
	}
}

/**
 * Judges a URL without a scheme: only the app's images and, for `href`, a `#` anchor.
 *
 * @param attribute `href` or `src`.
 * @param url The URL as read.
 * @param origin The origin of the app.
 * @returns The verdict.
 */
function judgeRelative(attribute: UrlAttribute, url: string, origin: string): UrlVerdict {
	if (attribute === 'href') return url.startsWith('#') ? { kind: 'keep', value: url } : DROP;
	const media = appMedia(url, origin);
	return media === null ? DROP : { kind: 'keep', mediaId: media.id, value: media.path };
}

/**
 * Judges an absolute URL with a scheme the attribute takes.
 *
 * @param attribute `href` or `src`.
 * @param url The URL as read.
 * @param origin The origin of the app.
 * @returns The verdict.
 */
function judgeAbsolute(attribute: UrlAttribute, url: string, origin: string): UrlVerdict {
	if (attribute === 'href') return { kind: 'keep', value: url };
	const media = appMedia(url, origin);
	if (media !== null) return { kind: 'keep', mediaId: media.id, value: media.path };
	const host = hostOf(url);
	return host === null ? DROP : { externalHost: host, kind: 'keep', value: url };
}

/** The attribute and the app a URL is judged for. */
interface UrlContext {
	readonly attribute: UrlAttribute;
	/** The origin of the app (`APP_URL`'s origin). */
	readonly origin: string;
}

/**
 * Judges a URL that has no placeholder in front.
 *
 * @param url The URL as read.
 * @param context The attribute and the app.
 * @returns The verdict.
 */
function judgePlainUrl(url: string, context: UrlContext): UrlVerdict {
	const { attribute, origin } = context;
	const scheme = SCHEME.exec(url)?.groups?.scheme?.toLowerCase();
	if (scheme === undefined) return judgeRelative(attribute, url, origin);
	const schemes = attribute === 'href' ? HREF_SCHEMES : SRC_SCHEMES;
	return schemes.has(scheme) ? judgeAbsolute(attribute, url, origin) : DROP;
}

/**
 * Whether a value that starts with a placeholder may stay: its value comes from the brand when
 * the mail is compiled, so only an address brand value may stand there, and its fallback has to
 * be a URL the attribute takes itself.
 *
 * @param ref The placeholder the value starts with.
 * @param context The attribute and the app.
 * @returns Whether the value may stay.
 */
function leadingPlaceholderFits(ref: Readonly<PlaceholderRef>, context: UrlContext): boolean {
	if (!URL_BRAND_KEYS.has(ref.key)) return false;
	if (ref.fallback === null || ref.fallback === '') return true;
	return judgePlainUrl(readUrl(ref.fallback), context).kind === 'keep';
}

/**
 * Judges a URL.
 *
 * @param value The attribute value; placeholders are tokens.
 * @param context The attribute and the app.
 * @param leading The placeholder the value starts with, or null.
 * @returns Keep it (as written back) or drop it.
 */
function judgeUrl(
	value: string,
	context: UrlContext,
	leading: Readonly<PlaceholderRef> | null,
): UrlVerdict {
	const url = readUrl(value);
	if (url === '') return DROP;
	if (leading === null) return judgePlainUrl(url, context);
	return leadingPlaceholderFits(leading, context) ? { kind: 'keep', value: url } : DROP;
}

/**
 * The content of an Outlook conditional comment, which only Outlook reads as HTML.
 *
 * @param comment The text of a comment.
 * @returns The HTML between `]>` and `<![endif]`, or null for any other comment.
 */
function conditionalContent(comment: string): string | null {
	const close = comment.indexOf(']>');
	if (!comment.startsWith('[if ') || close === NOT_FOUND || !comment.endsWith(CONDITIONAL_END)) {
		return null;
	}
	return comment.slice(close + CONDITIONAL_TAIL.length, -CONDITIONAL_END.length);
}

/**
 * Collects the images of the app a cleaned mail shows, those in conditional comments too.
 *
 * @param node The node to look in.
 * @param ids Where the ids go.
 */
function collectImages(node: Nodes, ids: Set<string>): void {
	if (node.type === 'comment') {
		const content = conditionalContent(node.value);
		if (content !== null) collectImages(fromHtml(content, { fragment: true }), ids);
	}
	if (node.type === 'element' && node.tagName === 'img') {
		const src = readUrl(node.properties.src ?? '');
		const parsed = src.startsWith(MEDIA_PREFIX)
			? parseMediaFileName(src.slice(MEDIA_PREFIX.length))
			: null;
		if (parsed !== null) ids.add(parsed.id);
	}
	if ('children' in node) {
		for (const child of node.children) collectImages(child, ids);
	}
}

/**
 * The images of the app a mail shows (the `img` elements with a `/media/<file>` source, read from
 * the parsed HTML, and those in Outlook's conditional comments). The templates record them as used, so the library does not
 * delete them.
 *
 * @param html The cleaned HTML of an import.
 * @returns The media ids, each once.
 */
function htmlMediaIds(html: string): string[] {
	const ids = new Set<string>();
	collectImages(fromHtml(html), ids);
	return [...ids];
}

/**
 * Replaces the images of a cleaned mail by their copies (a template copied into another area).
 *
 * @param html The cleaned HTML.
 * @param copies The copy of each image: source id to copy id.
 * @returns The HTML that shows the copies.
 */
function swapHtmlMediaIds(html: string, copies: ReadonlyMap<string, string>): string {
	let result = html;
	for (const [id, copy] of copies) {
		result = result.replaceAll(`${MEDIA_PREFIX}${id}.`, `${MEDIA_PREFIX}${copy}.`);
	}
	return result;
}

export { htmlMediaIds, judgeUrl, swapHtmlMediaIds, URL_BRAND_KEYS };
export type { UrlAttribute, UrlContext, UrlVerdict };
