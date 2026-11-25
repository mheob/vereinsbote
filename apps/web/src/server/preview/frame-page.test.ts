import { describe, expect, it } from 'vite-plus/test';

import { previewFramePage } from './frame-page';

describe(previewFramePage, () => {
	const page = previewFramePage('n1', 'https://verein.example');

	it('has exactly one script, with the nonce of the request', () => {
		expect(page.match(/<script/gu)).toHaveLength(1);
		expect(page).toContain('<script nonce="n1">');
	});

	it('loads nothing from outside and has no inline style or handler', () => {
		expect(page).not.toMatch(/\ssrc=|<link|<style|\son\w+=/u);
	});

	it('accepts messages only from the parent window and the app origin', () => {
		expect(page).toContain('event.source !== window.parent');
		expect(page).toContain('event.origin !== origin');
		expect(page).toContain('var origin = "https://verein.example"');
	});

	it('answers the parent at the app origin only', () => {
		expect(page).toContain('window.parent.postMessage({ type: "vb-preview-ready" }, origin)');
	});

	it('never evaluates strings', () => {
		expect(page).not.toMatch(/eval\(|new Function|setTimeout\(["']/u);
	});

	it('escapes an origin that would close the script', () => {
		const hostile = previewFramePage('n1', 'https://a.example</script><b>');
		expect(hostile.match(/<script/gu)).toHaveLength(1);
		expect(hostile).not.toContain('</script><b>');
	});

	it('has a language and an empty body for the first load', () => {
		expect(page).toMatch(/^<!doctype html>/iu);
		expect(page).toContain('<body></body>');
	});
});
