import { describe, expect, it } from 'vite-plus/test';

import { cleanHeaderText, escapeHtml, stripMarkers } from './escape';

describe(escapeHtml, () => {
	it('escapes the five HTML characters, backslashes stay', () => {
		expect(escapeHtml(String.raw`Anna <b>&"'\ `.trim())).toBe(
			String.raw`Anna &lt;b&gt;&amp;&quot;&#39;\ `.trim(),
		);
	});

	it('does not escape twice', () => {
		expect(escapeHtml('&amp;')).toBe('&amp;amp;');
	});
});

describe(cleanHeaderText, () => {
	it('turns line breaks in header text into spaces', () => {
		expect(cleanHeaderText('A\r\nBcc: x')).toBe('A Bcc: x');
		expect(cleanHeaderText('A\nB\rC')).toBe('A B C');
	});

	it('removes control characters and trims', () => {
		expect(cleanHeaderText('  Hallo\u0000\u0007 Welt\u007F ')).toBe('Hallo Welt');
	});

	it('keeps umlauts and emoji', () => {
		expect(cleanHeaderText('Grüße 🎉')).toBe('Grüße 🎉');
	});
});

describe(stripMarkers, () => {
	it('removes the two private-use marker characters', () => {
		expect(stripMarkers('a 0b')).toBe('a 0b');
	});
});
