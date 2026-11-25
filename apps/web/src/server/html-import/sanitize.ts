/* oxlint-disable typescript/prefer-readonly-parameter-types, no-use-before-define -- the nodes of the HTML tree are mutable, and cleaning an element, its children and a conditional comment call each other */
/*
 * Cleans the HTML of an imported mail (Design 22). The page is parsed as a whole document, then
 * cleaned in two steps: our own pass takes out what must not stay and tells the findings (scripts,
 * forms, frames, event handlers, unsafe URLs and CSS, comments), and `hast-util-sanitize` with an
 * allow-list schema keeps only the elements, attributes and URL schemes a mail needs. The result
 * is written again from the tree, never copied from the source.
 *
 * Outlook's conditional comments (`<!--[if mso]> … <![endif]-->`) stay as comments; their
 * content is parsed, cleaned the same way and written back, and a comment that could end early
 * (or whose content would not survive) is removed. Every other comment goes.
 */
import type { Comment, Element, ElementContent, Properties, Root, RootContent } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { sanitize } from 'hast-util-sanitize';
import type { Schema } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';

import { cleanDeclarations, cleanStyleSheet } from './css';
import type { FindingsCollector, RemovedWhat } from './findings';
import { judgeUrl } from './media-refs';
import type { UrlAttribute } from './media-refs';
import type { Place, PlaceholderTokens } from './placeholders';

/** What a cleaning pass needs. */
interface CleanContext {
	readonly tokens: PlaceholderTokens;
	readonly findings: FindingsCollector;
	/** The origin of the app, for the images of the app. */
	readonly origin: string;
	/** The images of the app the mail shows; filled while cleaning. */
	readonly mediaIds: Set<string>;
}

/** Elements that go with everything inside them, and what the finding calls them. */
const REMOVED_ELEMENTS: Readonly<Record<string, RemovedWhat>> = {
	applet: 'object',
	audio: 'object',
	base: 'base',
	button: 'form',
	canvas: 'object',
	datalist: 'form',
	dialog: 'object',
	embed: 'object',
	form: 'form',
	frame: 'frame',
	frameset: 'frame',
	iframe: 'frame',
	input: 'form',
	link: 'object',
	math: 'object',
	noframes: 'frame',
	noscript: 'script',
	object: 'object',
	optgroup: 'form',
	option: 'form',
	output: 'form',
	param: 'object',
	portal: 'frame',
	script: 'script',
	select: 'form',
	svg: 'object',
	template: 'object',
	textarea: 'form',
	track: 'object',
	video: 'object',
};
const STRIPPED_WITH_CONTENT = Object.keys(REMOVED_ELEMENTS);
/** Characters of an Outlook condition: `mso`, `IE`, `gte mso 9`, `(gte mso 9)|(IE)`, `!mso`. */
const CONDITION = /^[\w !&().=|]{1,40}$/u;
const CONDITIONAL_OPEN = '[if ';
const CONDITIONAL_CLOSE = '<![endif]';
const REVEALED_OPEN = '<!';
const CONDITIONAL_TAIL = ']>';
const COMMENT_BREAKERS = ['-->', '--!>', '<!--'];
const NOT_FOUND = -1;
const META_EQUIVALENTS: ReadonlySet<string> = new Set(['content-type', 'x-ua-compatible']);
const DEFAULT_LANGUAGE = 'de';

const TEXT_ATTRIBUTES = [
	'ariaDescribedBy',
	'ariaHidden',
	'ariaLabel',
	'ariaLabelledBy',
	'ariaLevel',
	'ariaRoleDescription',
	'align',
	'bgColor',
	'border',
	'cellPadding',
	'cellSpacing',
	'className',
	'colSpan',
	'dir',
	'height',
	'lang',
	'noWrap',
	'role',
	'rowSpan',
	'style',
	'title',
	'vAlign',
	'width',
];

/** What `hast-util-sanitize` lets through: a mail's layout, text, list, image and link elements. */
const SCHEMA: Schema = {
	allowComments: true,
	allowDoctypes: false,
	ancestors: {},
	attributes: {
		'*': TEXT_ATTRIBUTES,
		a: ['href'],
		col: ['span'],
		colgroup: ['span'],
		font: ['color', 'face', 'size'],
		img: ['alt', 'src'],
		meta: ['charSet', 'content', 'httpEquiv', 'name'],
		ol: ['start', 'type'],
		th: ['scope'],
	},
	clobber: [],
	clobberPrefix: '',
	protocols: {
		href: ['http', 'https', 'mailto', 'tel'],
		src: ['http', 'https'],
	},
	required: {},
	strip: ['script', 'noscript', ...STRIPPED_WITH_CONTENT],
	tagNames: [
		'a',
		'abbr',
		'address',
		'article',
		'aside',
		'b',
		'blockquote',
		'body',
		'br',
		'caption',
		'center',
		'cite',
		'code',
		'col',
		'colgroup',
		'dd',
		'del',
		'div',
		'dl',
		'dt',
		'em',
		'figcaption',
		'figure',
		'font',
		'footer',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'head',
		'header',
		'hr',
		'html',
		'i',
		'img',
		'ins',
		'li',
		'main',
		'mark',
		'meta',
		'nav',
		'ol',
		'p',
		'pre',
		'q',
		's',
		'section',
		'small',
		'span',
		'strike',
		'strong',
		'style',
		'sub',
		'sup',
		'table',
		'tbody',
		'td',
		'tfoot',
		'th',
		'thead',
		'title',
		'tr',
		'u',
		'ul',
	],
};

/**
 * Writes a tree as HTML for a mail: attributes in single quotes (a placeholder with a fallback
 * keeps its double quotes as it stands) and nothing dangerous allowed.
 *
 * @param node The tree.
 * @returns The HTML.
 */
function writeTree(node: Root): string {
	return toHtml(node, { allowDangerousHtml: false, quote: "'", quoteSmart: false });
}

/**
 * The place a text in an element is in.
 *
 * @param parent The element, or null for the root.
 * @returns The place for the placeholder rules.
 */
function placeOf(parent: Element | null): Place {
	return parent?.tagName === 'title' ? { kind: 'title' } : { kind: 'text' };
}

/**
 * The name of an attribute as the source wrote it, for a refusal.
 *
 * @param property The property name of the tree.
 * @returns The attribute name.
 */
function attributeName(property: string): string {
	return property === 'className' ? 'class' : property.toLowerCase();
}

/**
 * Tells the import which image a kept URL names.
 *
 * @param verdict What the URL is: an image of the app or from another host.
 * @param verdict.mediaId The image of the app.
 * @param verdict.externalHost The host of an image from elsewhere.
 * @param element The element the URL belongs to.
 * @param context The cleaning context.
 */
function noteImage(
	verdict: Readonly<{ mediaId?: string; externalHost?: string }>,
	element: Element,
	context: CleanContext,
): void {
	if (verdict.mediaId !== undefined) context.mediaIds.add(verdict.mediaId);
	if (verdict.externalHost !== undefined && element.tagName === 'img') {
		context.findings.externalImage(verdict.externalHost);
	}
}

/**
 * Cleans the URL of an `href` or `src`.
 *
 * @param element The element the attribute belongs to.
 * @param attribute The attribute and its value.
 * @param attribute.name The attribute.
 * @param attribute.value The value.
 * @param context The cleaning context.
 * @returns The value to keep, or undefined when the URL goes.
 */
function cleanUrlAttribute(
	element: Element,
	attribute: Readonly<{ name: UrlAttribute; value: string }>,
	context: CleanContext,
): string | undefined {
	const { name, value } = attribute;
	const protectedValue = context.tokens.protect(value, { kind: 'attribute', name });
	const urlContext = { attribute: name, origin: context.origin };
	const verdict = judgeUrl(protectedValue, urlContext, context.tokens.leading(protectedValue));
	if (verdict.kind === 'drop') {
		context.findings.remove('unsafeUrl');
		return undefined;
	}
	noteImage(verdict, element, context);
	return verdict.value;
}

/**
 * Cleans a `style` attribute.
 *
 * @param value The declarations.
 * @param context The cleaning context.
 * @returns The cleaned declarations, or undefined when nothing stays.
 */
function cleanStyleAttribute(value: string, context: CleanContext): string | undefined {
	const { findings, tokens } = context;
	const css = tokens.protectCss(value, { kind: 'attribute', name: 'style' });
	const cleaned = tokens.cssToTokens(cleanDeclarations(css, findings));
	return cleaned.trim() === '' ? undefined : cleaned;
}

/**
 * Whether an attribute name is one of the two that hold a URL.
 *
 * @param name The property name.
 * @returns True for `href` and `src`.
 */
function isUrlAttribute(name: string): name is UrlAttribute {
	return name === 'href' || name === 'src';
}

/**
 * Cleans an attribute that holds a text: a URL, CSS or any other text. The attributes of
 * `<body>` lose a `<` or `>`: the compiler finds the end of the tag by its first `>`.
 *
 * @param element The element.
 * @param attribute The property and its value.
 * @param attribute.name The property name.
 * @param attribute.value The value.
 * @param context The cleaning context.
 * @returns The value to keep, or undefined when the attribute goes.
 */
function cleanTextProperty(
	element: Element,
	attribute: Readonly<{ name: string; value: string }>,
	context: CleanContext,
): string | undefined {
	const { name, value } = attribute;
	if (isUrlAttribute(name)) return cleanUrlAttribute(element, { name, value }, context);
	if (name === 'style') return cleanStyleAttribute(value, context);
	if (element.tagName === 'body' && /[<>]/u.test(value)) return undefined;
	return context.tokens.protect(value, { kind: 'attribute', name: attributeName(name) });
}

/**
 * Cleans one attribute: event handlers go, a text is checked (`cleanTextProperty`), placeholders
 * in a list of classes must be brand values.
 *
 * @param element The element.
 * @param attribute The property and its value.
 * @param attribute.name The property name.
 * @param attribute.value The value.
 * @param context The cleaning context.
 * @returns The value to keep, or undefined when the attribute goes.
 */
function cleanProperty(
	element: Element,
	attribute: Readonly<{ name: string; value: Properties[string] }>,
	context: CleanContext,
): Properties[string] {
	const { name, value } = attribute;
	if (name.toLowerCase().startsWith('on')) {
		context.findings.remove('eventHandler');
		return undefined;
	}
	const place: Place = { kind: 'attribute', name: attributeName(name) };
	if (Array.isArray(value)) {
		return value.map((item) =>
			typeof item === 'string' ? context.tokens.protect(item, place) : item,
		);
	}
	return typeof value === 'string' ? cleanTextProperty(element, { name, value }, context) : value;
}

/**
 * Cleans the attributes of an element.
 *
 * @param element The element.
 * @param context The cleaning context.
 * @returns The attributes that stay.
 */
function cleanProperties(element: Element, context: CleanContext): Properties {
	const cleaned: Properties = {};
	for (const [name, value] of Object.entries(element.properties)) {
		const kept = cleanProperty(element, { name, value }, context);
		if (kept !== undefined) cleaned[name] = kept;
	}
	return cleaned;
}

/**
 * The text a node holds, for a `<style>`.
 *
 * @param element The element.
 * @returns The text of its text children.
 */
function textOfChildren(element: Element): string {
	return element.children.map((child) => (child.type === 'text' ? child.value : '')).join('');
}

/**
 * Cleans a `<style>` element: its CSS goes through css-tree. An empty sheet takes the element
 * with it.
 *
 * @param element The element.
 * @param context The cleaning context.
 * @returns Whether the element stays.
 */
function cleanStyleElement(element: Element, context: CleanContext): boolean {
	const { findings, tokens } = context;
	const css = tokens.protectCss(textOfChildren(element), { kind: 'style' });
	const cleaned = tokens.cssToTokens(cleanStyleSheet(css, findings));
	if (cleaned.trim() === '') return false;
	element.properties = {};
	element.children = [{ type: 'text', value: cleaned }];
	return true;
}

/**
 * The text of a property value; a list (`http-equiv` is one) is joined by spaces.
 *
 * @param value The value.
 * @returns The text, empty for none.
 */
function propertyText(value: Properties[string]): string {
	return Array.isArray(value) ? value.join(' ') : String(value ?? '');
}

/**
 * Whether a `<meta>` stays: a refresh goes with a finding, an `http-equiv` other than the content
 * type and the compatibility mode goes without.
 *
 * @param element The element.
 * @param context The cleaning context.
 * @returns Whether the element stays.
 */
function keepMeta(element: Element, context: CleanContext): boolean {
	const equivalent = propertyText(element.properties.httpEquiv).trim().toLowerCase();
	if (equivalent === 'refresh') {
		context.findings.remove('metaRefresh');
		return false;
	}
	return equivalent === '' || META_EQUIVALENTS.has(equivalent);
}

/**
 * Whether an element goes with everything inside it: scripts, forms, frames and the like (with
 * a finding), and elements with a namespace such as Outlook's XML (without).
 *
 * @param element The element.
 * @param context The cleaning context.
 * @returns True when it goes.
 */
function isRemoved(element: Element, context: CleanContext): boolean {
	const { tagName } = element;
	const removed = REMOVED_ELEMENTS[tagName];
	if (removed !== undefined) context.findings.remove(removed);
	return removed !== undefined || tagName.includes(':') || tagName === 'xml';
}

/**
 * Cleans an element and what is inside it.
 *
 * @param element The element.
 * @param context The cleaning context.
 * @returns Whether the element stays.
 */
function cleanElement(element: Element, context: CleanContext): boolean {
	const { tagName } = element;
	if (isRemoved(element, context)) return false;
	if (tagName === 'meta' && !keepMeta(element, context)) return false;
	if (tagName === 'style') return cleanStyleElement(element, context);
	element.properties = cleanProperties(element, context);
	element.children = cleanNodes(element.children, placeOf(element), context);
	return true;
}

/**
 * Parses what a conditional comment says: an Outlook condition around content, or one of the
 * two markers of the downlevel-revealed form (`<!--[if !mso]><!-->` and `<!--<![endif]-->`).
 *
 * @param value The text of the comment.
 * @returns The condition and the content, `marker` for a marker, null for any other comment.
 */
function readConditional(value: string): { condition: string; inner: string } | 'marker' | null {
	if (value === CONDITIONAL_CLOSE) return 'marker';
	if (!value.startsWith(CONDITIONAL_OPEN)) return null;
	const close = value.indexOf(']>');
	if (close === NOT_FOUND) return null;
	const condition = value.slice(CONDITIONAL_OPEN.length, close);
	const rest = value.slice(close + CONDITIONAL_TAIL.length);
	if (!CONDITION.test(condition)) return null;
	if (rest === REVEALED_OPEN) return 'marker';
	return rest.endsWith(CONDITIONAL_CLOSE)
		? { condition, inner: rest.slice(0, -CONDITIONAL_CLOSE.length) }
		: null;
}

/**
 * Reads the tree a sanitizer returns as the root it is.
 *
 * @param node What `sanitize` returned for a root.
 * @returns The root.
 */
function asRoot(node: ReturnType<typeof sanitize>): Root {
	return node.type === 'root' ? node : { children: [], type: 'root' };
}

/**
 * Cleans the content of a conditional comment the way the document is cleaned.
 *
 * @param inner The HTML between `]>` and `<![endif]`.
 * @param context The cleaning context.
 * @returns The cleaned HTML, or null when it cannot sit in a comment.
 */
function cleanConditionalContent(inner: string, context: CleanContext): string | null {
	const fragment = fromHtml(inner, { fragment: true });
	fragment.children = cleanNodes(fragment.children, { kind: 'text' }, context);
	const html = writeTree(asRoot(sanitize(fragment, SCHEMA)));
	// A comment ends at `-->` and `--!>`; none may be in what is written into one, and `<!--`
	// would open a comment of its own.
	return COMMENT_BREAKERS.some((breaker) => html.includes(breaker)) ? null : html;
}

/**
 * Cleans a comment: Outlook's conditional comments stay (with cleaned content), the rest goes.
 *
 * @param comment The comment.
 * @param context The cleaning context.
 * @returns The comment to keep, or null.
 */
function cleanComment(comment: Comment, context: CleanContext): Comment | null {
	const conditional = readConditional(comment.value);
	if (conditional === 'marker') return comment;
	const content = conditional === null ? null : cleanConditionalContent(conditional.inner, context);
	if (conditional !== null && content !== null) {
		const { condition } = conditional;
		return {
			type: 'comment',
			value: `${CONDITIONAL_OPEN}${condition}${CONDITIONAL_TAIL}${content}${CONDITIONAL_CLOSE}`,
		};
	}
	context.findings.remove('comment');
	return null;
}

/**
 * Cleans the children of an element or the root.
 *
 * @param children The children.
 * @param place The place a text among them is in.
 * @param context The cleaning context.
 * @returns The children that stay; a doctype never does.
 */
function cleanNodes(
	children: readonly RootContent[],
	place: Place,
	context: CleanContext,
): ElementContent[] {
	const kept: ElementContent[] = [];
	for (const child of children) {
		if (child.type === 'text') {
			kept.push({ ...child, value: context.tokens.protect(child.value, place) });
		} else if (child.type === 'comment') {
			const comment = cleanComment(child, context);
			if (comment !== null) kept.push(comment);
		} else if (child.type === 'element' && cleanElement(child, context)) {
			kept.push(child);
		}
	}
	return kept;
}

/**
 * Finds the `<html>` element.
 *
 * @param root The tree.
 * @returns The element, or undefined.
 */
function findHtml(root: Root): Element | undefined {
	return root.children.find(
		(child): child is Element => child.type === 'element' && child.tagName === 'html',
	);
}

/**
 * Parses and cleans a whole document. A missing `lang` on `<html>` becomes German (the default
 * language), which the findings report.
 *
 * @param source The HTML.
 * @param context The cleaning context.
 * @returns The cleaned tree.
 */
function cleanDocument(source: string, context: CleanContext): Root {
	const root = fromHtml(source);
	root.children = cleanNodes(root.children, { kind: 'text' }, context);
	const cleaned = asRoot(sanitize(root, SCHEMA));
	const html = findHtml(cleaned);
	if (
		html !== undefined &&
		(typeof html.properties.lang !== 'string' || html.properties.lang === '')
	) {
		html.properties.lang = DEFAULT_LANGUAGE;
		context.findings.addedLang();
	}
	return cleaned;
}

export { cleanDocument, writeTree };
export type { CleanContext };
