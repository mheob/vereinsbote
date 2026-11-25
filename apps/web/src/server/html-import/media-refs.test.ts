import { describe, expect, it } from 'vite-plus/test';

import { compareCodePoints } from '@/server/compare-code-points';

import { importHtml } from './import-html';
import type { ImportKind, ImportResult } from './import-html';
import { htmlMediaIds, swapHtmlMediaIds } from './media-refs';
import { findingsOf, htmlOf } from './testing';

const AREA_IMAGE = 'AAAAAAAAAAAAAAAAAAAAAA';
const OTHER_IMAGE = 'BBBBBBBBBBBBBBBBBBBBBB';
const BRAND_IMAGE = 'CCCCCCCCCCCCCCCCCCCCCC';
const ORIGIN = 'https://verein.example.org';
const TEMPLATE: ImportKind = {
	allowed: { keys: new Set(), known: new Set() },
	areaMediaIds: new Set([AREA_IMAGE]),
	kind: 'template',
};

/**
 * Imports a body.
 *
 * @param body The body.
 * @param kind What is imported.
 * @returns The result.
 */
function run(body: string, kind: ImportKind = TEMPLATE): ImportResult {
	return importHtml(`<html lang="de"><head></head><body>${body}</body></html>`, kind, ORIGIN);
}

describe('images of the app', () => {
	it('of the area are collected and written as a relative path', () => {
		const result = run(
			`<img src="/media/${AREA_IMAGE}.png" alt="a"><img src="${ORIGIN}/media/${AREA_IMAGE}.png" alt="b">`,
		);
		expect(result).toMatchObject({ mediaIds: [AREA_IMAGE], ok: true });
		const html = htmlOf(result);
		expect(html.match(new RegExp(`src='/media/${AREA_IMAGE}\\.png'`, 'gu'))).toHaveLength(2);
		expect(html).not.toContain(ORIGIN);
	});

	it('with a query or a fragment are written as the canonical path', () => {
		const html = htmlOf(
			run(
				`<img src="/media/${AREA_IMAGE}.png?x=1" alt=""><img src="/media/${AREA_IMAGE}.png#y" alt="">`,
			),
		);
		expect(html.match(new RegExp(`src='/media/${AREA_IMAGE}\\.png'`, 'gu'))).toHaveLength(2);
	});

	it('in an Outlook conditional comment count as well', () => {
		const result = run(
			`<!--[if mso]><img src="/media/${AREA_IMAGE}.png" alt=""><![endif]--><p>x</p>`,
		);
		expect(result).toMatchObject({ mediaIds: [AREA_IMAGE], ok: true });
	});

	it('of another area are refused, once each and sorted', () => {
		const result = run(
			`<img src="/media/${OTHER_IMAGE}.png" alt=""><img src="/media/${BRAND_IMAGE}.jpg" alt=""><img src="/media/${OTHER_IMAGE}.png" alt="">`,
		);
		expect(result).toStrictEqual({
			ok: false,
			refusals: [OTHER_IMAGE, BRAND_IMAGE]
				.toSorted(compareCodePoints)
				.map((mediaId) => ({ kind: 'mediaForeign', mediaId })),
		});
	});

	it('of a global layout are the brand library', () => {
		const kind: ImportKind = {
			allowed: { keys: new Set(['content']), known: new Set(['content']) },
			brandMediaIds: new Set([BRAND_IMAGE]),
			kind: 'globalLayout',
		};
		const ok = run(`<img src="/media/${BRAND_IMAGE}.jpg" alt=""><p>{{content}}</p>`, kind);
		expect(ok).toMatchObject({ mediaIds: [BRAND_IMAGE], ok: true });
		const foreign = run(`<img src="/media/${AREA_IMAGE}.png" alt=""><p>{{content}}</p>`, kind);
		expect(foreign).toMatchObject({ ok: false });
	});

	it.each([
		['a name that is no image id', '/media/logo.png'],
		['a path below media', `/media/x/${AREA_IMAGE}.png`],
		['a protocol-relative address', `//evil.example/media/${AREA_IMAGE}.png`],
	])('are dropped for %s', (_name, src) => {
		const result = run(`<img src="${src}" alt="">`);
		expect(htmlOf(result)).not.toContain('src=');
	});
});

describe('other images', () => {
	it('from a host that only starts like ours are external', () => {
		const result = run(
			`<img src="https://verein.example.org.evil.example/media/${AREA_IMAGE}.png" alt="">`,
		);
		expect(result).toMatchObject({ mediaIds: [], ok: true });
		expect(findingsOf(result)).toContainEqual({
			host: 'verein.example.org.evil.example',
			kind: 'externalImage',
		});
	});

	it('from https hosts stay and are reported once per host', () => {
		const result = run(
			'<img src="https://cdn.example/a.png" alt=""><img src="https://cdn.example/b.png" alt=""><img src="http://other.example/c.png" alt="">',
		);
		expect(result).toMatchObject({ ok: true });
		const findings = findingsOf(result);
		expect(findings.filter(({ kind }) => kind === 'externalImage')).toStrictEqual([
			{ host: 'cdn.example', kind: 'externalImage' },
			{ host: 'other.example', kind: 'externalImage' },
		]);
	});

	it.each([
		'data:image/png;base64,AAAA',
		'ftp://x.example/a.png',
		'file:///etc/passwd',
		'blob:https://x.example/1',
	])('with %s are dropped', (src) => {
		const result = run(`<img src="${src}" alt="">`);
		expect(htmlOf(result)).not.toContain('src=');
		expect(findingsOf(result)).toContainEqual({
			count: 1,
			kind: 'removed',
			what: 'unsafeUrl',
		});
	});
});

describe('links', () => {
	it.each([
		'https://example.org/a',
		'http://example.org/a',
		'mailto:a@example.org',
		'tel:+4930123',
		'#top',
	])('to %s stay', (href) => {
		const result = run(`<a href="${href}">x</a>`);
		expect(htmlOf(result)).toContain(`href='${href}'`);
	});

	it.each([
		'/relative/path',
		'relative',
		'//evil.example',
		'ftp://x.example',
		'sms:123',
		`/media/${AREA_IMAGE}.png`,
	])('to %s are dropped', (href) => {
		const result = run(`<a href="${href}">x</a>`);
		expect(htmlOf(result)).not.toContain('href=');
	});
});

describe('htmlMediaIds and swapHtmlMediaIds', () => {
	const html = `<p><img src='/media/${AREA_IMAGE}.png' alt=''><img src='/media/${OTHER_IMAGE}.jpg' alt=''>src='/media/${BRAND_IMAGE}.png'</p>`;

	it('read the images the img elements show, not text that looks like one', () => {
		expect(htmlMediaIds(html).toSorted()).toStrictEqual([AREA_IMAGE, OTHER_IMAGE]);
	});

	it('read the images in a conditional comment and an address with white space', () => {
		const ids = htmlMediaIds(
			`<!--[if mso]><img src='/media/${AREA_IMAGE}.png'><![endif]--><img src=' /media/${OTHER_IMAGE}.jpg'><!-- <img src='/media/${BRAND_IMAGE}.png'> -->`,
		);
		expect(ids.toSorted()).toStrictEqual([AREA_IMAGE, OTHER_IMAGE]);
	});

	it('exchange images by their copies', () => {
		const swapped = swapHtmlMediaIds(html, new Map([[AREA_IMAGE, 'DDDDDDDDDDDDDDDDDDDDDD']]));
		expect(swapped).toContain('/media/DDDDDDDDDDDDDDDDDDDDDD.png');
		expect(swapped).not.toContain(`/media/${AREA_IMAGE}.png`);
		expect(swapped).toContain(`/media/${OTHER_IMAGE}.jpg`);
	});
});
