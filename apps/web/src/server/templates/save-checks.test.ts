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
	MAX_TEMPLATE_NAME_LENGTH,
	MAX_TEMPLATE_PREHEADER_LENGTH,
	MAX_TEMPLATE_SUBJECT_LENGTH,
} from './limits';
import { blockWhere } from './save-checks';
import type { SaveProblem } from './save-checks';
import { checkTemplateForSave, prepareTemplateForSave } from './testing';

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
		expected: [{ key: 'contact.birthDate', kind: 'placeholderForbidden', where: 'html' }],
		input: withBody({ html: '<p>Zum {{contact.birthDate}}</p>', kind: 'html' }),
		name: 'the birth date in an HTML template of an area that may not see it',
	},
	{
		expected: [{ key: 'foo.bar', kind: 'placeholderUnknown', where: 'html' }],
		input: withBody({ html: '<p>{{foo.bar}}</p>', kind: 'html' }),
		name: 'an unknown key in an HTML template',
	},
	{
		expected: [{ kind: 'syntax', where: 'html' }],
		input: withBody({ html: '<p>{{contact.firstName</p>', kind: 'html' }),
		name: 'a broken placeholder in an HTML template',
	},
	{
		expected: [
			{
				attribute: 'href',
				key: 'contact.firstName',
				kind: 'placeholderInAttribute',
				where: 'html',
			},
		],
		input: withBody({ html: '<a href="{{contact.firstName}}">x</a>', kind: 'html' }),
		name: 'contact data in a link of an HTML template',
	},
	{
		expected: [{ kind: 'mediaForeign', mediaId: FOREIGN_IMAGE }],
		input: withBody({ html: `<img src="/media/${FOREIGN_IMAGE}.png" alt="">`, kind: 'html' }),
		name: 'an image of another area in an HTML template',
	},
	{
		expected: [],
		input: withBody({
			html: `<p>{{salutation}}</p><img src="/media/${OWN_IMAGE}.png" alt="">`,
			kind: 'html',
		}),
		name: 'an HTML template with an image of the area',
	},
	{
		expected: [{ key: 'brand.name', kind: 'placeholderInComment', where: 'html' }],
		input: withBody({ html: '<!--[if mso]><p>{{brand.name}}</p><![endif]-->', kind: 'html' }),
		name: 'a placeholder in a conditional comment',
	},
	{
		expected: [
			{ attribute: 'style', key: 'brand.primaryColor', kind: 'fallbackNotAllowed', where: 'html' },
		],
		input: withBody({
			html: '<p style=\'color:{{brand.primaryColor | "red"}}\'>x</p>',
			kind: 'html',
		}),
		name: 'a fallback in a style attribute',
	},
	{
		expected: [{ kind: 'placeholderHidden', where: 'html' }],
		input: withBody({ html: '<p>{<script>x</script>{contact.firstName}}</p>', kind: 'html' }),
		name: 'a placeholder hidden by a removed node',
	},
	{
		expected: [{ kind: 'tooDeep' }],
		input: withBody({ html: '<div>'.repeat(5000), kind: 'html' }),
		name: 'HTML that is nested too deeply',
	},
	{
		expected: [{ kind: 'contentMissing' }],
		input: withBody({
			blocks: [],
			kind: 'blocks',
			layout: { html: '<div>Kopf</div>', kind: 'own' },
		}),
		name: 'an own layout without content',
	},
	{
		expected: [{ kind: 'contentRepeated' }],
		input: withBody({
			blocks: [],
			kind: 'blocks',
			layout: { html: '<div>{{content}}</div><div>{{content}}</div>', kind: 'own' },
		}),
		name: 'an own layout with content twice',
	},
	{
		expected: [{ key: 'contact.birthDate', kind: 'placeholderForbidden', where: 'layout' }],
		input: withBody({
			blocks: [],
			kind: 'blocks',
			layout: { html: '<p>{{contact.birthDate}}</p><div>{{content}}</div>', kind: 'own' },
		}),
		name: 'the birth date in an own layout of an area that may not see it',
	},
	{
		expected: [],
		input: withBody({
			blocks: [],
			kind: 'blocks',
			layout: { html: '<p>{{brand.name}}</p><div>{{content}}</div>', kind: 'own' },
		}),
		name: 'an own layout with content',
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

	it('applies the 256 KB limit to blocks, not to HTML', () => {
		// About 300 KB of HTML: above the click editor's limit, below the import's 500 KB.
		const html = `<html><body>${'<p>Hallo Welt, ein Absatz.</p>'.repeat(11_000)}</body></html>`;
		expect(html.length).toBeGreaterThan(MAX_TEMPLATE_JSON_BYTES);
		const body = { html, kind: 'html' } as const;
		expect(checkTemplateForSave(withBody(body), EVENTS, AREA_IMAGES)).toStrictEqual([]);
		const own = { html: `${html}<div>{{content}}</div>`, kind: 'own' } as const;
		const withOwnLayout = withBody({
			blocks: [heading('h', [text('x')])],
			kind: 'blocks',
			layout: own,
		});
		expect(checkTemplateForSave(withOwnLayout, EVENTS, AREA_IMAGES)).toStrictEqual([]);
	});

	it('accepts the default salutation texts of both forms', () => {
		const sie: TemplateInput = {
			...VALID,
			salutationForm: 'sie',
			salutationTexts: DEFAULT_SALUTATIONS.sie,
		};
		expect(checkTemplateForSave(sie, EVENTS, AREA_IMAGES)).toStrictEqual([]);
	});

	describe(prepareTemplateForSave, () => {
		it('gives the HTML of a template cleaned', () => {
			const dirty = withBody({
				html: '<p onclick="x()">Hallo {{salutation}}</p><script>alert(1)</script>',
				kind: 'html',
			});
			const { input, problems } = prepareTemplateForSave(dirty, EVENTS, AREA_IMAGES);
			expect(problems).toStrictEqual([]);
			expect(input.body).toStrictEqual({
				html: "<!DOCTYPE html><html lang='de'><head></head><body><p>Hallo {{salutation}}</p></body></html>",
				kind: 'html',
			});
			expect(prepareTemplateForSave(input, EVENTS, AREA_IMAGES).input).toStrictEqual(input);
		});

		it('gives the own layout of a block template cleaned', () => {
			const dirty = withBody({
				blocks: [],
				kind: 'blocks',
				layout: { html: '<div>{{content}}</div><script>alert(1)</script>', kind: 'own' },
			});
			const { input, problems } = prepareTemplateForSave(dirty, EVENTS, AREA_IMAGES);
			expect(problems).toStrictEqual([]);
			expect(JSON.stringify(input.body)).not.toContain('script');
		});

		it('leaves a template with problems as it is', () => {
			const dirty = withBody({ html: '<p>{{foo.bar}}</p><script>x()</script>', kind: 'html' });
			const { input, problems } = prepareTemplateForSave(dirty, EVENTS, AREA_IMAGES);
			expect(problems).toHaveLength(1);
			expect(input).toBe(dirty);
		});

		it('leaves blocks and a global layout as they are', () => {
			expect(prepareTemplateForSave(VALID, EVENTS, AREA_IMAGES).input).toBe(VALID);
		});
	});
});
