/* oxlint-disable typescript/prefer-readonly-parameter-types, no-script-url -- css-tree's nodes are a mutable tree that the cleaning edits; the list of refused text names `javascript:` */
/*
 * Cleans the CSS of an imported mail: a `<style>` sheet or a `style` attribute. Mails load
 * nothing and run nothing, so what can do either goes: `@import`, `@font-face`, `expression()`,
 * `behavior`, `-moz-binding`, `javascript:` in any form and every `url()` that is not `https:`.
 * What stays is written again from css-tree's tree, never copied from the source, and the result
 * passes a last text check; when that fails the whole text goes.
 *
 * css-tree comes through its ESM bundle (`dist`), the package's `lib` reads JSON with
 * `createRequire`, which the Workers bundle must not contain.
 */
import type { CssNode, Declaration, List, Rule } from 'css-tree';
import { generate, parse, walk } from 'css-tree/dist/csstree.esm';

import outlook from './caniemail-outlook.json';
import type { AppUrl } from './media-refs';

/** What the cleaning reports; the import turns it into findings. */
interface CssReport {
	/** Something was removed because it is unsafe or loads something. */
	readonly removed: () => void;
	/** A property or function that classic Outlook ignores. */
	readonly outlook: (name: string) => void;
	/** The host of an external `https:` URL the CSS loads. */
	readonly externalHost: (host: string) => void;
	/**
	 * Takes an image of the app a `url()` names (it is then checked and recorded as used).
	 * Says what the URL is to the app: an image (with the path to write), another address on
	 * the app's origin (dropped), or elsewhere.
	 */
	readonly mediaUrl: (url: string) => AppUrl;
}

/** At-rules a mail keeps; everything else (`@import`, `@font-face`, `@keyframes`, …) goes. */
const KEPT_AT_RULES: ReadonlySet<string> = new Set(['media', 'supports']);
/** Properties that run code in an old client; matched as a part of the name. */
const FORBIDDEN_PROPERTY_PARTS = ['behavior', 'binding'];
/** Functions that load or run something other than a checked `url()`. */
/** `url` is here too: a real `url()` is a `Url` node, so a function of that name was written with an escape. */
const FORBIDDEN_FUNCTIONS: ReadonlySet<string> = new Set([
	'element',
	'expression',
	'image',
	'image-set',
	'paint',
	'src',
	'url',
	'var',
]);
/** Text that must not be in the result, after escapes and white space are gone. */
const FORBIDDEN_TEXT = [
	'-moz-binding',
	'@import',
	'behavior',
	'expression(',
	'javascript:',
	'vbscript:',
];

/** A vendor prefix in front of a name, `-webkit-` in `-webkit-image-set`. */
const VENDOR_PREFIX = /^-[a-z]+-/u;

const OUTLOOK_PROPERTIES: ReadonlySet<string> = new Set(outlook.properties);
const OUTLOOK_FUNCTIONS: ReadonlySet<string> = new Set(outlook.functions);
const OUTLOOK_VALUES: ReadonlyMap<string, ReadonlySet<string>> = new Map(
	Object.entries(outlook.propertyValues).map(([property, values]) => [property, new Set(values)]),
);

const ESCAPE = /\\(?:(?<hex>[\da-f]{1,6})[\t\n\f\r ]?|(?<character>[^\n\f\r\da-f]))/giu;
const WORD = /[a-z-]+/gu;
const HEX_RADIX = 16;
const MAX_CODE_POINT = 1_114_111;
const SPACE = 32;
const DELETE = 127;

/**
 * Resolves the escapes of CSS (`\65xpression` is `expression`), so a check sees what a client
 * sees.
 *
 * @param text The CSS text.
 * @returns The text with every escape replaced by its character.
 */
function unescapeCss(text: string): string {
	return text.replaceAll(
		ESCAPE,
		(_match, hex: string | undefined, character: string | undefined) => {
			if (character !== undefined) return character;
			const codePoint = Number.parseInt(hex ?? '', HEX_RADIX);
			return codePoint > 0 && codePoint <= MAX_CODE_POINT
				? String.fromCodePoint(codePoint)
				: '\uFFFD';
		},
	);
}

/**
 * The form of a text the checks compare: escapes resolved, lower case, no white space or control
 * characters (a browser ignores them inside a scheme).
 *
 * @param text The text.
 * @returns The comparable text.
 */
function normalize(text: string): string {
	let result = '';
	for (const character of unescapeCss(text).toLowerCase()) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint > SPACE && codePoint !== DELETE && character.trim() !== '') result += character;
	}
	return result;
}

/**
 * Whether a text has something in it that must not reach a mail.
 *
 * @param text A piece of CSS.
 * @returns True when it has a forbidden word.
 */
function hasForbiddenText(text: string): boolean {
	const normalized = normalize(text);
	return FORBIDDEN_TEXT.some((word) => normalized.includes(word));
}

/**
 * The host of an `https:` URL.
 *
 * @param url The text of a `url()`, normalized.
 * @returns The host, or null when it is not an `https:` URL with a host.
 */
function httpsHost(url: string): string | null {
	if (!url.startsWith('https://')) return null;
	try {
		const { host } = new URL(url);
		return host === '' ? null : host;
	} catch {
		return null;
	}
}

/** What a declaration's value turned out to be. */
interface Verdict {
	safe: boolean;
	/** The hosts of the `https:` URLs it loads. */
	hosts: string[];
	/** The functions it calls, lower case. */
	functions: string[];
	/** The words of its text, lower case. */
	words: string[];
}

/**
 * Whether a function has a string in it. A string in a function can be an address (`image-set`
 * takes `"a.png" 1x`), and no function of a mail's CSS needs one.
 *
 * @param node The function.
 * @returns True when a string stands anywhere inside it.
 */
function hasString(node: CssNode): boolean {
	let found = false;
	walk(node, (inner) => {
		if (inner.type === 'String') found = true;
	});
	return found;
}

/**
 * Judges a `url()`: an image of the app is written relative and recorded, any other address must
 * be `https:`.
 *
 * @param node The `url()` node.
 * @param verdict What the value turned out to be so far.
 * @param report The report.
 */
function inspectUrl(node: CssNode & { type: 'Url' }, verdict: Verdict, report: CssReport): void {
	const app = report.mediaUrl(node.value);
	if (app.kind === 'media') {
		node.value = app.path;
		return;
	}
	if (app.kind === 'ownOrigin') {
		verdict.safe = false;
		return;
	}
	const host = httpsHost(normalize(node.value));
	if (host === null) verdict.safe = false;
	else verdict.hosts.push(host);
}

/**
 * Looks into a declaration's value: URLs, functions and text.
 *
 * @param value The value node.
 * @param report The report, which takes the images of the app.
 * @returns Whether it is safe, the hosts it loads from, the functions it calls and its words.
 */
function inspectValue(value: CssNode, report: CssReport): Verdict {
	const text = generate(value);
	const verdict: Verdict = {
		functions: [],
		hosts: [],
		safe: !hasForbiddenText(text),
		words: text.toLowerCase().match(WORD) ?? [],
	};
	walk(value, (node) => {
		if (node.type === 'Url') {
			inspectUrl(node, verdict, report);
		} else if (node.type === 'Function') {
			const name = normalize(node.name);
			const unprefixed = name.replace(VENDOR_PREFIX, '');
			if (FORBIDDEN_FUNCTIONS.has(unprefixed) || hasString(node)) verdict.safe = false;
			verdict.functions.push(name);
		} else if (node.type === 'Raw') {
			// A value css-tree could not read (`\75 rl(...)` is one) is not checked, so it goes.
			verdict.safe = false;
		}
	});
	return verdict;
}

/**
 * Tells the report which Outlook-unsupported CSS a declaration uses.
 *
 * @param property The property, lower case.
 * @param verdict What the value turned out to be.
 * @param report The report.
 */
function reportOutlook(property: string, verdict: Verdict, report: CssReport): void {
	const values = OUTLOOK_VALUES.get(property);
	const valueUsed = values !== undefined && verdict.words.some((word) => values.has(word));
	if (OUTLOOK_PROPERTIES.has(property) || valueUsed) report.outlook(property);
	for (const name of verdict.functions) {
		if (OUTLOOK_FUNCTIONS.has(`${name}()`)) report.outlook(`${name}()`);
	}
}

/**
 * Whether a declaration may stay; reports what it uses.
 *
 * @param declaration The declaration.
 * @param report The report.
 * @returns True to keep it.
 */
function keepDeclaration(declaration: Declaration, report: CssReport): boolean {
	const property = normalize(declaration.property);
	if (
		property.startsWith('--') ||
		FORBIDDEN_PROPERTY_PARTS.some((part) => property.includes(part))
	) {
		return false;
	}
	const verdict = inspectValue(declaration.value, report);
	if (!verdict.safe) return false;
	for (const host of verdict.hosts) report.externalHost(host);
	reportOutlook(property, verdict, report);
	return true;
}

/** Cleans the children of a block or a style sheet. */
type CleanList = (list: List<CssNode>, report: CssReport) => List<CssNode>;

/**
 * Whether a rule stays: it needs a selector that parsed, and its block is cleaned.
 *
 * @param rule The rule.
 * @param report The report.
 * @param clean Cleans the children of a block.
 * @returns True to keep it.
 */
function keepRule(rule: Rule, report: CssReport, clean: CleanList): boolean {
	if (rule.prelude.type === 'Raw' || hasForbiddenText(generate(rule.prelude))) return false;
	rule.block.children = clean(rule.block.children, report);
	return true;
}

/**
 * Whether a node of a style sheet or block stays; cleans what it contains. What is not a plain
 * declaration, rule or kept at-rule goes, and so does anything with a forbidden text in its
 * selector or prelude.
 *
 * @param node The node.
 * @param report The report.
 * @param clean Cleans the children of a block.
 * @returns True to keep it.
 */
function keepNode(node: CssNode, report: CssReport, clean: CleanList): boolean {
	if (node.type === 'Declaration') return keepDeclaration(node, report);
	if (node.type === 'Rule') return keepRule(node, report, clean);
	if (node.type !== 'Atrule' || !KEPT_AT_RULES.has(normalize(node.name)) || node.block === null) {
		return false;
	}
	const prelude = node.prelude === null ? '' : generate(node.prelude);
	if (node.prelude?.type === 'Raw' || hasForbiddenText(prelude)) return false;
	node.block.children = clean(node.block.children, report);
	return true;
}

/**
 * Cleans the children of a block or a style sheet.
 *
 * @param list The children.
 * @param report The report.
 * @returns The children that stay.
 */
function cleanList(list: List<CssNode>, report: CssReport): List<CssNode> {
	return list.filter((node) => {
		const keep = keepNode(node, report, cleanList);
		if (!keep) report.removed();
		return keep;
	});
}

/**
 * Makes the output safe inside `<style>` and an attribute: no `<` (it could close the element), and
 * nothing forbidden left.
 *
 * @param css The cleaned CSS.
 * @param report The report.
 * @returns The CSS, or an empty text when the last check finds something.
 */
function finish(css: string, report: CssReport): string {
	if (hasForbiddenText(css)) {
		report.removed();
		return '';
	}
	return css.replaceAll('<', String.raw`\3c `);
}

/**
 * Cleans the CSS of a `<style>` element.
 *
 * @param css The CSS text.
 * @param report What the cleaning reports.
 * @returns The cleaned CSS, written from css-tree's tree.
 */
function cleanStyleSheet(css: string, report: CssReport): string {
	const sheet = parse(css, { context: 'stylesheet', parseCustomProperty: false });
	if (sheet.type !== 'StyleSheet') return '';
	sheet.children = cleanList(sheet.children, report);
	return finish(generate(sheet), report);
}

/**
 * Cleans the declarations of a `style` attribute.
 *
 * @param css The declarations.
 * @param report What the cleaning reports.
 * @returns The cleaned declarations.
 */
function cleanDeclarations(css: string, report: CssReport): string {
	const list = parse(css, { context: 'declarationList', parseCustomProperty: false });
	if (list.type !== 'DeclarationList') return '';
	list.children = cleanList(list.children, report);
	return finish(generate(list), report);
}

export { cleanDeclarations, cleanStyleSheet };
export type { CssReport };
