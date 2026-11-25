import { describe, expect, it } from 'vite-plus/test';

import type { MessageKey, MessageParams } from '@/i18n/translate';
import type { Block } from '@/mail/blocks/block-schema';

import { blockLine } from './block-summary';

/**
 * A translation function that shows the key and its parameters.
 *
 * @param key The key.
 * @param params The parameters.
 * @returns `key{…}`.
 */
function t(key: MessageKey, params: MessageParams = {}): string {
	return Object.keys(params).length === 0 ? key : `${key}${JSON.stringify(params)}`;
}

const label = (key: string): string => (key === 'contact.firstName' ? 'Vorname' : key);
const line = (block: Block): string => blockLine(block, label, t);

const MEDIA_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

describe(blockLine, () => {
	it('shows the text of headings, texts and buttons with the names of placeholders', () => {
		expect(
			line({
				content: [
					{ text: 'Hallo ', type: 'text' },
					{ attrs: { fallback: null, key: 'contact.firstName' }, type: 'placeholder' },
				],
				id: 'h',
				level: 1,
				type: 'heading',
			}),
		).toBe('editor.blockType.heading: Hallo Vorname');
		expect(
			line({
				doc: {
					content: [
						{
							content: [{ text: 'Wir laden', type: 'text' }, { type: 'hardBreak' }],
							type: 'paragraph',
						},
						{
							content: [
								{
									content: [{ content: [{ text: 'ein.', type: 'text' }], type: 'paragraph' }],
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
			}),
		).toBe('editor.blockType.text: Wir laden ein.');
		expect(line({ align: 'left', href: '', id: 'b', label: [], type: 'button' })).toBe(
			'editor.blockType.button: editor.summary.empty',
		);
	});

	it('shortens long texts', () => {
		const text = 'Wort '.repeat(30);
		const result = line({ content: [{ text, type: 'text' }], id: 'h', level: 2, type: 'heading' });
		expect(result).toBe(`editor.blockType.heading: ${'Wort '.repeat(12).trim()} …`);
	});

	it('says what an image shows', () => {
		const image = {
			alt: '',
			decorative: false,
			href: null,
			id: 'i',
			mediaId: null,
			type: 'image',
		} as const;
		expect(line(image)).toBe('editor.blockType.image: editor.summary.noImage');
		expect(line({ ...image, alt: 'Wappen', mediaId: MEDIA_ID })).toBe(
			'editor.blockType.image: Wappen',
		);
		expect(line({ ...image, decorative: true, mediaId: MEDIA_ID })).toBe(
			'editor.blockType.image: editor.summary.decorative',
		);
		expect(line({ ...image, mediaId: MEDIA_ID })).toBe(
			'editor.blockType.image: editor.summary.empty',
		);
	});

	it('names the other blocks by their settings', () => {
		expect(line({ id: 'd', type: 'divider' })).toBe('editor.blockType.divider');
		expect(line({ id: 's', size: 'large', type: 'spacer' })).toBe(
			'editor.blockType.spacer: editor.size.large',
		);
		expect(
			line({ id: 'c', left: [{ id: 'd', type: 'divider' }], right: [], type: 'columns' }),
		).toBe('editor.blockType.columns: editor.summary.columns{"left":1,"right":0}');
		expect(
			line({
				id: 'p',
				ref: { fallback: null, key: 'contact.firstName' },
				suffix: ',',
				type: 'placeholderLine',
			}),
		).toBe('editor.blockType.placeholderLine: Vorname,');
	});
});
