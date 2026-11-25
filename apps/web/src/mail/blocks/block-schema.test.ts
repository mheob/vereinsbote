/* oxlint-disable no-script-url -- the tests feed such URLs on purpose to see them refused */
import { describe, expect, it } from 'vite-plus/test';

import {
	blockListSchema,
	collectMediaIds,
	collectPlaceholderRefs,
	MAX_BLOCKS,
	MAX_TEMPLATE_JSON_BYTES,
} from './block-schema';
import type { Block } from './block-schema';

const MEDIA_A = 'a'.repeat(22);
const MEDIA_B = 'b'.repeat(22);

const divider = (id: string): Block => ({ id, type: 'divider' });
const image = (id: string, overrides: Readonly<Record<string, unknown>> = {}): unknown => ({
	alt: 'Vereinsheim',
	decorative: false,
	href: null,
	id,
	mediaId: MEDIA_A,
	type: 'image',
	...overrides,
});

const parse = (value: unknown): boolean => blockListSchema.safeParse(value).success;

const placeholder = (key: string, fallback: string | null = null): unknown => ({
	attrs: { fallback, key },
	type: 'placeholder',
});

describe('the block list schema', () => {
	it('has the limits of the design', () => {
		expect(MAX_BLOCKS).toBe(100);
		expect(MAX_TEMPLATE_JSON_BYTES).toBe(256 * 1024);
	});

	it('accepts every kind of block', () => {
		const blocks = [
			{ content: [{ text: 'Titel', type: 'text' }], id: 'h', level: 2, type: 'heading' },
			{ doc: { content: [{ type: 'paragraph' }], type: 'doc' }, id: 't', type: 'text' },
			image('i'),
			{
				align: 'center',
				href: '',
				id: 'b',
				label: [{ text: 'Los', type: 'text' }],
				type: 'button',
			},
			divider('d'),
			{ id: 's', size: 'large', type: 'spacer' },
			{ id: 'c', left: [divider('l')], right: [image('r', { mediaId: null })], type: 'columns' },
			{ id: 'p', ref: { fallback: '', key: 'salutation' }, type: 'placeholderLine' },
		];
		expect(parse(blocks)).toBe(true);
	});

	it('refuses more than 100 blocks, counting the blocks in columns', () => {
		const hundred = Array.from({ length: 100 }, (_, index) => divider(`d${String(index)}`));
		expect(parse(hundred)).toBe(true);
		expect(parse([...hundred, divider('extra')])).toBe(false);
		const columns = {
			id: 'c',
			left: Array.from({ length: 50 }, (_, index) => divider(`l${String(index)}`)),
			right: Array.from({ length: 50 }, (_, index) => divider(`r${String(index)}`)),
			type: 'columns',
		};
		expect(parse([columns])).toBe(false);
	});

	it('refuses columns in columns', () => {
		const inner = { id: 'inner', left: [], right: [], type: 'columns' };
		expect(parse([{ id: 'outer', left: [inner], right: [], type: 'columns' }])).toBe(false);
	});

	it('refuses a duplicate id, also inside columns', () => {
		expect(parse([divider('x'), divider('x')])).toBe(false);
		expect(
			parse([divider('x'), { id: 'c', left: [divider('x')], right: [], type: 'columns' }]),
		).toBe(false);
	});

	it('allows an image without alt text that is not decorative (the save checks refuse it)', () => {
		expect(parse([image('i', { alt: '', decorative: false })])).toBe(true);
	});

	it('allows a button without a link (the save checks report it)', () => {
		const button = { align: 'left', href: '', id: 'b', label: [], type: 'button' };
		expect(parse([button])).toBe(true);
	});

	it.each(['javascript:x', 'http://example.org', 'data:image/png;base64,AAAA'])(
		'refuses %s as a link of a button or an image',
		(href) => {
			const button = { align: 'left', href, id: 'b', label: [], type: 'button' };
			expect(parse([button])).toBe(false);
			expect(parse([image('i', { href })])).toBe(false);
		},
	);

	it('refuses a link in a text block with a script URL', () => {
		const doc = {
			content: [
				{
					content: [
						{ marks: [{ attrs: { href: 'javascript:x' }, type: 'link' }], text: 'x', type: 'text' },
					],
					type: 'paragraph',
				},
			],
			type: 'doc',
		};
		expect(parse([{ doc, id: 't', type: 'text' }])).toBe(false);
	});

	it('refuses unknown blocks, unknown nodes and extra fields', () => {
		expect(parse([{ id: 'x', type: 'video' }])).toBe(false);
		const codeBlock = { content: [{ content: [], type: 'codeBlock' }], type: 'doc' };
		expect(parse([{ doc: codeBlock, id: 't', type: 'text' }])).toBe(false);
		expect(parse([{ color: 'red', id: 'd', type: 'divider' }])).toBe(false);
		expect(parse([{ content: [], id: 'h', level: 4, type: 'heading' }])).toBe(false);
		expect(parse([image('i', { mediaId: 'short' })])).toBe(false);
	});
});

describe(collectPlaceholderRefs, () => {
	it('finds the placeholders of every block in order, also in columns', () => {
		const blocks = blockListSchema.parse([
			{ content: [placeholder('brand.name')], id: 'h', level: 1, type: 'heading' },
			{ id: 'p', ref: { fallback: null, key: 'salutation' }, type: 'placeholderLine' },
			{
				id: 'c',
				left: [
					{
						doc: {
							content: [
								{ content: [placeholder('contact.firstName', 'du')], type: 'paragraph' },
								{
									content: [
										{
											content: [{ content: [placeholder('contact.city', '')], type: 'paragraph' }],
											type: 'listItem',
										},
									],
									type: 'bulletList',
								},
							],
							type: 'doc',
						},
						id: 't',
						type: 'text',
					},
				],
				right: [
					{
						align: 'left',
						href: '',
						id: 'b',
						label: [placeholder('contact.lastName')],
						type: 'button',
					},
				],
				type: 'columns',
			},
		]);
		expect(collectPlaceholderRefs(blocks)).toStrictEqual([
			{ fallback: null, key: 'brand.name' },
			{ fallback: null, key: 'salutation' },
			{ fallback: 'du', key: 'contact.firstName' },
			{ fallback: '', key: 'contact.city' },
			{ fallback: null, key: 'contact.lastName' },
		]);
	});
});

describe(collectMediaIds, () => {
	it('finds each image once, also in columns, and skips images without one', () => {
		const blocks = blockListSchema.parse([
			image('a'),
			image('none', { mediaId: null }),
			{ id: 'c', left: [image('b', { mediaId: MEDIA_B })], right: [image('a2')], type: 'columns' },
		]);
		expect(collectMediaIds(blocks)).toStrictEqual([MEDIA_A, MEDIA_B]);
	});
});
