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

/** What a URL is to the app: one of its images, another address on its origin, or elsewhere. */
type AppUrl =
	| { readonly kind: 'media'; readonly id: string; readonly path: string }
	| { readonly kind: 'ownOrigin' }
	| { readonly kind: 'elsewhere' };

/** The base for a relative URL when the app's origin is not known. */
const UNKNOWN_ORIGIN = 'https://app.invalid';
const ELSEWHERE: AppUrl = { kind: 'elsewhere' };

/**
 * The host name of an address in lower case without a trailing dot.
 *
 * @param url The address.
 * @returns The host name.
 */
function hostWithoutDot(url: URL): string {
	return url.hostname.replace(/\.$/u, '').toLowerCase();
}

/**
 * Whether an address is on the app's host: `http:` or `https:`, the same host (a trailing dot
 * and the case do not count) and the same port (the default port is no port).
 *
 * @param url The address.
 * @param app The origin of the app.
 * @returns True when a browser would reach the app's host.
 */
function isAppHost(url: URL, app: URL): boolean {
	const web = url.protocol === 'https:' || url.protocol === 'http:';
	return web && hostWithoutDot(url) === hostWithoutDot(app) && url.port === app.port;
}

/**
 * Tells what a URL is to the app. The URL is resolved like a browser does it (so `./`, `:443`,
 * an upper-case host and a relative path are what they are) and compared by origin. Any address
 * on the app's origin is one of its images, written as the canonical path without query or
 * fragment, or "ownOrigin": the caller drops it.
 *
 * @param url The URL as read.
 * @param origin The origin of the app; an empty text when unknown.
 * @returns The image, an address on the app's origin, or another address.
 */
function classifyAppUrl(url: string, origin: string): AppUrl {
	const base = new URL(origin === '' ? UNKNOWN_ORIGIN : origin);
	const resolved = URL.canParse(url, base) ? new URL(url, base) : null;
	if (resolved === null || !isAppHost(resolved, base)) return ELSEWHERE;
	if (!resolved.pathname.startsWith(MEDIA_PREFIX)) return { kind: 'ownOrigin' };
	const parsed = parseMediaFileName(resolved.pathname.slice(MEDIA_PREFIX.length));
	return parsed === null
		? { kind: 'ownOrigin' }
		: {
				id: parsed.id,
				kind: 'media',
				path: `${MEDIA_PREFIX}${parsed.id}.${parsed.type === 'jpeg' ? 'jpg' : 'png'}`,
			};
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
	const app = classifyAppUrl(url, origin);
	return app.kind === 'media' ? { kind: 'keep', mediaId: app.id, value: app.path } : DROP;
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
	const app = classifyAppUrl(url, origin);
	if (app.kind === 'media') return { kind: 'keep', mediaId: app.id, value: app.path };
	if (app.kind === 'ownOrigin') return DROP;
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
 * the mail is compiled (the brand schema allows `https:` and `mailto:` addresses only), so only an
 * address brand value may stand there. The placeholder is the whole value and has no fallback;
 * `placeholders.ts` makes sure of that.
 *
 * @param ref The placeholder the value starts with.
 * @returns Whether the value may stay.
 */
function leadingPlaceholderFits(ref: Readonly<PlaceholderRef>): boolean {
	return URL_BRAND_KEYS.has(ref.key) && ref.fallback === null;
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
	return leadingPlaceholderFits(leading) ? { kind: 'keep', value: url } : DROP;
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

export { classifyAppUrl, htmlMediaIds, judgeUrl, readUrl, swapHtmlMediaIds, URL_BRAND_KEYS };
export type { AppUrl, UrlAttribute, UrlContext, UrlVerdict };
