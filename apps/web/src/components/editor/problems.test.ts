import { describe, expect, it } from 'vite-plus/test';

import type { MessageKey, MessageParams } from '@/i18n/translate';
import type { Block } from '@/mail/blocks/block-schema';
import type { SaveProblem } from '@/server/templates/save-checks';

import { indexProblems, problemDescriber, problemMessage, problemPlace } from './problems';

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

const label = (key: string): string => `«${key}»`;

const MEDIA_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

const blocks: readonly Block[] = [
	{ id: 'h', type: 'divider' },
	{
		id: 'cols',
		left: [{ alt: '', decorative: false, href: null, id: 'img', mediaId: MEDIA_ID, type: 'image' }],
		right: [],
		type: 'columns',
	},
];

const where = (value: string): SaveProblem => ({
	key: 'contact.birthDate',
	kind: 'placeholderForbidden',
	where: value,
});

describe(problemPlace, () => {
	it('puts name, subject and preview text at their fields', () => {
		expect(problemPlace({ kind: 'nameEmpty' }, blocks)).toStrictEqual({
			blockId: null,
			focusKey: 'name',
			inSettings: false,
		});
		expect(problemPlace({ field: 'name', kind: 'tooLong' }, blocks)?.focusKey).toBe('name');
		expect(problemPlace({ kind: 'subjectEmpty' }, blocks)).toStrictEqual({
			blockId: null,
			focusKey: 'subject',
			inSettings: true,
		});
		expect(problemPlace({ field: 'preheader', kind: 'tooLong' }, blocks)?.focusKey).toBe(
			'preheader',
		);
	});

	it('puts placeholder problems where they stand', () => {
		expect(problemPlace(where('salutation.female'), blocks)).toStrictEqual({
			blockId: null,
			focusKey: 'salutation.female',
			inSettings: true,
		});
		expect(problemPlace(where('block.h'), blocks)).toStrictEqual({
			blockId: 'h',
			focusKey: 'content.h',
			inSettings: false,
		});
		expect(problemPlace({ kind: 'syntax', where: 'subject' }, blocks)?.focusKey).toBe('subject');
	});

	it('puts the problems of an image or a button at their fields', () => {
		expect(problemPlace({ blockId: 'img', kind: 'altMissing' }, blocks)?.focusKey).toBe('alt.img');
		expect(problemPlace({ blockId: 'b', kind: 'linkMissing' }, blocks)?.focusKey).toBe('href.b');
		expect(problemPlace({ kind: 'mediaForeign', mediaId: MEDIA_ID }, blocks)).toStrictEqual({
			blockId: 'img',
			focusKey: 'media.img',
			inSettings: false,
		});
		expect(problemPlace({ kind: 'mediaForeign', mediaId: 'other' }, blocks)).toBeNull();
	});

	it('puts an own HTML layout at the layout and a too big template nowhere', () => {
		expect(problemPlace({ kind: 'htmlNotYetSupported' }, blocks)?.focusKey).toBe('layout');
		expect(problemPlace({ kind: 'tooBig' }, blocks)).toBeNull();
	});
});

describe(problemMessage, () => {
	it('names the placeholder and the field', () => {
		expect(
			problemMessage(
				{ key: 'contact.birthDate', kind: 'placeholderUnknown', where: 'subject' },
				label,
				t,
			),
		).toBe('editor.problem.placeholderUnknown{"name":"«contact.birthDate»"}');
		expect(problemMessage({ field: 'subject', kind: 'tooLong' }, label, t)).toBe(
			'editor.problem.subjectTooLong',
		);
		expect(problemMessage({ blockId: 'img', kind: 'altMissing' }, label, t)).toBe(
			'editor.problem.altMissing',
		);
	});
});

describe(indexProblems, () => {
	it('sorts the problems by field, marks the blocks and finds the first place', () => {
		const index = indexProblems(
			[
				{ kind: 'tooBig' },
				{ blockId: 'img', kind: 'altMissing' },
				{ key: 'x.y', kind: 'placeholderUnknown', where: 'subject' },
				{ kind: 'subjectEmpty' },
			],
			blocks,
			problemDescriber(label, t),
		);
		expect(index.general).toStrictEqual(['editor.problem.tooBig']);
		expect(index.byField).toStrictEqual(
			new Map([
				['alt.img', 'editor.problem.altMissing'],
				[
					'subject',
					'editor.problem.placeholderUnknown{"name":"«x.y»"} editor.problem.subjectEmpty',
				],
			]),
		);
		expect(index.blockIds).toStrictEqual(new Set(['img', 'cols']));
		expect(index.first).toStrictEqual({ blockId: 'img', focusKey: 'alt.img', inSettings: false });
	});

	it('finds nothing without problems', () => {
		const index = indexProblems([], blocks, problemDescriber(label, t));
		expect(index.first).toBeNull();
		expect(index.byField.size).toBe(0);
	});
});
