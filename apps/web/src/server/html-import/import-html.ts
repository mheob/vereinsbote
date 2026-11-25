/* oxlint-disable typescript/prefer-readonly-parameter-types -- the cleaning's state (tokens, findings, tree) is mutable by design */
/*
 * Imports the HTML of a mail template or a layout (Design 22): size limit, cleaning
 * (`sanitize.ts`, `css.ts`), placeholder rules (`placeholders.ts`), images (`media-refs.ts`) and the
 * findings (`findings.ts`). It runs on Node and on Workers, without a database: the caller passes
 * what the area allows. The result is cleaned HTML in which the placeholders stand as written, so
 * `compileMail` can mark and fill them. Nothing is stored here.
 */
import type { Root } from 'hast';

import { compareCodePoints } from '@/server/compare-code-points';

import { createFindings, structureFindings } from './findings';
// oxlint-disable-next-line unicorn/prefer-export-from -- the types are used in this file as well
import type { FindingsCollector, ImportFinding } from './findings';
import { createPlaceholderTokens, stripPrivateUse } from './placeholders';
import type { PlaceholderKeys, PlaceholderTokens } from './placeholders';
import { cleanDocument, writeTree } from './sanitize';

const KIBIBYTE = 1024;
const MAX_IMPORT_KIBIBYTES = 500;
const GMAIL_CLIP_KIBIBYTES = 102;
/** The most an import takes: 500 KB. */
const MAX_IMPORT_BYTES = MAX_IMPORT_KIBIBYTES * KIBIBYTE;
/** Gmail clips a mail above this size; the import warns. */
const GMAIL_CLIP_BYTES = GMAIL_CLIP_KIBIBYTES * KIBIBYTE;

/** What is imported, with what it may use. */
type ImportKind =
	| {
			readonly kind: 'template';
			readonly allowed: PlaceholderKeys;
			readonly areaMediaIds: ReadonlySet<string>;
	  }
	| {
			readonly kind: 'ownLayout';
			/** The placeholders of the template and `content`. */
			readonly allowed: PlaceholderKeys;
			readonly areaMediaIds: ReadonlySet<string>;
	  }
	| {
			readonly kind: 'globalLayout';
			/** Brand values, base fields and `content`. */
			readonly allowed: PlaceholderKeys;
			readonly brandMediaIds: ReadonlySet<string>;
	  };

/** Why an import is refused. `key` names a placeholder; `mediaId` an image. */
type ImportRefusal =
	| { readonly kind: 'tooLarge' }
	| { readonly kind: 'placeholderUnknown' | 'placeholderForbidden'; readonly key: string }
	| {
			readonly kind: 'placeholderInAttribute';
			readonly key: string;
			readonly attribute: string;
	  }
	| { readonly kind: 'placeholderInComment'; readonly key: string }
	| {
			readonly kind: 'fallbackNotAllowed';
			readonly key: string;
			readonly attribute: string;
	  }
	| { readonly kind: 'placeholderHidden' }
	| { readonly kind: 'tooDeep' }
	| { readonly kind: 'contentMissing' }
	| { readonly kind: 'contentRepeated' }
	| { readonly kind: 'mediaForeign'; readonly mediaId: string }
	| { readonly kind: 'syntax' };

type ImportResult =
	| {
			readonly ok: true;
			/** The cleaned document, with placeholders in their syntax. */
			readonly html: string;
			readonly findings: readonly ImportFinding[];
			/** The images of the app it shows, sorted. */
			readonly mediaIds: readonly string[];
	  }
	| { readonly ok: false; readonly refusals: readonly ImportRefusal[] };

const DOCTYPE = '<!DOCTYPE html>';
const encoder = new TextEncoder();

/**
 * The origin of the app, as images from it are recognized.
 *
 * @param appOrigin `APP_URL`.
 * @returns The origin, or an empty text when it does not parse.
 */
function originOf(appOrigin: string): string {
	try {
		return new URL(appOrigin).origin;
	} catch {
		return '';
	}
}

/**
 * The images of the app a mail may show.
 *
 * @param kind What is imported.
 * @returns The ids of the library of the area, or of the brand.
 */
function allowedMedia(kind: ImportKind): ReadonlySet<string> {
	return kind.kind === 'globalLayout' ? kind.brandMediaIds : kind.areaMediaIds;
}

/**
 * Judges where `{{content}}` stands in a layout: once, as a text node of its own.
 *
 * @param kind What is imported.
 * @param counts How often `{{content}}` stands as a text node of its own and in any text.
 * @param counts.own As a text node of its own.
 * @param counts.total In any text.
 * @returns The refusals.
 */
function contentRefusals(
	kind: ImportKind,
	counts: { own: number; total: number },
): ImportRefusal[] {
	if (kind.kind === 'template') return [];
	if (counts.own === 0) return [{ kind: 'contentMissing' }];
	return counts.total > 1 ? [{ kind: 'contentRepeated' }] : [];
}

/** What cleaning a source left behind. */
interface Cleaned {
	readonly root: Root;
	readonly tokens: PlaceholderTokens;
	readonly findings: FindingsCollector;
	readonly mediaIds: ReadonlySet<string>;
	/** The document as written, placeholders still tokens. */
	readonly written: string;
}

/**
 * Parses and cleans a source.
 *
 * @param source The HTML as the user brought it.
 * @param kind What it is and what it may use.
 * @param appOrigin The origin of the app (`APP_URL`).
 * @returns The cleaned tree with what the cleaning met.
 */
function clean(source: string, kind: ImportKind, appOrigin: string): Cleaned {
	const tokens = createPlaceholderTokens(kind.allowed);
	const findings = createFindings();
	const mediaIds = new Set<string>();
	const origin = originOf(appOrigin);
	const root = cleanDocument(stripPrivateUse(source), {
		findings,
		inComment: false,
		mediaIds,
		origin,
		tokens,
	});
	return { findings, mediaIds, root, tokens, written: writeTree(root) };
}

/**
 * Everything that makes an import fail after the cleaning: broken or misplaced placeholders,
 * `{{content}}` of a layout and images of another library.
 *
 * @param kind What is imported.
 * @param cleaned What the cleaning left behind.
 * @returns The refusals; empty when the import is fine.
 */
function refusalsOf(kind: ImportKind, cleaned: Cleaned): ImportRefusal[] {
	const allowed = allowedMedia(kind);
	const refused = cleaned.tokens.refusals();
	// A placeholder that was refused stays in the text, which is no hiding.
	const hidden = refused.length === 0 && cleaned.tokens.hidden(cleaned.written);
	return [
		...refused,
		...(hidden ? [{ kind: 'placeholderHidden' } as const] : []),
		...contentRefusals(kind, cleaned.tokens.contentCounts()),
		...[...cleaned.mediaIds]
			.filter((mediaId) => !allowed.has(mediaId))
			.toSorted(compareCodePoints)
			.map((mediaId): ImportRefusal => ({ kind: 'mediaForeign', mediaId })),
	];
}

/**
 * The success of an import: the written HTML, the findings and the images.
 *
 * @param cleaned What the cleaning left behind.
 * @returns The result.
 */
function accept(cleaned: Cleaned): ImportResult {
	const html = cleaned.tokens.restore(`${DOCTYPE}${cleaned.written}`);
	const bytes = encoder.encode(html).byteLength;
	const clipped: ImportFinding[] = bytes > GMAIL_CLIP_BYTES ? [{ bytes, kind: 'clipped' }] : [];
	return {
		findings: [...cleaned.findings.collect(), ...structureFindings(cleaned.root), ...clipped],
		html,
		mediaIds: [...cleaned.mediaIds].toSorted(compareCodePoints),
		ok: true,
	};
}

/**
 * Cleans and checks the HTML of a template or a layout.
 *
 * @param source The HTML as the user brought it.
 * @param kind What it is and what it may use.
 * @param appOrigin The origin of the app (`APP_URL`), to recognize its images.
 * @returns The cleaned HTML with findings and the images it shows, or the refusals.
 */
function importHtml(source: string, kind: ImportKind, appOrigin: string): ImportResult {
	if (encoder.encode(source).byteLength > MAX_IMPORT_BYTES) {
		return { ok: false, refusals: [{ kind: 'tooLarge' }] };
	}
	try {
		const cleaned = clean(source, kind, appOrigin);
		const refusals = refusalsOf(kind, cleaned);
		return refusals.length > 0 ? { ok: false, refusals } : accept(cleaned);
	} catch (error) {
		// The parsers and the cleaning recurse, so a hostile nesting overflows the stack.
		if (error instanceof RangeError) return { ok: false, refusals: [{ kind: 'tooDeep' }] };
		throw error;
	}
}

/**
 * The images of the app an HTML shows, whatever else is wrong with it (the save locks them before
 * it checks the HTML against the library).
 *
 * @param html The HTML.
 * @param appOrigin The origin of the app (`APP_URL`).
 * @returns The ids of the images the HTML shows; none when it is too large or too deep.
 */
function importedMediaIds(html: string, appOrigin: string): string[] {
	const everything: ImportKind = {
		allowed: { keys: new Set(), known: new Set() },
		areaMediaIds: new Set(),
		kind: 'template',
	};
	const result = importHtml(html, everything, appOrigin);
	if (result.ok) return [...result.mediaIds];
	return result.refusals.flatMap((refusal) =>
		refusal.kind === 'mediaForeign' ? [refusal.mediaId] : [],
	);
}

export { GMAIL_CLIP_BYTES, importedMediaIds, importHtml, MAX_IMPORT_BYTES };
export type { ImportFinding, ImportKind, ImportRefusal, ImportResult };
