import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import type { TemplateInput } from '@/mail/templates/template-schema';

import { mailLayoutOf, previewSource, sampleValues } from './preview-source';

const LAYOUT_ID = '00000000-0000-4000-8000-000000000001';
const LAYOUTS = [{ html: '<div>{{content}}</div>', id: LAYOUT_ID }];

const input: TemplateInput = {
	body: { blocks: [{ id: 'd', type: 'divider' }], kind: 'blocks', layout: { kind: 'standard' } },
	name: 'Sommerfest',
	preheader: 'Am Samstag',
	salutationForm: 'du',
	salutationTexts: DEFAULT_SALUTATIONS.du,
	subject: 'Einladung',
};

describe(mailLayoutOf, () => {
	it('gives the standard layout, a global layout or an own layout', () => {
		expect(mailLayoutOf({ kind: 'standard' }, LAYOUTS)).toStrictEqual({ kind: 'standard' });
		expect(mailLayoutOf({ kind: 'shared', layoutId: LAYOUT_ID }, LAYOUTS)).toStrictEqual({
			html: '<div>{{content}}</div>',
			kind: 'html',
		});
		expect(mailLayoutOf({ html: '<p>{{content}}</p>', kind: 'own' }, LAYOUTS)).toStrictEqual({
			html: '<p>{{content}}</p>',
			kind: 'html',
		});
	});

	it('falls back to the standard layout when the global layout is gone', () => {
		expect(mailLayoutOf({ kind: 'shared', layoutId: LAYOUT_ID }, [])).toStrictEqual({
			kind: 'standard',
		});
	});
});

describe(previewSource, () => {
	it('takes subject, preview text, blocks and images of the template', () => {
		const media = new Map([
			['AAAAAAAAAAAAAAAAAAAAAA', { height: 1, type: 'png', width: 1 } as const],
		]);
		expect(previewSource(input, LAYOUTS, media)).toStrictEqual({
			body: {
				blocks: [{ id: 'd', type: 'divider' }],
				kind: 'blocks',
				layout: { kind: 'standard' },
			},
			media,
			preheader: 'Am Samstag',
			subject: 'Einladung',
		});
	});

	it('passes the HTML of an imported template on', () => {
		const html = { ...input, body: { html: '<p>Hallo</p>', kind: 'html' } } as const;
		expect(previewSource(html, LAYOUTS, new Map()).body).toStrictEqual({
			html: '<p>Hallo</p>',
			kind: 'html',
		});
	});
});

describe(sampleValues, () => {
	it('greets the sample member with the salutation of the template', () => {
		expect(sampleValues(DEFAULT_SALUTATIONS.du).get('salutation')).toBe('Liebe Anna');
		expect(sampleValues(DEFAULT_SALUTATIONS.sie).get('salutation')).toBe(
			'Sehr geehrte Frau Beispiel',
		);
		expect(sampleValues(DEFAULT_SALUTATIONS.du).get('contact.birthDate')).toBe('17.05.1985');
	});
});
