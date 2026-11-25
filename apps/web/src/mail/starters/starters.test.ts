import { describe, expect, it } from 'vite-plus/test';

import { collectMediaIds, collectPlaceholderRefs } from '@/mail/blocks/block-schema';
import type { Block } from '@/mail/blocks/block-schema';
import { BUILTIN_PLACEHOLDERS } from '@/mail/placeholders/registry';
import { templateInputSchema } from '@/mail/templates/template-schema';
import type { TemplateBody, TemplateInput } from '@/mail/templates/template-schema';
import { templatePlaceholders } from '@/server/templates/allowed-placeholders';
import { checkTemplateForSave } from '@/server/templates/testing';

import { emptyTemplate, STARTER_IDS, starterTemplate } from './starters';
import type { StarterId } from './starters';

/** What every area allows: base fields, brand values and the salutation, no protected field. */
const ANY_AREA = templatePlaceholders({ member: new Set(), partner: new Set() }, []);
/** The keys a starter may use: the salutation, brand values and base fields of contacts. */
const STARTER_KEYS: ReadonlySet<string> = new Set(
	BUILTIN_PLACEHOLDERS.filter(({ base, group }) => base && group !== 'layout').map(
		({ key }) => key,
	),
);

/**
 * A starter as a template with its default name and subject.
 *
 * @param id The starter.
 * @returns The template input.
 */
function asTemplate(id: StarterId): TemplateInput {
	const { defaultName, defaultSubject, ...rest } = starterTemplate(id);
	return { ...rest, name: defaultName, subject: defaultSubject };
}

/**
 * The blocks of a body.
 *
 * @param body The body.
 * @returns Its blocks; none for HTML.
 */
function blocksOf(body: TemplateBody): readonly Block[] {
	return body.kind === 'blocks' ? body.blocks : [];
}

describe(starterTemplate, () => {
	it.each(STARTER_IDS)('makes %s pass the save checks in every area', (id) => {
		const input = asTemplate(id);
		expect(templateInputSchema.safeParse(input).success).toBe(true);
		expect(checkTemplateForSave(input, ANY_AREA, new Set())).toStrictEqual([]);
	});

	it.each(STARTER_IDS)('uses base fields, brand values and the salutation only in %s', (id) => {
		const blocks = blocksOf(starterTemplate(id).body);
		const keys = collectPlaceholderRefs(blocks).map(({ key }) => key);
		expect(keys.filter((key) => !STARTER_KEYS.has(key))).toStrictEqual([]);
		expect(collectMediaIds(blocks)).toStrictEqual([]);
	});

	it('builds the invitation of the design: heading, salutation, text, spacer and greeting', () => {
		const starter = starterTemplate('invitation');
		const blocks = blocksOf(starter.body);
		expect(starter).toMatchObject({
			body: { kind: 'blocks', layout: { kind: 'standard' } },
			defaultName: 'Einladung',
			defaultSubject: 'Einladung zu [Veranstaltung]',
			preheader: '',
			salutationForm: 'du',
		});
		expect(blocks.map(({ type }) => type)).toStrictEqual([
			'heading',
			'placeholderLine',
			'text',
			'spacer',
			'text',
		]);
		expect(blocks[1]).toMatchObject({ ref: { fallback: null, key: 'salutation' }, suffix: ',' });
		expect(collectPlaceholderRefs(blocks).map(({ key }) => key)).toStrictEqual([
			'salutation',
			'brand.name',
		]);
	});

	it('gives every caller its own copy', () => {
		expect(starterTemplate('invitation')).not.toBe(starterTemplate('invitation'));
		expect(starterTemplate('invitation')).toStrictEqual(starterTemplate('invitation'));
	});
});

describe(emptyTemplate, () => {
	it('has no blocks, uses the standard layout and passes the save checks', () => {
		const empty = emptyTemplate({ name: 'Rundbrief', subject: 'Neues vom Verein' });
		expect(empty).toMatchObject({
			body: { blocks: [], kind: 'blocks', layout: { kind: 'standard' } },
			name: 'Rundbrief',
			preheader: '',
			salutationForm: 'du',
			subject: 'Neues vom Verein',
		});
		expect(templateInputSchema.safeParse(empty).success).toBe(true);
		expect(checkTemplateForSave(empty, ANY_AREA, new Set())).toStrictEqual([]);
	});

	it('gives every call its own salutation texts', () => {
		const names = { name: 'A', subject: 'B' };
		expect(emptyTemplate(names).salutationTexts).not.toBe(emptyTemplate(names).salutationTexts);
	});
});
