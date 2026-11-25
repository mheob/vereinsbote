import { getSchema } from '@tiptap/core';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import type { NodeType } from '@tiptap/pm/model';
import { describe, expect, it } from 'vite-plus/test';

import type { MessageKey, MessageParams } from '@/i18n/translate';
import { editorPlaceholders } from '@/server/templates/editor-placeholders';

import { PlaceholderNode, placeholderNodeOptions, refOf } from './placeholder-node';

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

const offered = editorPlaceholders(new Set(['contact.firstName', 'contact.custom.typ']), [
	{ id: 'f', kind: 'member', name: 'Typ', placeholderKey: 'typ', protection: 'base', type: 'text' },
]);

describe(placeholderNodeOptions, () => {
	const options = placeholderNodeOptions(offered, t);

	it('names placeholders in the language of the page', () => {
		expect(options.label('contact.firstName')).toBe('mail.placeholder.contact.firstName');
		expect(options.label('contact.custom.typ')).toBe('Typ');
		expect(options.prefix).toBe('editor.placeholder');
	});

	it('says what happens when the value is missing', () => {
		const name = 'mail.placeholder.contact.firstName';
		expect(options.describe({ fallback: null, key: 'contact.firstName' })).toBe(
			`editor.placeholderRequired${JSON.stringify({ name })}`,
		);
		expect(options.describe({ fallback: '', key: 'contact.firstName' })).toBe(
			`editor.placeholderOptional${JSON.stringify({ name })}`,
		);
		expect(options.describe({ fallback: 'Mitglied', key: 'contact.firstName' })).toBe(
			`editor.placeholderWithFallback${JSON.stringify({ fallback: 'Mitglied', name })}`,
		);
	});
});

describe('the placeholder node', () => {
	const node = PlaceholderNode.configure({
		describe: (ref) => `${ref.key}?`,
		label: (key) => `«${key}»`,
		prefix: 'Platzhalter',
	});
	const schema = getSchema([Document, Paragraph, Text, node]);
	const type = schema.nodes.placeholder;
	/**
	 * The placeholder's node type; the schema has it, as the test below shows.
	 *
	 * @returns The type.
	 */
	const placeholderType = (): NodeType => {
		if (type === undefined) throw new Error('The schema has no placeholder node.');
		return type;
	};

	it('is an inline atom with a key and a fallback', () => {
		expect(type?.isInline).toBe(true);
		expect(type?.isAtom).toBe(true);
		// ProseMirror's attributes have no prototype.
		expect({ ...type?.create({ fallback: '', key: 'contact.firstName' }).attrs }).toStrictEqual({
			fallback: '',
			key: 'contact.firstName',
		});
	});

	it('shows the name with a prefix for screen readers and the fallback in the title', () => {
		const placeholder = placeholderType().create({ fallback: null, key: 'contact.firstName' });
		expect(placeholderType().spec.toDOM?.(placeholder)).toStrictEqual([
			'span',
			expect.objectContaining({
				'data-key': 'contact.firstName',
				'data-placeholder': '',
				title: 'contact.firstName?',
			}),
			['span', { class: 'sr-only' }, 'Platzhalter '],
			'«contact.firstName»',
		]);
		expect(placeholder.textContent).toBe('');
	});

	it('reads its key and fallback back from the page', () => {
		expect(placeholderType().spec.parseDOM).toMatchObject([{ tag: 'span[data-placeholder]' }]);
	});
});

describe(refOf, () => {
	it('reads key and fallback, with defaults for anything else', () => {
		expect(refOf({ fallback: 'Gast', key: 'contact.firstName' })).toStrictEqual({
			fallback: 'Gast',
			key: 'contact.firstName',
		});
		expect(refOf({ fallback: 3, key: null })).toStrictEqual({ fallback: null, key: '' });
	});
});
