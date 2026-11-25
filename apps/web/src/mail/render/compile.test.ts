import { describe, expect, it } from 'vite-plus/test';

import type { Locale } from '@/i18n/locale';
import type { Block } from '@/mail/blocks/block-schema';
import type { InlineNode } from '@/mail/blocks/text-doc';
import { DEFAULT_BRAND } from '@/mail/brand/brand-schema';
import type { Brand } from '@/mail/brand/brand-schema';

import { compileMail } from './compile';
import type { CompiledMail, CompileResult, MailSource } from './compile';
import { fillMail } from './fill';
import type { FilledMail } from './fill';
import type { Part } from './parts';

const ORIGIN = 'https://verein.example/';
const MEDIA_ID = 'm'.repeat(22);
const LOGO_ID = 'l'.repeat(22);
/** A marker of slot 0 as a template or a value could try to forge it. */
const FORGED = '\uE0000\uE001';
const MARKERS = /[\uE000\uE001]/u;

const text = (value: string): InlineNode => ({ text: value, type: 'text' });
const placeholder = (key: string, fallback: string | null = null): InlineNode => ({
	attrs: { fallback, key },
	type: 'placeholder',
});
const paragraph = (...content: readonly InlineNode[]): Block => ({
	doc: { content: [{ content, type: 'paragraph' }], type: 'doc' },
	id: 'text',
	type: 'text',
});

/**
 * A source in the standard layout.
 *
 * @param blocks The blocks.
 * @param overrides Other fields of the source.
 * @returns The source.
 */
function source(blocks: readonly Block[], overrides: Partial<MailSource> = {}): MailSource {
	return {
		body: { blocks, kind: 'blocks', layout: { kind: 'standard' } },
		media: new Map(),
		preheader: '',
		subject: 'Hallo {{contact.firstName}}',
		...overrides,
	};
}

/**
 * Compiles a source.
 *
 * @param mail The source.
 * @returns The result.
 */
async function compile(mail: Readonly<MailSource>): Promise<CompileResult> {
	return compileMail(mail, DEFAULT_BRAND, ORIGIN);
}

/**
 * Compiles a source and expects success.
 *
 * @param mail The source.
 * @param brand The brand.
 * @param locale The language of the layout.
 * @returns The compiled mail.
 */
async function compiled(
	mail: Readonly<MailSource>,
	brand: Brand = DEFAULT_BRAND,
	locale: Locale = 'de',
): Promise<CompiledMail> {
	const result = await compileMail(mail, brand, ORIGIN, locale);
	if (!result.ok) throw new Error(`compile failed: ${JSON.stringify(result)}`);
	return result.mail;
}

/**
 * Fills a compiled mail and expects success.
 *
 * @param mail The compiled mail.
 * @param values The placeholder values.
 * @returns The filled mail.
 */
function fillOrThrow(mail: CompiledMail, values: ReadonlyMap<string, string>): FilledMail {
	const result = fillMail(mail, values);
	if (!result.ok) throw new Error(`fill failed: ${result.missing.join(', ')}`);
	return result.mail;
}

/**
 * Compiles and fills a source and expects success.
 *
 * @param mail The source.
 * @param values The placeholder values.
 * @param brand The brand.
 * @returns The filled mail.
 */
async function filled(
	mail: Readonly<MailSource>,
	values: ReadonlyMap<string, string>,
	brand: Brand = DEFAULT_BRAND,
): Promise<FilledMail> {
	return fillOrThrow(await compiled(mail, brand), values);
}

/**
 * The fixed text of parts.
 *
 * @param parts The parts.
 * @returns The text parts joined.
 */
function fixedText(parts: readonly Part[]): string {
	return parts.map((part) => (part.kind === 'text' ? part.value : '')).join('');
}

/**
 * How many slots parts have.
 *
 * @param parts The parts.
 * @returns The number of slot parts.
 */
function slotCount(parts: readonly Part[]): number {
	return parts.filter((part) => part.kind === 'slot').length;
}

/**
 * Everything a filled mail shows.
 *
 * @param mail The mail.
 * @returns Subject, preview text, HTML and text in one string.
 */
function allOf(mail: Readonly<FilledMail>): string {
	return `${mail.subject}${mail.preheader}${mail.html}${mail.text}`;
}

const ANNA = new Map([
	['contact.firstName', 'Anna'],
	['contact.email', 'anna@example.org'],
]);

const GREETING = paragraph(text('Hallo '), placeholder('contact.firstName'));
const CONTENT = paragraph(text('Inhalt'));
const CONTENT_IN_BLOCK = paragraph(placeholder('content'));

const IMAGE: Block = {
	alt: 'Bild',
	decorative: false,
	href: null,
	id: 'image',
	mediaId: MEDIA_ID,
	type: 'image',
};

describe(compileMail, () => {
	it('renders once with a slot per placeholder and keeps no marker in the fixed parts', async () => {
		const content = paragraph(text('Hallo '), placeholder('contact.firstName'), text('!'));
		const preheader = 'Für {{contact.firstName}} von {{brand.name}}';
		const mail = await compiled(source([content], { preheader }));
		expect(mail.slots).toStrictEqual([{ fallback: null, key: 'contact.firstName' }]);
		expect(mail.subject).toStrictEqual([
			{ kind: 'text', value: 'Hallo ' },
			{ index: 0, kind: 'slot' },
		]);
		expect(mail.preheader).toStrictEqual([
			{ kind: 'text', value: 'Für ' },
			{ index: 0, kind: 'slot' },
			{ kind: 'text', value: ' von Verein' },
		]);
		expect(fixedText([...mail.html, ...mail.text])).not.toMatch(MARKERS);
		expect(slotCount(mail.text)).toBe(1);
	});

	it('marks the title, the preview text and the content in the HTML', async () => {
		const mail = await compiled(source([GREETING], { preheader: '{{contact.firstName}}' }));
		expect(slotCount(mail.html)).toBe(3);
	});

	it('fills a value once and never parses it again', async () => {
		const values = new Map([
			['contact.firstName', '{{contact.email}}'],
			['contact.email', 'geheim@example.org'],
		]);
		const mail = await filled(source([GREETING]), values);
		expect(mail.html).toContain('Hallo {{contact.email}}');
		expect(mail.text).toContain('Hallo {{contact.email}}');
		expect(mail.subject).toBe('Hallo {{contact.email}}');
		expect(allOf(mail)).not.toContain('geheim@example.org');
	});

	it('drops forged markers from template text and values', async () => {
		const content = paragraph(text(`Vorher ${FORGED} nachher `), placeholder('contact.firstName'));
		const mail = await filled(
			source([content], {
				preheader: `Vorschau ${FORGED}`,
				subject: `Betreff ${FORGED} {{contact.firstName}}`,
			}),
			new Map([['contact.firstName', `An${FORGED}na`]]),
			{ ...DEFAULT_BRAND, name: `Verein ${FORGED}` },
		);
		expect(allOf(mail)).not.toMatch(MARKERS);
		expect(mail.text).toContain('Vorher 0 nachher An0na');
		expect(mail.subject).toBe('Betreff 0 An0na');
		expect(mail.preheader).toBe('Vorschau 0');
		expect(mail.html).toContain('Verein 0');
	});

	it('drops forged markers from links and alt texts', async () => {
		const image: Block = {
			...IMAGE,
			alt: `Bild ${FORGED}`,
			href: `https://example.org/${FORGED}`,
		};
		const media = new Map([[MEDIA_ID, { height: 300, type: 'png' as const, width: 600 }]]);
		const mail = await compiled(source([image], { media, subject: 'Betreff' }));
		expect(mail.slots).toStrictEqual([]);
		expect(fixedText(mail.html)).toContain('href="https://example.org/0"');
		expect(fixedText(mail.html)).toContain('alt="Bild 0"');
	});

	it.each([
		['hex in text', '<p>Hallo {{contact.firstName}} &#xE000;0&#xE001;</p>'],
		['hex in a link', '<p><a href="https://x.example/&#xE000;0&#xE001;">Link</a></p>'],
		['upper-case hex with leading zeros', '<p>&#X0000e000;0&#x0E001;</p>'],
		['decimal in text', '<p>&#57344;0&#57345;</p>'],
		[
			'a marker inside a hex reference in text',
			'<p>Hallo {{contact.firstName}} &#x\uE000E000;0&#x\uE001E001;</p>',
		],
		['a marker between & and # in text', '<p>&\uE000#xE000;0&\uE001#57345;</p>'],
		[
			'a marker inside a decimal reference in a link',
			'<p><a href="https://x.example/&#57\uE001344;0&#\uE00057345;">L</a></p>',
		],
		[
			'decimal in a link without semicolons',
			'<p><a href="https://x.example/&#0057344 0&#57345">L</a></p>',
		],
	])('refuses character references to marker characters in HTML (%s)', async (_name, html) => {
		const template = source([], { body: { html, kind: 'html' }, subject: 'S {{contact.email}}' });
		const layout = source([GREETING], {
			body: {
				blocks: [GREETING],
				kind: 'blocks',
				layout: { html: `${html}{{content}}`, kind: 'html' },
			},
		});
		await expect(compile(template)).resolves.toStrictEqual({ invalid: 'syntax', ok: false });
		await expect(compile(layout)).resolves.toStrictEqual({ invalid: 'syntax', ok: false });
	});

	it('keeps other character references in HTML', async () => {
		const html = '<p>&amp;#xE000; &#xE002; &#xe000b; &#57346;</p>';
		const mail = await filled(source([], { body: { html, kind: 'html' } }), ANNA);
		expect(mail.html).toBe(html);
		expect(mail.text).not.toMatch(MARKERS);
	});

	it('ends a placeholder line with its suffix, escaped and without forged markers', async () => {
		const line: Block = {
			id: 'line',
			ref: { fallback: null, key: 'salutation' },
			suffix: `,&<${FORGED}`,
			type: 'placeholderLine',
		};
		const mail = await filled(source([line]), new Map([...ANNA, ['salutation', 'Liebe Anna']]));
		expect(mail.html).toContain('>Liebe Anna,&amp;&lt;0</p>');
		expect(mail.text).toContain('Liebe Anna,&<0');
	});

	it('escapes values in HTML but not in plain text', async () => {
		const mail = await filled(source([GREETING]), new Map([['contact.firstName', `Anna <b>&"'`]]));
		expect(mail.html).toContain('Hallo Anna &lt;b&gt;&amp;&quot;&#39;');
		expect(mail.html).not.toContain('<b>');
		expect(mail.text).toContain(`Hallo Anna <b>&"'`);
	});

	it('escapes a value in the Outlook version of a button as well', async () => {
		const button: Block = {
			align: 'center',
			href: 'https://example.org/?a=1&b=2',
			id: 'button',
			label: [text('Für '), placeholder('contact.firstName')],
			type: 'button',
		};
		const mail = await filled(source([button]), new Map([['contact.firstName', 'x--><b>']]));
		expect(mail.html).not.toContain('x--><b>');
		expect(mail.html.split('Für x--&gt;&lt;b&gt;')).toHaveLength(3);
		expect(mail.html.split('href="https://example.org/?a=1&amp;b=2"')).toHaveLength(3);
	});

	it('keeps the subject on one line', async () => {
		const mail = await filled(
			source([], { subject: 'Hallo {{contact.lastName}}' }),
			new Map([['contact.lastName', 'Abel\r\nBcc: x@example.org']]),
		);
		expect(mail.subject).toBe('Hallo Abel Bcc: x@example.org');
	});

	it('uses the fallback, accepts an empty one and reports missing keys', async () => {
		const content = paragraph(
			placeholder('contact.city', 'Musterstadt'),
			text('|'),
			placeholder('contact.street', ''),
			text('|'),
			placeholder('contact.memberNumber'),
			placeholder('contact.birthDate'),
		);
		const mail = await compiled(source([content]));
		expect(fillMail(mail, ANNA)).toStrictEqual({
			missing: ['contact.birthDate', 'contact.memberNumber'],
			ok: false,
		});
		const values = new Map([
			['contact.firstName', 'Anna'],
			['contact.memberNumber', '7'],
			['contact.birthDate', '01.02.2003'],
		]);
		expect(fillOrThrow(mail, values).text).toContain('Musterstadt||701.02.2003');
	});

	it('fails the whole compile when a required brand value is missing', async () => {
		const content = paragraph(placeholder('brand.website'), placeholder('brand.imprintUrl', ''));
		await expect(
			compile(source([content], { subject: '{{brand.privacyUrl}}' })),
		).resolves.toStrictEqual({
			missingBrand: ['brand.privacyUrl', 'brand.website'],
			ok: false,
		});
	});

	it('puts brand values in before rendering and escapes them', async () => {
		const brand: Brand = {
			...DEFAULT_BRAND,
			footer: { ...DEFAULT_BRAND.footer, websiteUrl: 'https://verein.example/?a=1&b=2' },
			name: 'TSV <Beispiel> & Co',
		};
		const content = paragraph(placeholder('brand.name'), text(': '), placeholder('brand.website'));
		const subject = '{{brand.name}} grüßt {{contact.firstName}}';
		const mail = await filled(source([content], { subject }), ANNA, brand);
		expect(mail.subject).toBe('TSV <Beispiel> & Co grüßt Anna');
		expect(mail.html).toContain(
			'TSV &lt;Beispiel&gt; &amp; Co: https://verein.example/?a=1&amp;b=2',
		);
		expect(mail.text).toContain('TSV <Beispiel> & Co: https://verein.example/?a=1&b=2');
	});

	it('omits empty brand elements from the standard layout', async () => {
		const mail = await filled(source([CONTENT]), ANNA);
		expect(mail.html).not.toContain('<img');
		expect(mail.html).not.toContain('Impressum');
		expect(mail.html).not.toContain('Datenschutz');
		expect(mail.text).not.toContain('Impressum');
		expect(mail.html).toContain('Verein');
	});

	it('shows the header logo with the club name as its fallback alt text', async () => {
		const brand: Brand = {
			...DEFAULT_BRAND,
			headerLogo: { alt: '', height: 100, mediaId: LOGO_ID, type: 'png', width: 400 },
		};
		const mail = await filled(source([CONTENT]), ANNA, brand);
		expect(mail.html).toContain(`src="https://verein.example/media/${LOGO_ID}.png"`);
		expect(mail.html).toContain('alt="Verein"');
	});

	it('shows the footer links that are set, an unknown platform as text', async () => {
		const brand: Brand = {
			...DEFAULT_BRAND,
			footer: {
				...DEFAULT_BRAND.footer,
				imprintUrl: 'https://verein.example/impressum',
				links: [{ display: 'icon', label: '', url: 'https://verein.example/blog' }],
			},
		};
		const mail = await filled(source([CONTENT]), ANNA, brand);
		expect(mail.html).toContain('href="https://verein.example/impressum"');
		expect(mail.html).toContain('>Impressum</a>');
		expect(mail.html).toContain('>verein.example/blog</a>');
		expect(mail.text).toContain('Impressum https://verein.example/impressum');
	});

	it('writes the fixed texts of the layout in the given language', async () => {
		const brand: Brand = {
			...DEFAULT_BRAND,
			footer: { ...DEFAULT_BRAND.footer, privacyUrl: 'https://verein.example/privacy' },
		};
		const mail = await compiled(source([]), brand, 'en');
		expect(fixedText(mail.html)).toContain('<html lang="en"');
		expect(fixedText(mail.html)).toContain('>Privacy policy</a>');
	});

	it('puts the rendered blocks into {{content}} of an HTML layout', async () => {
		const layout =
			'<html><head><title>{{brand.name}}</title></head><body class="x"><p>Kopf {{contact.firstName}}</p>{{content}}<p>Fuß {{brand.name}}</p></body></html>';
		const body = {
			blocks: [GREETING],
			kind: 'blocks',
			layout: { html: layout, kind: 'html' },
		} as const;
		const mail = await filled(source([], { body }), ANNA);
		expect(mail.html).toMatch(
			/^<html><head><title>Verein<\/title><style>.*<\/style><\/head><body class="x">/u,
		);
		expect(mail.html).toContain('<p>Kopf Anna</p><table role="presentation"');
		expect(mail.html).toContain('Hallo Anna</p>');
		expect(mail.html).toMatch(/<\/table><p>Fuß Verein<\/p><\/body><\/html>$/u);
		expect(mail.text).toBe('Kopf Anna\n\nHallo Anna\n\nFuß Verein');
	});

	it('adds the rule that stacks columns to the head of an HTML layout', async () => {
		const layout = '<html><head><title>x</title></head><body>{{content}}</body></html>';
		const body = {
			blocks: [GREETING],
			kind: 'blocks',
			layout: { html: layout, kind: 'html' },
		} as const;
		const mail = await filled(source([], { body }), ANNA);
		expect(mail.html).toMatch(
			/^<html><head><title>x<\/title><style>@media only screen and \(max-width: 620px\) \{ \.vb-column \{ display: block !important;[^<]*<\/style><\/head><body>/u,
		);
		expect(mail.html.split('.vb-column {')).toHaveLength(2);
	});

	it('adds the rule that stacks columns before {{content}} when the layout has no head', async () => {
		const layout = '<html><body><p>Kopf</p>{{content}}</body></html>';
		const body = {
			blocks: [GREETING],
			kind: 'blocks',
			layout: { html: layout, kind: 'html' },
		} as const;
		const mail = await filled(source([], { body }), ANNA);
		expect(mail.html).toMatch(
			/^<html><body><p>Kopf<\/p><style>@media[^<]*\.vb-column[^<]*<\/style><table/u,
		);
	});

	it('writes the rule that stacks columns once in the standard layout', async () => {
		const mail = await filled(source([GREETING]), ANNA);
		expect(mail.html.split('.vb-column {')).toHaveLength(2);
	});

	it('puts a brand value into a style element as it is and escapes it in an attribute', async () => {
		const brand: Brand = {
			...DEFAULT_BRAND,
			fonts: { ...DEFAULT_BRAND.fonts, text: 'times' },
		};
		const html =
			"<style>p{font-family:{{brand.fontFamily}}}</style><p style='font-family:{{brand.fontFamily}}'>x</p>";
		const mail = await filled(source([], { body: { html, kind: 'html' } }), ANNA, brand);
		expect(mail.html).toContain('<style>p{font-family:"Times New Roman", Times, serif}</style>');
		expect(mail.html).toContain("style='font-family:&quot;Times New Roman&quot;, Times, serif'");
	});

	it('puts a brand colour into a style element and marks a contact placeholder in the text', async () => {
		const html = '<style>td{color:{{brand.primaryColor}}}</style><p>{{salutation}}</p>';
		const mail = await compiled(source([], { body: { html, kind: 'html' } }));
		expect(fixedText(mail.html)).toContain(
			`<style>td{color:${DEFAULT_BRAND.colors.primary}}</style>`,
		);
		expect(slotCount(mail.html)).toBe(1);
	});

	it('cannot leave a style element through a brand value or a fallback', async () => {
		const brand: Brand = { ...DEFAULT_BRAND, name: 'a</style><script>alert(1)</script>{}' };
		const html =
			'<STYLE>p{content:"{{brand.name}}";x:{{brand.register | "</style><script>alert(2)</script>"}}}</STYLE><p>x</p>';
		const mail = await filled(source([], { body: { html, kind: 'html' } }), ANNA, brand);
		expect(mail.html).not.toContain('<script');
		expect(mail.html.split('</STYLE>')).toHaveLength(2);
		expect(mail.html.toLowerCase().split('</style')).toHaveLength(2);
	});

	it('gives the images of an HTML template the origin of the app', async () => {
		const html = `<img src='/media/${MEDIA_ID}.png' alt=''><img src="/media/${LOGO_ID}.jpg" alt="">`;
		const mail = await filled(source([], { body: { html, kind: 'html' } }), ANNA);
		expect(mail.html).toBe(
			`<img src='https://verein.example/media/${MEDIA_ID}.png' alt=''><img src="https://verein.example/media/${LOGO_ID}.jpg" alt="">`,
		);
	});

	it('puts the preview text at the start of the body of an HTML layout', async () => {
		const layout = '<html><body><p>Kopf</p>{{content}}</body></html>';
		const body = { blocks: [], kind: 'blocks', layout: { html: layout, kind: 'html' } } as const;
		const mail = await filled(source([], { body, preheader: 'Neu' }), ANNA);
		expect(mail.html).toMatch(/^<html><body><div data-skip-in-text="true"[^>]*>Neu/u);
		expect(mail.text).toBe('Kopf');
	});

	it('fills placeholders in the text of an HTML template', async () => {
		const body = {
			html: '<p>Hallo {{contact.firstName}}, {{brand.name}}</p>',
			kind: 'html',
		} as const;
		const mail = await filled(source([], { body }), ANNA);
		expect(mail.html).toBe('<p>Hallo Anna, Verein</p>');
		expect(mail.text).toBe('Hallo Anna, Verein');
	});

	it.each([
		['an HTML layout without {{content}}', '<p>leer</p>'],
		['an HTML layout with {{content}} twice', '{{content}}{{content}}'],
	])('refuses %s', async (_name, html) => {
		const body = { blocks: [], kind: 'blocks', layout: { html, kind: 'html' } } as const;
		await expect(compile(source([], { body }))).resolves.toStrictEqual({
			invalid: 'content',
			ok: false,
		});
	});

	it.each([
		['the subject', source([], { subject: '{{content}}' })],
		['an HTML template', source([], { body: { html: '{{content}}', kind: 'html' } })],
		['a block', source([CONTENT_IN_BLOCK])],
	])('refuses {{content}} in %s', async (_name, mail) => {
		await expect(compile(mail)).resolves.toStrictEqual({ invalid: 'content', ok: false });
	});

	it.each([
		{ brand: DEFAULT_BRAND, invalid: 'syntax', mail: source([], { subject: 'Hallo {{contact' }) },
		{ brand: DEFAULT_BRAND, invalid: 'blocks', mail: source([GREETING, GREETING]) },
		{ brand: DEFAULT_BRAND, invalid: 'media', mail: source([IMAGE]) },
		{ brand: { ...DEFAULT_BRAND, name: '' }, invalid: 'brand', mail: source([]) },
	])('refuses a source as $invalid', async ({ brand, invalid, mail }) => {
		await expect(compileMail(mail, brand, ORIGIN)).resolves.toStrictEqual({ invalid, ok: false });
	});

	it('skips an image block without an image', async () => {
		const image: Block = { ...IMAGE, alt: '', decorative: true, mediaId: null };
		const mail = await filled(source([image]), ANNA);
		expect(mail.html).not.toContain('<img');
	});
});
