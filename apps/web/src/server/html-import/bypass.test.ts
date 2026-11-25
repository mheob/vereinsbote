import { fromHtml } from 'hast-util-from-html';
import { sanitize } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';
import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_BRAND } from '@/mail/brand/brand-schema';
import { compileMail } from '@/mail/render/compile';
import { fillMail } from '@/mail/render/fill';

import { importHtml } from './import-html';
import type { ImportKind } from './import-html';
import { SCHEMA } from './sanitize';
import { commentCount, findUnsafe, htmlOf, refusalsOf } from './testing';

const FOREIGN = 'FFFFFFFFFFFFFFFFFFFFFF';
const OWN = 'AAAAAAAAAAAAAAAAAAAAAA';
const ORIGIN = 'https://verein.example.org';
const KEYS = [
	'brand.fontFamily',
	'brand.footerLogoUrl',
	'brand.name',
	'brand.primaryColor',
	'brand.register',
	'brand.website',
	'contact.firstName',
];
const KIND: ImportKind = {
	allowed: { keys: new Set(KEYS), known: new Set([...KEYS, 'content']) },
	areaMediaIds: new Set([OWN]),
	kind: 'template',
};

/**
 * Imports a body inside a document.
 *
 * @param body The body.
 * @param head The head.
 * @returns The result.
 */
function run(body: string, head = ''): ReturnType<typeof importHtml> {
	return importHtml(
		`<html lang="de"><head>${head}</head><body>${body}</body></html>`,
		KIND,
		ORIGIN,
	);
}

/**
 * Compiles and fills an imported mail, the way it is sent.
 *
 * @param html The cleaned HTML.
 * @param firstName The value of the contact's first name.
 * @returns The HTML of the mail.
 */
async function sentHtml(html: string, firstName: string): Promise<string> {
	const compiled = await compileMail(
		{ body: { html, kind: 'html' }, media: new Map(), preheader: '', subject: 'S' },
		DEFAULT_BRAND,
		ORIGIN,
	);
	if (!compiled.ok) throw new Error(JSON.stringify(compiled));
	const filled = fillMail(compiled.mail, new Map([['contact.firstName', firstName]]));
	if (!filled.ok) throw new Error(JSON.stringify(filled));
	return filled.mail.html;
}

describe('placeholders in conditional comments', () => {
	it.each([
		[
			'a brand fallback in the text of a comment',
			`<!--[if mso]><p>{{brand.register | "--"}}><img src=x onerror=alert(1)></p><![endif]-->`,
		],
		[
			'an empty value between - and -> (P2)',
			'<!--[if mso]><p>-{{brand.register | ""}}-><b>revealed</b></p><![endif]-->',
		],
		[
			'a contact value (P3)',
			'<!--[if mso]><p>{{contact.firstName}}><b>revealed</b></p><![endif]-->',
		],
		[
			'a placeholder in CSS (P17)',
			`<!--[if mso]><style>.{{brand.register | "a--"}}>p{color:red}</style><![endif]-->`,
		],
	])('are refused: %s', (_name, body) => {
		expect(refusalsOf(run(body)).map(({ kind }) => kind)).toContain('placeholderInComment');
	});

	it('lose the attribute of P1 altogether', () => {
		const html = htmlOf(
			run(
				`<!--[if mso]><p title='{{brand.register | "--"}}><img src=x onerror=alert(1)>'>x</p><![endif]-->`,
			),
		);
		expect(html).not.toMatch(/register|onerror|title=/u);
	});

	it('name the key', () => {
		expect(refusalsOf(run('<!--[if mso]>{{brand.name}}<![endif]-->'))).toStrictEqual([
			{ key: 'brand.name', kind: 'placeholderInComment' },
		]);
	});

	it('lose an attribute value with < or > inside the comment', () => {
		const html = htmlOf(run(`<!--[if mso]><p title="a>b" lang="c<d" class="ok">x</p><![endif]-->`));
		expect(html).not.toMatch(/title=|lang='c/u);
		expect(html).toContain("class='ok'");
	});
});

describe('compiled and filled mail', () => {
	const HOSTILE = ['--', '--!', '-', '', '>', '-->', '--><img src=x onerror=alert(1)>'];

	it.each(HOSTILE)('keeps its comments with the value %j', async (value) => {
		const html = htmlOf(
			run(
				`<!--[if mso]><table><tr><td>Outlook</td></tr></table><![endif]--><p>{{contact.firstName | "-"}} {{brand.register | "--"}}</p><p title='{{brand.register | "x--"}}'>x</p>`,
			),
		);
		const before = commentCount(html);
		const sent = await sentHtml(html, value);
		expect(findUnsafe(sent)).toStrictEqual([]);
		expect(commentCount(sent)).toBe(before);
	});
});

describe('placeholders outside text', () => {
	it.each([
		[
			'a fallback in a style attribute (P9)',
			`<p style='background:{{brand.primaryColor | "url(http://evil.example/x.png)"}}'>x</p>`,
			'fallbackNotAllowed',
		],
		[
			'a fallback with behavior (P9)',
			`<p style='color:{{brand.primaryColor | "red;behavior:url(x.htc)"}}'>x</p>`,
			'fallbackNotAllowed',
		],
		[
			'a fallback in a style sheet',
			'<style>p{color:{{brand.primaryColor | "red"}}}</style>',
			'fallbackNotAllowed',
		],
		[
			'a fallback of an address (P8a)',
			`<img src='{{brand.footerLogoUrl | "/media/${FOREIGN}.png"}}' alt=''>`,
			'fallbackNotAllowed',
		],
		[
			'an empty fallback of an address',
			`<a href='{{brand.website | ""}}'>x</a>`,
			'fallbackNotAllowed',
		],
		[
			'a suffix after an address (P8c)',
			`<img src='{{brand.footerLogoUrl}}/media/${FOREIGN}.png' alt=''>`,
			'placeholderInAttribute',
		],
		[
			'a javascript suffix (P10a)',
			`<a href='{{brand.website}}javascript:alert(1)'>x</a>`,
			'placeholderInAttribute',
		],
		[
			'a protocol-relative suffix (P10b)',
			`<a href='{{brand.website}}//evil.example/x'>x</a>`,
			'placeholderInAttribute',
		],
		['a prefix before an address', `<a href='x{{brand.website}}'>x</a>`, 'placeholderInAttribute'],
		['a name in a link', `<a href='{{brand.name}}'>x</a>`, 'placeholderInAttribute'],
		[
			'a name in a style attribute',
			`<p style='color:{{brand.name}}'>x</p>`,
			'placeholderInAttribute',
		],
		[
			'an address in a style attribute',
			`<p style='color:{{brand.website}}'>x</p>`,
			'placeholderInAttribute',
		],
		['a colour in a link', `<a href='{{brand.primaryColor}}'>x</a>`, 'placeholderInAttribute'],
	])('refuses %s', (_name, body, kind) => {
		expect(refusalsOf(run(body)).map((refusal) => refusal.kind)).toContain(kind);
	});

	it.each([
		`<a href='{{brand.website}}'>x</a>`,
		`<img src='{{brand.footerLogoUrl}}' alt='{{brand.name | "Logo"}}'>`,
		`<p style='color:{{brand.primaryColor}};font-family:{{brand.fontFamily}}'>x</p>`,
		`<style>p{color:{{brand.primaryColor}};font-family:{{brand.fontFamily}}}</style><p title='{{brand.register | ""}}'>x</p>`,
	])('takes %s', (body) => {
		expect(run(body)).toMatchObject({ ok: true });
	});
});

describe('css that loads something', () => {
	it.each([
		[
			'a custom property with a url (P4)',
			`<p style='--x:url(http://evil.example/a.png);background:var(--x)'>x</p>`,
		],
		['a custom property with a media url (P4)', `<p style='--y:url(/media/${FOREIGN}.png)'>x</p>`],
		['a custom property in a sheet (P4)', '<style>p{--x:url(data:text/html,x)}</style>'],
		['var()', `<p style='background:var(--x)'>x</p>`],
		[
			'a prefixed image-set with a string (P5)',
			`<p style='background-image:-webkit-image-set("http://evil.example/a.png" 1x)'>x</p>`,
		],
		[
			'a string in another function',
			`<p style='background-image:foo("http://evil.example/a.png")'>x</p>`,
		],
		['a prefixed expression', `<p style='width:-ms-expression(alert(1))'>x</p>`],
	])('is removed: %s', (_name, body) => {
		const html = htmlOf(run(body));
		expect(html).not.toMatch(/--[xy]|var\(|evil|image-set|expression/u);
	});

	it('checks an image of the app against the library, with the origin (P6)', () => {
		expect(
			refusalsOf(run(`<p style='background:url(${ORIGIN}/media/${FOREIGN}.png)'>x</p>`)),
		).toStrictEqual([{ kind: 'mediaForeign', mediaId: FOREIGN }]);
		expect(
			refusalsOf(run(`<style>p{background:url(/media/${FOREIGN}.png)}</style>`)),
		).toStrictEqual([{ kind: 'mediaForeign', mediaId: FOREIGN }]);
	});

	it('takes an image of the area, written relative, and collects it', () => {
		const result = run(`<p style='background:url(${ORIGIN}/media/${OWN}.png)'>x</p>`);
		expect(result).toMatchObject({ mediaIds: [OWN], ok: true });
		expect(htmlOf(result)).toContain(`url(/media/${OWN}.png)`);
	});
});

describe('hostile structure', () => {
	it.each([
		['elements', `${'<div>'.repeat(5000)}x`],
		['tables', `${'<table><tr><td>'.repeat(3000)}x`],
		[
			'media queries',
			`<style>${'@media all{'.repeat(5000)}p{color:red}${'}'.repeat(5000)}</style>`,
		],
	])('is refused as too deep: %s', (_name, body) => {
		expect(refusalsOf(run(body))).toStrictEqual([{ kind: 'tooDeep' }]);
	});
});

const URL_PROPERTIES: ReadonlySet<string> = new Set([
	'action',
	'background',
	'cite',
	'formAction',
	'href',
	'longDesc',
	'lowsrc',
	'poster',
	'src',
	'srcSet',
	'xLinkHref',
]);

/**
 * The attributes of a schema that can hold a URL, as `element:property`.
 *
 * @param attributes The attributes of a schema, by element.
 * @returns The entries, sorted.
 */
function urlAttributesOf(
	attributes:
		| Readonly<Record<string, readonly (string | readonly unknown[])[] | null | undefined>>
		| null
		| undefined,
): string[] {
	return Object.entries(attributes ?? {})
		.flatMap(([element, names]) => (names ?? []).map((name) => [element, String(name)] as const))
		.filter(([, name]) => URL_PROPERTIES.has(name))
		.map(([element, name]) => `${element}:${name}`)
		.toSorted();
}

describe('attributes that hold a URL', () => {
	const LEAK = 'https://leak.example/a.png';

	it.each([
		'srcset',
		'background',
		'poster',
		'xlink:href',
		'formaction',
		'action',
		'lowsrc',
		'dynsrc',
	])('drops %s', (attribute) => {
		const body = `<img ${attribute}="${LEAK}" src="https://c.example/x.png" alt=""><table ${attribute}="${LEAK}"><tr><td ${attribute}="${LEAK}">x</td></tr></table><a ${attribute}="${LEAK}" href="https://c.example/">y</a><video ${attribute}="${LEAK}"></video><form ${attribute}="${LEAK}"></form>`;
		expect(htmlOf(run(body))).not.toContain('leak.example');
	});

	it('are only href of a link and src of an image in the schema', () => {
		expect(urlAttributesOf(SCHEMA.attributes)).toStrictEqual(['a:href', 'img:src']);
	});
});

describe('the schema of the sanitizer', () => {
	it('takes only the schemes of a mail', () => {
		expect(SCHEMA.protocols).toStrictEqual({
			href: ['http', 'https', 'mailto', 'tel'],
			src: ['http', 'https'],
		});
	});

	it.each([
		'<a href="javascript:alert(1)">x</a>',
		'<a href="vbscript:x">x</a>',
		'<a href="data:text/html,x">x</a>',
		'<img src="data:image/png;base64,AAAA">',
		'<img src="javascript:alert(1)">',
	])('drops %s on its own, without our cleaning pass', (html) => {
		const tree = sanitize(fromHtml(html, { fragment: true }), SCHEMA);
		expect(toHtml(tree)).not.toMatch(/href=|src=/u);
	});
});
