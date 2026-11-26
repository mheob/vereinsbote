/*
 * The look of a system mail (a login link, an invitation, a warning; Design 14): heading,
 * paragraphs and an optional button, rendered as blocks of the brand's standard layout in the
 * recipient's language. Global layouts do not apply. When the brand layout cannot be rendered (a
 * required brand value is missing, the blocks refuse a value such as an `http:` link of a local
 * APP_URL, or rendering throws), the plain version goes: text and simple HTML without the brand.
 * The texts are values: the renderer escapes them and never reads them for placeholders. Needs no
 * database; runs on Node, on Vercel and on Workers.
 */
import type { Locale } from '@/i18n/locale';
import type { Block } from '@/mail/blocks/block-schema';
import type { InlineNode, TextDoc } from '@/mail/blocks/text-doc';
import { cleanHeaderText, escapeHtml } from '@/mail/escape';
import { compileMail } from '@/mail/render/compile';
import { fillMail } from '@/mail/render/fill';
import type { BrandState } from '@/server/brand/brand';
import { errorLabel } from '@/server/error-label';

/** What a system mail says; the link of the button is a finished URL. */
interface SystemMailContent {
	readonly heading: string;
	readonly paragraphs: readonly string[];
	readonly button: Readonly<{ label: string; url: string }> | null;
}

interface ComposedSystemMail {
	readonly html: string;
	readonly text: string;
	/** `brand`: the standard layout of the brand; `plain`: the fallback without it. */
	readonly layout: 'brand' | 'plain';
}

/** The slot the subject goes into, so the subject is filled as a value, never parsed. */
const SUBJECT_SLOT = 'subject';
const LINE_BREAK = /\r\n|[\r\n]/u;
/** The schemes the plain version links; anything else stays text. */
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * The lines of a paragraph as inline nodes, joined by line breaks.
 *
 * @param paragraph The paragraph.
 * @returns Text nodes and line breaks; an empty line is a break only.
 */
function inlineLines(paragraph: string): InlineNode[] {
	const nodes: InlineNode[] = [];
	for (const [index, line] of paragraph.split(LINE_BREAK).entries()) {
		if (index > 0) nodes.push({ type: 'hardBreak' });
		if (line !== '') nodes.push({ text: line, type: 'text' });
	}
	return nodes;
}

/**
 * The content as blocks of the standard layout: a heading, one text block with the paragraphs and
 * the button.
 *
 * @param content The content.
 * @returns The blocks.
 */
function systemBlocks(content: SystemMailContent): Block[] {
	const doc: TextDoc = {
		content: content.paragraphs.map((paragraph) => ({
			content: inlineLines(paragraph),
			type: 'paragraph',
		})),
		type: 'doc',
	};
	const blocks: Block[] = [
		{
			content: [{ text: content.heading, type: 'text' }],
			id: 'heading',
			level: 1,
			type: 'heading',
		},
	];
	if (content.paragraphs.length > 0) blocks.push({ doc, id: 'text', type: 'text' });
	if (content.button !== null) {
		blocks.push({
			align: 'left',
			href: content.button.url,
			id: 'button',
			label: [{ text: content.button.label, type: 'text' }],
			type: 'button',
		});
	}
	return blocks;
}

/**
 * Renders the content in the brand's standard layout.
 *
 * @param content The content.
 * @param subject The subject, the title of the document.
 * @param brand The brand.
 * @param appOrigin The origin of the app.
 * @param locale The language of the layout's fixed texts.
 * @returns The HTML and text, or null when the brand layout cannot be rendered.
 */
// oxlint-disable-next-line max-params -- the parameters of `composeSystemMail`
async function brandMail(
	content: SystemMailContent,
	subject: string,
	brand: Readonly<BrandState>,
	appOrigin: string,
	locale: Locale,
): Promise<{ html: string; text: string } | null> {
	const compiled = await compileMail(
		{
			body: { blocks: systemBlocks(content), kind: 'blocks', layout: { kind: 'standard' } },
			media: new Map(),
			preheader: '',
			subject: `{{${SUBJECT_SLOT}}}`,
		},
		brand.brand,
		appOrigin,
		locale,
	);
	if (!compiled.ok) return null;
	const filled = fillMail(compiled.mail, new Map([[SUBJECT_SLOT, subject]]));
	return filled.ok ? { html: filled.mail.html, text: filled.mail.text } : null;
}

/**
 * A paragraph for the plain HTML: escaped, its line breaks as `<br>`.
 *
 * @param paragraph The paragraph.
 * @returns The HTML of its content.
 */
function htmlLines(paragraph: string): string {
	return paragraph
		.split(LINE_BREAK)
		.map((line) => escapeHtml(line))
		.join('<br>');
}

/**
 * The button of the plain HTML: a link for a web address, else the label and the address as text.
 *
 * @param button The button.
 * @returns The paragraph.
 */
function plainButton(button: NonNullable<SystemMailContent['button']>): string {
	const { label, url } = button;
	const isWeb = URL.canParse(url) && WEB_PROTOCOLS.has(new URL(url).protocol);
	if (!isWeb) return `<p>${escapeHtml(label)}: ${escapeHtml(url)}</p>`;
	return `<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`;
}

/**
 * The plain version: the texts one below the other, without the brand.
 *
 * @param content The content.
 * @param subject The subject, the title of the document.
 * @param locale The language of the document.
 * @returns The HTML and text.
 */
function plainMail(
	content: SystemMailContent,
	subject: string,
	locale: Locale,
): ComposedSystemMail {
	const { button, heading, paragraphs } = content;
	const text = [
		heading,
		...paragraphs,
		...(button === null ? [] : [`${button.label}:\n${button.url}`]),
	].join('\n\n');
	const html = [
		'<!DOCTYPE html>',
		`<html lang="${locale}">`,
		'<head>',
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<title>${escapeHtml(cleanHeaderText(subject))}</title>`,
		'</head>',
		'<body>',
		`<h1>${escapeHtml(heading)}</h1>`,
		...paragraphs.map((paragraph) => `<p>${htmlLines(paragraph)}</p>`),
		...(button === null ? [] : [plainButton(button)]),
		'</body>',
		'</html>',
	].join('\n');
	return { html, layout: 'plain', text };
}

/**
 * Composes a system mail in the brand's standard layout (`compileMail` with the recipient's
 * language), or in the plain version when that fails. Never throws for the brand: an error while
 * rendering is logged by its label and the plain version goes.
 *
 * @param content The heading, the paragraphs and the button.
 * @param subject The subject.
 * @param brand The brand of the club.
 * @param appOrigin The origin of the app (`APP_URL`), for the images of the layout.
 * @param locale The recipient's language.
 * @returns The HTML, the text and which layout they have.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function composeSystemMail(
	content: SystemMailContent,
	subject: string,
	brand: Readonly<BrandState>,
	appOrigin: string,
	locale: Locale,
): Promise<ComposedSystemMail> {
	try {
		const branded = await brandMail(content, subject, brand, appOrigin, locale);
		if (branded !== null) return { ...branded, layout: 'brand' };
	} catch (error) {
		// oxlint-disable-next-line no-console -- an operator should know why mails lack the brand
		console.warn('system mail without the brand layout', errorLabel(error));
	}
	return plainMail(content, subject, locale);
}

export { composeSystemMail };
export type { ComposedSystemMail, SystemMailContent };
