import { describe, expect, it } from 'vite-plus/test';

import { MAX_TEMPLATE_JSON_BYTES } from '@/mail/blocks/block-schema';
import type {
	Block,
	ButtonBlock,
	HeadingBlock,
	ImageBlock,
	TextBlock,
} from '@/mail/blocks/block-schema';
import type { InlineNode } from '@/mail/blocks/text-doc';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import type { TemplateBody, TemplateInput } from '@/mail/templates/template-schema';

import { templatePlaceholders } from './allowed-placeholders';
import type { AllowedPlaceholders } from './allowed-placeholders';
import {
	blockWhere,
	checkTemplateForSave,
	MAX_TEMPLATE_NAME_LENGTH,
	MAX_TEMPLATE_PREHEADER_LENGTH,
	MAX_TEMPLATE_SUBJECT_LENGTH,
} from './save-checks';
import type { SaveProblem } from './save-checks';

const OWN_IMAGE = 'a'.repeat(22);
const FOREIGN_IMAGE = 'b'.repeat(22);
const AREA_IMAGES: ReadonlySet<string> = new Set([OWN_IMAGE]);
const NOTE_FIELD = '11111111-1111-4111-8111-111111111111';
const SIZE_FIELD = '22222222-2222-4222-8222-222222222222';

const CUSTOM_FIELDS = [
	{
		id: NOTE_FIELD,
		kind: 'member',
		name: 'Notiz',
		placeholderKey: 'notiz',
		protection: 'protected',
		type: 'text',
	},
	{
		id: SIZE_FIELD,
		kind: 'partner',
		name: 'Trikotgröße',
		placeholderKey: 'trikotgroesse',
		protection: 'base',
		type: 'text',
	},
] as const;

/** An area like "Mitglieder": it sees the protected fields of the members. */
const MEMBERS: AllowedPlaceholders = templatePlaceholders(
	{ member: new Set(['address', 'birthDate', `custom:${NOTE_FIELD}`]), partner: new Set() },
	CUSTOM_FIELDS,
);
/** An area like "Veranstaltungen": base fields only. */
const EVENTS: AllowedPlaceholders = templatePlaceholders(
	{ member: new Set(), partner: new Set() },
	CUSTOM_FIELDS,
);

const text = (value: string): InlineNode => ({ text: value, type: 'text' });
const placeholder = (key: string, fallback: string | null = null): InlineNode => ({
	attrs: { fallback, key },
	type: 'placeholder',
});
const heading = (id: string, content: readonly InlineNode[]): HeadingBlock => ({
	content,
	id,
	level: 1,
	type: 'heading',
});
/**
 * A heading with placeholders only.
 *
 * @param id The block id.
 * @param keys The placeholder keys.
 * @returns The heading.
 */
const placeholderHeading = (id: string, ...keys: readonly string[]): HeadingBlock =>
	heading(
		id,
		keys.map((key) => placeholder(key)),
	);
const image = (overrides: Readonly<Partial<ImageBlock>> = {}): ImageBlock => ({
	alt: 'Vereinsheim',
	decorative: false,
	href: null,
	id: 'i',
	mediaId: OWN_IMAGE,
	type: 'image',
	...overrides,
});
const button = (href: string): ButtonBlock => ({
	align: 'left',
	href,
	id: 'b',
	label: [text('Anmelden')],
	type: 'button',
});
const textBlock = (value: string): TextBlock => ({
	doc: { content: [{ content: [text(value)], type: 'paragraph' }], type: 'doc' },
	id: 't',
	type: 'text',
});

const VALID: TemplateInput = {
	body: {
		blocks: [
			heading('h', [text('Sommerfest')]),
			{ id: 's', ref: { fallback: null, key: 'salutation' }, suffix: ',', type: 'placeholderLine' },
			image(),
			button('https://example.org/anmelden'),
		],
		kind: 'blocks',
		layout: { kind: 'standard' },
	},
	name: 'Sommerfest',
	preheader: 'Am Samstag im Vereinsheim',
	salutationForm: 'du',
	salutationTexts: DEFAULT_SALUTATIONS.du,
	subject: 'Einladung für {{contact.firstName | ""}}',
};

const withBlocks = (blocks: readonly Block[]): TemplateInput => ({
	...VALID,
	body: { blocks, kind: 'blocks', layout: { kind: 'standard' } },
});
const withBody = (body: TemplateBody): TemplateInput => ({ ...VALID, body });
const withSalutation = (
	salutationCase: 'female' | 'male' | 'other',
	value: string,
): TemplateInput => ({
	...VALID,
	salutationTexts: { ...DEFAULT_SALUTATIONS.du, [salutationCase]: value },
});

interface Case {
	readonly name: string;
	readonly input: TemplateInput;
	readonly allowed?: AllowedPlaceholders;
	readonly expected: readonly SaveProblem[];
}

const CASES: readonly Case[] = [
	{ expected: [{ kind: 'nameEmpty' }], input: { ...VALID, name: '  ' }, name: 'an empty name' },
	{
		expected: [{ field: 'name', kind: 'tooLong' }],
		input: { ...VALID, name: 'n'.repeat(101) },
		name: 'a name of 101 characters',
	},
	{
		expected: [{ kind: 'subjectEmpty' }],
		input: { ...VALID, subject: ' ' },
		name: 'an empty subject',
	},
	{
		expected: [{ field: 'subject', kind: 'tooLong' }],
		input: { ...VALID, subject: 's'.repeat(201) },
		name: 'a subject of 201 characters',
	},
	{
		expected: [{ field: 'preheader', kind: 'tooLong' }],
		input: { ...VALID, preheader: 'p'.repeat(201) },
		name: 'a preheader of 201 characters',
	},
	{
		expected: [{ blockId: 'i', kind: 'altMissing' }],
		input: withBlocks([image({ alt: ' ' })]),
		name: 'an image without alt text',
	},
	{
		expected: [{ blockId: 'b', kind: 'linkMissing' }],
		input: withBlocks([button('')]),
		name: 'a button without link',
	},
	{
		expected: [{ key: 'contact.birthDate', kind: 'placeholderForbidden', where: 'block.h' }],
		input: withBlocks([placeholderHeading('h', 'contact.birthDate')]),
		name: 'the birth date in an area that may not see it',
	},
	{
		expected: [{ key: 'foo.bar', kind: 'placeholderUnknown', where: 'block.h' }],
		input: withBlocks([placeholderHeading('h', 'foo.bar')]),
		name: 'an unknown key',
	},
	{
		expected: [{ kind: 'syntax', where: 'subject' }],
		input: { ...VALID, subject: 'Hallo {{x' },
		name: 'a broken placeholder in the subject',
	},
	{
		expected: [{ kind: 'syntax', where: 'preheader' }],
		input: { ...VALID, preheader: 'Hallo {{x' },
		name: 'a broken placeholder in the preheader',
	},
	{
		expected: [{ kind: 'tooBig' }],
		input: withBlocks([textBlock('x'.repeat(MAX_TEMPLATE_JSON_BYTES + 1024))]),
		name: 'a template above 256 KB',
	},
	{
		allowed: MEMBERS,
		expected: [{ key: 'contact.city', kind: 'placeholderForbidden', where: 'salutation.female' }],
		input: withSalutation('female', 'Liebe {{contact.city}}'),
		name: 'the city in a salutation text',
	},
	{
		expected: [{ key: 'salutation', kind: 'placeholderForbidden', where: 'salutation.other' }],
		input: withSalutation('other', 'Hallo {{salutation}}'),
		name: 'the salutation in a salutation text',
	},
	{
		expected: [{ kind: 'syntax', where: 'salutation.male' }],
		input: withSalutation('male', 'Lieber {{contact.firstName'),
		name: 'a salutation text that does not parse',
	},
	{
		expected: [{ kind: 'mediaForeign', mediaId: FOREIGN_IMAGE }],
		input: withBlocks([image({ mediaId: FOREIGN_IMAGE })]),
		name: 'an image of another area',
	},
	{
		expected: [{ kind: 'htmlNotYetSupported' }],
		input: withBody({ html: '<p>Hallo</p>', kind: 'html' }),
		name: 'an HTML template',
	},
	{
		expected: [{ kind: 'htmlNotYetSupported' }],
		input: withBody({
			blocks: [],
			kind: 'blocks',
			layout: { html: '<div>{{content}}</div>', kind: 'own' },
		}),
		name: 'an own layout',
	},
	{
		expected: [{ key: 'content', kind: 'placeholderForbidden', where: 'block.h' }],
		input: withBlocks([placeholderHeading('h', 'content')]),
		name: 'the content of a layout in a template',
	},
	{
		expected: [{ key: 'contact.birthDate', kind: 'placeholderForbidden', where: 'subject' }],
		input: { ...VALID, subject: 'Zum {{contact.birthDate}}' },
		name: 'a forbidden placeholder in the subject',
	},
	{
		expected: [{ key: 'contact.city', kind: 'placeholderForbidden', where: 'block.left' }],
		input: withBlocks([
			{
				id: 'c',
				left: [placeholderHeading('left', 'contact.city')],
				right: [heading('right', [text('Rechts')])],
				type: 'columns',
			},
		]),
		name: 'a forbidden placeholder in a column',
	},
	{
		expected: [{ key: 'foo.bar', kind: 'placeholderUnknown', where: 'block.p' }],
		input: withBlocks([
			{ id: 'p', ref: { fallback: '', key: 'foo.bar' }, suffix: '', type: 'placeholderLine' },
		]),
		name: 'an unknown placeholder line',
	},
	{
		expected: [
			{ key: 'contact.custom.notiz', kind: 'placeholderForbidden', where: 'block.h' },
			{ key: 'contact.custom.unbekannt', kind: 'placeholderUnknown', where: 'block.h' },
		],
		input: withBlocks([
			placeholderHeading(
				'h',
				'contact.custom.notiz',
				'contact.custom.trikotgroesse',
				'contact.custom.unbekannt',
			),
		]),
		name: 'custom fields by their protection',
	},
];

/** The same unknown key twice in the subject and in one block, the same foreign image twice. */
const REPEATED: TemplateInput = {
	...withBlocks([
		heading('h', [placeholder('foo.bar'), placeholder('foo.bar', '')]),
		image({ mediaId: FOREIGN_IMAGE }),
		image({ id: 'i2', mediaId: FOREIGN_IMAGE }),
	]),
	subject: '{{foo.bar}} {{foo.bar}}',
};

describe(checkTemplateForSave, () => {
	it('has the limits of the design', () => {
		expect([
			MAX_TEMPLATE_SUBJECT_LENGTH,
			MAX_TEMPLATE_PREHEADER_LENGTH,
			MAX_TEMPLATE_NAME_LENGTH,
		]).toStrictEqual([200, 200, 100]);
	});

	it('finds nothing in a valid template', () => {
		expect(checkTemplateForSave(VALID, EVENTS, AREA_IMAGES)).toStrictEqual([]);
	});

	it.each(CASES)('reports $name', ({ allowed = EVENTS, expected, input }) => {
		expect(checkTemplateForSave(input, allowed, AREA_IMAGES)).toStrictEqual(expected);
	});

	it('allows the protected fields of the area', () => {
		const input = withBlocks([
			placeholderHeading('h', 'contact.birthDate', 'contact.custom.notiz'),
		]);
		expect(checkTemplateForSave(input, MEMBERS, AREA_IMAGES)).toStrictEqual([]);
	});

	it('accepts a decorative image without alt text and an image not chosen yet', () => {
		const blocks = [image({ alt: '', decorative: true }), image({ id: 'empty', mediaId: null })];
		expect(checkTemplateForSave(withBlocks(blocks), EVENTS, AREA_IMAGES)).toStrictEqual([]);
	});

	it('reports a placeholder once per place, in the order of the template', () => {
		expect(checkTemplateForSave(REPEATED, EVENTS, AREA_IMAGES)).toStrictEqual([
			{ key: 'foo.bar', kind: 'placeholderUnknown', where: 'subject' },
			{ key: 'foo.bar', kind: 'placeholderUnknown', where: blockWhere('h') },
			{ kind: 'mediaForeign', mediaId: FOREIGN_IMAGE },
		]);
	});

	it('counts the size of the template in bytes', () => {
		// Two bytes per character in UTF-8: half the characters reach the limit.
		const input = withBlocks([textBlock('ä'.repeat(MAX_TEMPLATE_JSON_BYTES / 2))]);
		expect(checkTemplateForSave(input, EVENTS, AREA_IMAGES)).toStrictEqual([{ kind: 'tooBig' }]);
	});

	it('accepts the default salutation texts of both forms', () => {
		const sie: TemplateInput = {
			...VALID,
			salutationForm: 'sie',
			salutationTexts: DEFAULT_SALUTATIONS.sie,
		};
		expect(checkTemplateForSave(sie, EVENTS, AREA_IMAGES)).toStrictEqual([]);
	});
});
