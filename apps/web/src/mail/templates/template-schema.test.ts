import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';

import { templateInputSchema } from './template-schema';
import type { TemplateInput } from './template-schema';

const LAYOUT_ID = '11111111-1111-4111-8111-111111111111';

const VALID: TemplateInput = {
	body: {
		blocks: [
			{ content: [{ text: 'Sommerfest', type: 'text' }], id: 'h', level: 1, type: 'heading' },
		],
		kind: 'blocks',
		layout: { kind: 'standard' },
	},
	name: 'Sommerfest',
	preheader: '',
	salutationForm: 'sie',
	salutationTexts: DEFAULT_SALUTATIONS.sie,
	subject: 'Einladung',
};

const parses = (value: unknown): boolean => templateInputSchema.safeParse(value).success;

describe('the template input schema', () => {
	it('accepts blocks in every kind of layout and an HTML template', () => {
		expect(parses(VALID)).toBe(true);
		for (const layout of [
			{ kind: 'shared', layoutId: LAYOUT_ID },
			{ html: '<div>{{content}}</div>', kind: 'own' },
		]) {
			expect(parses({ ...VALID, body: { ...VALID.body, layout } })).toBe(true);
		}
		expect(parses({ ...VALID, body: { html: '<p>Hallo</p>', kind: 'html' } })).toBe(true);
	});

	it.each([
		['an unknown field', { ...VALID, owner: 'x' }],
		['an unknown salutation form', { ...VALID, salutationForm: 'ihr' }],
		[
			'a missing salutation case',
			{ ...VALID, salutationTexts: { ...DEFAULT_SALUTATIONS.sie, noName: undefined } },
		],
		[
			'a layout id that is no UUID',
			{ ...VALID, body: { ...VALID.body, layout: { kind: 'shared', layoutId: 'x' } } },
		],
		['an unknown body', { ...VALID, body: { kind: 'markdown', text: '# Hallo' } }],
		[
			'an invalid block',
			{ ...VALID, body: { ...VALID.body, blocks: [{ id: 'x', type: 'video' }] } },
		],
	])('refuses %s', (_name, value) => {
		expect(parses(value)).toBe(false);
	});
});
