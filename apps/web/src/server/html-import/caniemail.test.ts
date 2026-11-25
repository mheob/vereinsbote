import { describe, expect, it } from 'vite-plus/test';

import { extractOutlookCss } from './caniemail';
import outlook from './caniemail-outlook.json';

/**
 * A feature of the caniemail data.
 *
 * @param title The title of the feature.
 * @param status The newest result for Outlook on Windows.
 * @param category The category.
 * @returns The feature.
 */
function feature(title: string, status: string, category = 'css'): unknown {
	return {
		category,
		stats: { outlook: { macos: { '16': 'y' }, windows: { '2013': 'y', '2019': status } } },
		title,
	};
}

describe(extractOutlookCss, () => {
	it('reads properties, property values and functions of the CSS Outlook does not support', () => {
		const data = {
			data: [
				feature('float', 'n'),
				feature('min-width property', 'n #1'),
				feature('display:flex', 'n'),
				feature('flex-wrap: wrap', 'n'),
				feature('display:grid', 'n'),
				feature('gap, column-gap, row-gap', 'n'),
				feature('clamp()', 'n'),
				feature('lch(), oklch()', 'n'),
				feature('padding', 'y'),
				feature('::before', 'n'),
				feature('@media', 'n'),
				feature('Adjacent sibling combinator', 'n'),
				feature('table', 'n', 'html'),
			],
			last_update_date: '2026-01-01',
		};
		expect(extractOutlookCss(data)).toStrictEqual({
			functions: ['clamp()', 'lch()', 'oklch()'],
			properties: ['column-gap', 'float', 'gap', 'min-width', 'row-gap'],
			propertyValues: { display: ['flex', 'grid'], 'flex-wrap': ['wrap'] },
		});
	});

	it('uses the newest result', () => {
		const data = { data: [feature('opacity', 'y')], last_update_date: '2026-01-01' };
		expect(extractOutlookCss(data).properties).toStrictEqual([]);
	});

	it('refuses data of another shape', () => {
		expect(() => extractOutlookCss({ data: 'nope' })).toThrow(Error);
	});
});

describe('caniemail-outlook.json', () => {
	it('names its source and license', () => {
		expect(outlook).toMatchObject({
			license: 'MIT',
			licenseUrl: 'https://github.com/hteumeuleu/caniemail/blob/main/LICENSE',
			source: 'https://www.caniemail.com/api/data.json',
		});
	});

	it('lists what the import reports', () => {
		expect(outlook.properties).toContain('float');
		expect(outlook.propertyValues.display).toContain('flex');
		expect(outlook.functions).toContain('linear-gradient()');
	});
});
