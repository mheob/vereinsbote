import { describe, expect, it, vi } from 'vite-plus/test';

import { DEFAULT_BRAND } from '@/mail/brand/brand-schema';
import type { Brand } from '@/mail/brand/brand-schema';
import type { BrandState } from '@/server/brand/brand';

import { composeSystemMail } from './system-mail';
import type { SystemMailContent } from './system-mail';

const ORIGIN = 'https://bote.example.org';
const LINK = 'https://bote.example.org/api/auth/magic-link/verify?token=abc123&callbackURL=%2F';
const ESCAPED_LINK = LINK.replaceAll('&', '&amp;');
const BRAND: BrandState = {
	brand: {
		...DEFAULT_BRAND,
		footer: {
			...DEFAULT_BRAND.footer,
			imprintUrl: 'https://verein.example/impressum',
			privacyUrl: 'https://verein.example/datenschutz',
		},
		name: 'TSV Beispielstadt',
	},
	configured: true,
	version: 1,
};
/** The brand without its required name, which the brand schema refuses. */
const NAMELESS: BrandState = { ...BRAND, brand: { ...BRAND.brand, name: ' ' } };
const CONTENT: SystemMailContent = {
	button: { label: 'Sign in', url: LINK },
	heading: 'Your sign-in link',
	paragraphs: ['Hello,', 'The link is valid for 15 minutes\nand works once.'],
};
const PLAIN_TEXT = [
	'Your sign-in link',
	'Hello,',
	'The link is valid for 15 minutes\nand works once.',
	`Sign in:\n${LINK}`,
].join('\n\n');

/**
 * The fragments a text lacks.
 *
 * @param text The text.
 * @param fragments What it should contain.
 * @returns The fragments it does not contain.
 */
function missingIn(text: string, fragments: readonly string[]): string[] {
	return fragments.filter((fragment) => !text.includes(fragment));
}

/**
 * The fragments a text contains.
 *
 * @param text The text.
 * @param fragments What it must not contain.
 * @returns The fragments it contains.
 */
function foundIn(text: string, fragments: readonly string[]): string[] {
	return fragments.filter((fragment) => text.includes(fragment));
}

describe(composeSystemMail, () => {
	it('renders a system mail in the brand layout in the given language', async () => {
		const mail = await composeSystemMail(
			CONTENT,
			'Your sign-in link for Vereinsbote',
			BRAND,
			ORIGIN,
			'en',
		);
		expect(mail.layout).toBe('brand');
		expect(
			missingIn(mail.html, [
				'lang="en"',
				'<title>Your sign-in link for Vereinsbote</title>',
				'TSV Beispielstadt',
				'Legal notice',
				'Privacy policy',
				'Your sign-in link</h1>',
				`href="${ESCAPED_LINK}"`,
			]),
		).toStrictEqual([]);
		expect(foundIn(mail.html, ['Impressum', 'Datenschutz'])).toStrictEqual([]);
		expect(
			missingIn(mail.text, ['Your sign-in link', 'The link is valid for 15 minutes', LINK]),
		).toStrictEqual([]);
	});

	it('renders the fixed texts of the layout in German', async () => {
		const mail = await composeSystemMail(CONTENT, 'Betreff', BRAND, ORIGIN, 'de');
		expect(mail.layout).toBe('brand');
		expect(missingIn(mail.html, ['lang="de"', 'Impressum', 'Datenschutz'])).toStrictEqual([]);
	});

	it('falls back to the plain mail when a required brand value is missing', async () => {
		const mail = await composeSystemMail(CONTENT, 'Betreff', NAMELESS, ORIGIN, 'de');
		expect(mail).toMatchObject({ layout: 'plain', text: PLAIN_TEXT });
		expect(
			missingIn(mail.html, [
				'<html lang="de">',
				'<title>Betreff</title>',
				'<h1>Your sign-in link</h1>',
				'<p>The link is valid for 15 minutes<br>and works once.</p>',
				`<p><a href="${ESCAPED_LINK}">Sign in</a></p>`,
			]),
		).toStrictEqual([]);
		expect(mail.html).not.toContain('TSV Beispielstadt');
	});

	it('falls back to the plain mail for a link the blocks do not allow', async () => {
		// A local APP_URL in development: the blocks allow https links only.
		const local = { ...CONTENT, button: { label: 'Sign in', url: 'http://localhost:3000/login' } };
		const mail = await composeSystemMail(local, 'Betreff', BRAND, 'http://localhost:3000', 'de');
		expect(mail.layout).toBe('plain');
		expect(mail.text).toContain('Sign in:\nhttp://localhost:3000/login');
		expect(mail.html).toContain('<a href="http://localhost:3000/login">Sign in</a>');
	});

	it('falls back to the plain mail when rendering throws', async () => {
		const warned = vi.spyOn(console, 'warn').mockReturnValue();
		const unreadable: BrandState = {
			get brand(): Brand {
				throw new Error('The brand cannot be read.');
			},
			configured: true,
			version: 1,
		};
		const mail = await composeSystemMail(CONTENT, 'Betreff', unreadable, ORIGIN, 'de');
		expect(mail).toMatchObject({ layout: 'plain', text: PLAIN_TEXT });
		expect(warned).toHaveBeenCalledWith('system mail without the brand layout', 'Error');
		warned.mockRestore();
	});

	it('escapes the link and the texts', async () => {
		const hostile: SystemMailContent = {
			button: { label: '<b>Go</b>', url: 'https://bote.example.org/x?a="1"&b=<2>' },
			heading: '<script>alert(1)</script>',
			paragraphs: ['Tom & "Jerry" <img src=x>', '{{contact.email}}'],
		};
		const subject = '<Betreff> & {{brand.name}}';
		const brand = await composeSystemMail(hostile, subject, BRAND, ORIGIN, 'de');
		const plain = await composeSystemMail(hostile, subject, NAMELESS, ORIGIN, 'de');
		expect([brand.layout, plain.layout]).toStrictEqual(['brand', 'plain']);
		const forbidden = ['<script>', '<img', '<b>', '<Betreff>'];
		expect([...foundIn(brand.html, forbidden), ...foundIn(plain.html, forbidden)]).toStrictEqual(
			[],
		);
		// A value is never read for placeholders: neither the subject nor a text.
		const escaped = [
			'&lt;script&gt;alert(1)&lt;/script&gt;',
			'Tom &amp; ',
			'&lt;b&gt;Go&lt;/b&gt;',
			'<title>&lt;Betreff&gt; &amp; {{brand.name}}</title>',
			'{{contact.email}}',
		];
		expect([...missingIn(brand.html, escaped), ...missingIn(plain.html, escaped)]).toStrictEqual(
			[],
		);
		expect(plain.html).toContain(
			'<a href="https://bote.example.org/x?a=&quot;1&quot;&amp;b=&lt;2&gt;">',
		);
	});

	it('does not link an address that is no web address in the plain mail', async () => {
		const ftp = { ...CONTENT, button: { label: 'List', url: 'ftp://files.example.org/list.csv' } };
		const mail = await composeSystemMail(ftp, 'Betreff', BRAND, ORIGIN, 'de');
		expect(mail.layout).toBe('plain');
		expect(mail.html).not.toContain('<a ');
		expect(mail.html).toContain('<p>List: ftp://files.example.org/list.csv</p>');
	});
});
