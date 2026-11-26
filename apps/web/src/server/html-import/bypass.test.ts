import { fromHtml } from 'hast-util-from-html';
import { sanitize } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';
import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_BRAND } from '@/mail/brand/brand-schema';
import { compileMail } from '@/mail/render/compile';
import type { CompiledMail } from '@/mail/render/compile';
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
	'contact.email',
	'contact.firstName',
];
const KIND: ImportKind = {
	allowed: { keys: new Set(KEYS), known: new Set([...KEYS, 'contact.birthDate', 'content']) },
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

/**
 * What an import came to: the refusals, or the cleaned HTML.
 *
 * @param result The result.
 * @returns A text of either.
 */
function outcome(result: ReturnType<typeof importHtml>): string {
	return result.ok ? result.html : JSON.stringify(result.refusals);
}

describe('placeholders that appear after the judgement', () => {
	it.each([
		[
			'a forged token name in a url (B1)',
			`<p>{{contact.email}}</p><p style='background:url(https://evil.example/vbph0x.png)'>x</p>`,
		],
		[
			'a forged token name as CSS (B2)',
			`<p>{{contact.firstName}}</p><p style='font-family:vbph0x'>x</p>`,
		],
		[
			'a forged token name in a comment (B3)',
			`<p title='{{brand.register | "--"}}'>x</p><!--[if mso]><style>.vbph0x>p{color:red}</style><![endif]-->`,
		],
		[
			'a forged token name in a sheet (B4)',
			`<p title='{{brand.register}}'>x</p><style>.vbph0x{color:red}</style>`,
		],
	])('are refused: %s', (_name, body) => {
		expect(refusalsOf(run(body))).not.toStrictEqual([]);
	});

	it.each([
		[
			'a contact value in a CSS string (C1)',
			`<p style='font-family:"\\7b\\7b contact.firstName\\7d\\7d"'>x</p>`,
		],
		[
			'a contact value in a url (C2)',
			`<p style='background:url(https://evil.example/\\7b\\7b contact.email\\7d\\7d.png)'>x</p>`,
		],
		['a forbidden key (C3)', `<p style='font-family:"\\7b\\7b contact.birthDate\\7d\\7d"'>x</p>`],
		[
			'a brand key in a sheet (C4)',
			`<style>p{font-family:"\\7b\\7b brand.register\\7d\\7d"}</style>`,
		],
		[
			'a brand key in a comment (C5)',
			`<!--[if mso]><style>p{font-family:"\\7b\\7b brand.register | \\"--\\"\\7d\\7d"}</style><![endif]-->`,
		],
	])('written as a CSS escape are refused: %s', (_name, body) => {
		expect(refusalsOf(run(body))).toStrictEqual([{ kind: 'placeholderHidden' }]);
	});

	it.each([
		[
			'in a comment (A11)',
			`<!--[if mso]><p>{<script>x</script>{brand.register | "--"}}</p><![endif]-->`,
		],
		['across a removed comment (S1)', '<p>{<!-- x -->{contact.birthDate}}</p>'],
		['across a removed element (S2)', '<p>{<svg></svg>{contact.birthDate | ""}}</p>'],
		['across a removed script (A12)', '<p>{<script>x</script>{contact.birthDate}}</p>'],
	])('joined by a removed node are refused: %s', (_name, body) => {
		expect(refusalsOf(run(body))).toStrictEqual([{ kind: 'placeholderHidden' }]);
	});

	it('still takes real placeholders in CSS, once each', () => {
		const html = `<p style='color:{{brand.primaryColor}}'>a</p><p style='color:{{brand.primaryColor}}'>b</p>`;
		expect(run(html)).toMatchObject({ ok: true });
	});
});

describe('url() written with an escape', () => {
	it.each([
		['http (D1)', `\\75 rl(http://evil.example/a.png)`],
		['a foreign image (D2)', `\\75 rl(/media/${FOREIGN}.png)`],
		['an upper-case data url (D3)', `\\55 RL(data:image/png;base64,AAAA)`],
		['src', `src(http://evil.example/a.png)`],
	])('is removed: %s', (_name, value) => {
		expect(htmlOf(run(`<p style='background:${value}'>x</p>`))).not.toMatch(
			/evil|FFFF|data:|rl\(|src\(/u,
		);
		expect(htmlOf(run(`<style>p{background:${value}}</style>`))).not.toMatch(
			/evil|FFFF|data:|rl\(|src\(/u,
		);
	});
});

describe('addresses of the app', () => {
	it.each([
		`${ORIGIN}/media/${FOREIGN}.png#x`,
		`${ORIGIN}/media/${FOREIGN}.png?x`,
		`https://verein.example.org:443/media/${FOREIGN}.png`,
		`${ORIGIN}/./media/${FOREIGN}.png`,
		`${ORIGIN}//media/${FOREIGN}.png`,
		`${ORIGIN}/%6Dedia/${FOREIGN}.png`,
		`HTTPS://VEREIN.EXAMPLE.ORG/media/${FOREIGN}.png`,
	])('are judged as the library, or dropped: %s', (src) => {
		expect(outcome(run(`<img src="${src}" alt="">`))).not.toMatch(/src='https?:/u);
		expect(outcome(run(`<p style='background:url(${src})'>x</p>`))).not.toMatch(/url\(https?:/u);
	});

	it('takes the library image of the area under such a form', () => {
		expect(run(`<img src="${ORIGIN}/./media/${OWN}.png#x" alt="">`)).toMatchObject({
			mediaIds: [OWN],
			ok: true,
		});
	});
});

describe('token characters written as an entity or an escape', () => {
	const FORGED_INJECTION = `<p foo='{{brand.register | "red;background:url(http://evil.example/x.png);behavior:url(x.htc);width:expression(alert(1))"}}'>a</p>`;

	it.each([
		[
			'an entity in a style attribute',
			`${FORGED_INJECTION}<p style='color:&#xE002;0&#xE003;'>b</p>`,
		],
		[
			'a CSS escape in a style attribute',
			`${FORGED_INJECTION}<p style='font-family:"\\E002 0\\E003 "'>b</p>`,
		],
		[
			'a CSS escape in a sheet',
			`${FORGED_INJECTION}<style>p{font-family:"\\E002 0\\E003 "}</style>`,
		],
		[
			'an entity in a conditional comment',
			`${FORGED_INJECTION}<!--[if mso]><p>&#xE002;0&#xE003;</p><![endif]-->`,
		],
		[
			'an escape in a conditional comment',
			`${FORGED_INJECTION}<!--[if mso]><style>p{font-family:"\\E002 0\\E003 "}</style><![endif]-->`,
		],
		[
			'an entity in a href path',
			`${FORGED_INJECTION}<a href='https://x.example/&#xE002;0&#xE003;'>b</a>`,
		],
		['an entity in text', `${FORGED_INJECTION}<p>&#xE002;0&#xE003;</p>`],
		['a compiler marker as an entity', '<p>&#xE000;0&#xE001;</p>'],
	])('are refused: %s', (_name, body) => {
		expect(refusalsOf(run(body))).toContainEqual({ kind: 'syntax' });
	});
});

describe('a brace in front of a placeholder', () => {
	it.each([
		['across a removed script', '<p>{<script>x</script>{{brand.name}}</p>'],
		['across a removed comment', '<p>{<!-- x -->{{brand.name}}</p>'],
	])('is refused: %s', (_name, body) => {
		expect(refusalsOf(run(body))).toStrictEqual([{ kind: 'placeholderHidden' }]);
	});
});

describe('the host of the app in other forms', () => {
	it.each([
		`http://verein.example.org/media/${FOREIGN}.png`,
		`https://verein.example.org./media/${FOREIGN}.png`,
		`http://VEREIN.example.org./media/${FOREIGN}.png`,
	])('is judged as the library, or dropped: %s', (src) => {
		expect(outcome(run(`<img src="${src}" alt="">`))).not.toMatch(/src='https?:/u);
		expect(outcome(run(`<p style='background:url(${src})'>x</p>`))).not.toMatch(/url\(https?:/u);
	});

	it('takes the library image of the area under such a host', () => {
		expect(run(`<img src="http://verein.example.org./media/${OWN}.png" alt="">`)).toMatchObject({
			mediaIds: [OWN],
			ok: true,
		});
	});

	it('keeps another port and another host external', () => {
		expect(
			run(`<img src="https://verein.example.org:8443/media/${FOREIGN}.png" alt="">`),
		).toMatchObject({ ok: true });
	});
});

/**
 * Compiles an imported mail for an occasion with the unsubscribe link.
 *
 * @param html The cleaned HTML.
 * @returns The compiled mail.
 */
async function compiledWithLink(html: string): Promise<CompiledMail> {
	const compiled = await compileMail(
		{ body: { html, kind: 'html' }, media: new Map(), preheader: '', subject: 'S' },
		DEFAULT_BRAND,
		ORIGIN,
		'de',
		{ unsubscribe: true },
	);
	if (!compiled.ok) throw new Error(JSON.stringify(compiled));
	return compiled.mail;
}

/**
 * Fills a compiled mail with an address for the unsubscribe link and expects success.
 *
 * @param compiled The compiled mail.
 * @param address The address.
 * @returns The HTML of the mail.
 */
function sentWithLink(compiled: Readonly<CompiledMail>, address: string): string {
	const filled = fillMail(compiled, new Map([['unsubscribe.url', address]]));
	if (!filled.ok) throw new Error(JSON.stringify(filled));
	return filled.mail.html;
}

describe('allows {{unsubscribe.url}} only as a whole href without fallback', () => {
	const LINK_KEYS = [...KEYS, 'unsubscribe.url'];
	const WITH_LINK: ImportKind = {
		...KIND,
		allowed: { keys: new Set(LINK_KEYS), known: new Set([...LINK_KEYS, 'content']) },
	};

	/**
	 * Imports a body inside a document of an area that allows the unsubscribe link.
	 *
	 * @param body The body.
	 * @param head The head.
	 * @returns The result.
	 */
	function runWithLink(body: string, head = ''): ReturnType<typeof importHtml> {
		return importHtml(
			`<html lang="de"><head>${head}</head><body>${body}</body></html>`,
			WITH_LINK,
			ORIGIN,
		);
	}

	it.each([
		['with a suffix (U1)', `<a href='{{unsubscribe.url}}/x'>x</a>`, 'placeholderInAttribute'],
		[
			'with a javascript suffix (U2)',
			`<a href='{{unsubscribe.url}}javascript:alert(1)'>x</a>`,
			'placeholderInAttribute',
		],
		[
			'behind a prefix (U3)',
			`<a href='https://evil.example/?u={{unsubscribe.url}}'>x</a>`,
			'placeholderInAttribute',
		],
		[
			'with a fallback (U4)',
			`<a href='{{unsubscribe.url | "https://evil.example/"}}'>x</a>`,
			'fallbackNotAllowed',
		],
		[
			'with an empty fallback (U5)',
			`<a href='{{unsubscribe.url | ""}}'>x</a>`,
			'fallbackNotAllowed',
		],
		['in src (U6)', `<img src='{{unsubscribe.url}}' alt=''>`, 'placeholderInAttribute'],
		[
			'in a style attribute (U7)',
			`<p style='background:url({{unsubscribe.url}})'>x</p>`,
			'placeholderInAttribute',
		],
		[
			'in a style sheet (U8)',
			'<style>p{font-family:{{unsubscribe.url}}}</style>',
			'placeholderInAttribute',
		],
		['in another attribute (U9)', `<p title='{{unsubscribe.url}}'>x</p>`, 'placeholderInAttribute'],
	])('refuses it %s', (_name, body, kind) => {
		expect(refusalsOf(runWithLink(body)).map((refusal) => refusal.kind)).toContain(kind);
	});

	it('refuses it in the title (U10)', () => {
		expect(
			refusalsOf(runWithLink('<p>x</p>', '<title>{{unsubscribe.url}}</title>')),
		).toContainEqual({
			attribute: 'title',
			key: 'unsubscribe.url',
			kind: 'placeholderInAttribute',
		});
	});

	it('refuses it in a conditional comment (U11)', () => {
		expect(
			refusalsOf(runWithLink(`<!--[if mso]><a href='{{unsubscribe.url}}'>x</a><![endif]-->`)),
		).toContainEqual({ key: 'unsubscribe.url', kind: 'placeholderInComment' });
	});

	it('refuses it where the area does not allow it (U12)', () => {
		expect(refusalsOf(run(`<a href='{{unsubscribe.url}}'>x</a>`))).not.toStrictEqual([]);
	});

	it('takes it as the whole href of a link', () => {
		expect(htmlOf(runWithLink(`<a href=' {{unsubscribe.url}} '>Abmelden</a>`))).toContain(
			`<a href='{{unsubscribe.url}}'>Abmelden</a>`,
		);
	});

	it('refuses a value that is no web address when the mail is filled (U13)', async () => {
		const compiled = await compiledWithLink(
			htmlOf(runWithLink(`<p><a href='{{unsubscribe.url}}'>Abmelden</a></p>`)),
		);
		// oxlint-disable-next-line no-script-url -- the scheme the link must refuse
		expect(fillMail(compiled, new Map([['unsubscribe.url', 'javascript:alert(1)']]))).toStrictEqual(
			{ missing: ['unsubscribe.url'], ok: false },
		);
	});

	it.each([
		`https://x.example/'><img src=x onerror=alert(1)>`,
		`https://x.example/"><script>alert(1)</script>`,
	])('keeps the value %j inside its attribute in the sent mail (U14)', async (value) => {
		const compiled = await compiledWithLink(
			htmlOf(runWithLink(`<p><a href='{{unsubscribe.url}}'>Abmelden</a></p>`)),
		);
		const html = sentWithLink(compiled, value);
		expect(findUnsafe(html)).toStrictEqual([]);
		expect(html).not.toMatch(/<script|<img/u);
		expect(html.split('<a ')).toHaveLength(2);
	});
});
