import { describe, expect, it } from 'vite-plus/test';

import { SAMPLE_BLOCKS } from '@/mail/sample';

import { layoutPreviewSource } from './layout-preview';

describe(layoutPreviewSource, () => {
	it('puts the sample blocks into the HTML of the layout', () => {
		const source = layoutPreviewSource('<div>{{content}}</div>', 'Vorschau');
		expect(source.subject).toBe('Vorschau');
		expect(source.preheader).toBe('');
		expect(source.body).toStrictEqual({
			blocks: SAMPLE_BLOCKS,
			kind: 'blocks',
			layout: { html: '<div>{{content}}</div>', kind: 'html' },
		});
		expect(source.media.size).toBe(0);
	});
});
