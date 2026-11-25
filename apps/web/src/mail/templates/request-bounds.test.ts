import { describe, expect, it } from 'vite-plus/test';

import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';

import {
	MAX_REQUEST_HTML,
	MAX_REQUEST_TEXT,
	salutationWithinBounds,
	templateWithinBounds,
} from './request-bounds';
import type { TemplateInput } from './template-schema';

const BASE: TemplateInput = {
	body: { blocks: [], kind: 'blocks', layout: { kind: 'standard' } },
	name: 'Rundbrief',
	preheader: '',
	salutationForm: 'du',
	salutationTexts: DEFAULT_SALUTATIONS.du,
	subject: 'Hallo',
};

describe(templateWithinBounds, () => {
	it('accepts a template within the bounds', () => {
		expect(templateWithinBounds(BASE)).toBe(true);
		expect(
			templateWithinBounds({ ...BASE, body: { html: 'x'.repeat(MAX_REQUEST_HTML), kind: 'html' } }),
		).toBe(true);
	});

	it.each([
		['name', { name: 'x'.repeat(MAX_REQUEST_TEXT + 1) }],
		['subject', { subject: 'x'.repeat(MAX_REQUEST_TEXT + 1) }],
		['preheader', { preheader: 'x'.repeat(MAX_REQUEST_TEXT + 1) }],
		[
			'salutation text',
			{ salutationTexts: { ...DEFAULT_SALUTATIONS.du, other: 'x'.repeat(MAX_REQUEST_TEXT + 1) } },
		],
		['html body', { body: { html: 'x'.repeat(MAX_REQUEST_HTML + 1), kind: 'html' } }],
		[
			'own layout',
			{
				body: {
					blocks: [],
					kind: 'blocks',
					layout: { html: 'x'.repeat(MAX_REQUEST_HTML + 1), kind: 'own' },
				},
			},
		],
	] as const)('refuses a %s above its bound', (_name, patch) => {
		expect(templateWithinBounds({ ...BASE, ...patch })).toBe(false);
	});
});

describe(salutationWithinBounds, () => {
	it('counts every text', () => {
		expect(salutationWithinBounds(DEFAULT_SALUTATIONS.sie)).toBe(true);
		expect(
			salutationWithinBounds({
				...DEFAULT_SALUTATIONS.sie,
				female: 'x'.repeat(MAX_REQUEST_TEXT + 1),
			}),
		).toBe(false);
	});
});
