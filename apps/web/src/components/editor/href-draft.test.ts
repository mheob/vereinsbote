import { describe, expect, it } from 'vite-plus/test';

import { hrefDraft } from './href-draft';

describe(hrefDraft, () => {
	it('gives an allowed address, trimmed', () => {
		expect(hrefDraft(' https://example.org/anmelden ')).toStrictEqual({
			href: 'https://example.org/anmelden',
			invalid: false,
		});
		expect(hrefDraft('mailto:vorstand@example.org')).toStrictEqual({
			href: 'mailto:vorstand@example.org',
			invalid: false,
		});
	});

	it('gives no address and no error for an empty field', () => {
		expect(hrefDraft('')).toStrictEqual({ href: '', invalid: false });
		expect(hrefDraft('   ')).toStrictEqual({ href: '', invalid: false });
	});

	it.each(['http://example.org', 'data:text/html,x', 'example.org', 'https:'])(
		'clears the address and is invalid at once for %s',
		(text) => {
			expect(hrefDraft(text)).toStrictEqual({ href: '', invalid: true });
		},
	);
});
