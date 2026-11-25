import { describe, expect, it } from 'vite-plus/test';

import { MAX_BLOCKS } from '@/mail/blocks/block-schema';
import type { Block, ColumnBlock } from '@/mail/blocks/block-schema';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import type { TemplateInput } from '@/mail/templates/template-schema';

import {
	countBlocks,
	createEditorState,
	editorBlocks,
	editorReducer,
	locateBlock,
	moveAnnouncement,
	openTopLevelBlock,
	salutationFormPatch,
} from './editor-state';
import type { EditorAction, EditorState } from './editor-state';

const divider = (id: string): ColumnBlock => ({ id, type: 'divider' });

const text = (id: string): ColumnBlock => ({
	doc: { content: [{ type: 'paragraph' }], type: 'doc' },
	id,
	type: 'text',
});

const columns = (
	id: string,
	left: readonly ColumnBlock[] = [],
	right: readonly ColumnBlock[] = [],
): Block => ({ id, left, right, type: 'columns' });

/**
 * A template with the given blocks.
 *
 * @param blocks The blocks.
 * @returns The input.
 */
function template(blocks: readonly Block[]): TemplateInput {
	return {
		body: { blocks, kind: 'blocks', layout: { kind: 'standard' } },
		name: 'Sommerfest',
		preheader: '',
		salutationForm: 'du',
		salutationTexts: DEFAULT_SALUTATIONS.du,
		subject: 'Einladung',
	};
}

/**
 * An editor state of a template with the given blocks, version 3.
 *
 * @param blocks The blocks.
 * @returns The state.
 */
function stateWith(blocks: readonly Block[]): EditorState {
	return createEditorState(template(blocks), 3);
}

/**
 * The ids of the blocks of a state, a columns block with the ids of its sides.
 *
 * @param state The state.
 * @returns The ids.
 */
function ids(state: EditorState): unknown[] {
	return editorBlocks(state).map((block) =>
		block.type === 'columns'
			? { [block.id]: [block.left.map(({ id }) => id), block.right.map(({ id }) => id)] }
			: block.id,
	);
}

/**
 * Applies actions one after the other.
 *
 * @param state The state to start from.
 * @param actions The actions.
 * @returns The state after the last one.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the reducer is a plain function over the state
function run(state: EditorState, ...actions: readonly EditorAction[]): EditorState {
	let current = state;
	for (const action of actions) current = editorReducer(current, action);
	return current;
}

describe(createEditorState, () => {
	it('starts unchanged without a selection', () => {
		const input = template([text('a')]);
		expect(createEditorState(input, 7)).toStrictEqual({
			dirty: false,
			input,
			selectedId: null,
			version: 7,
		});
	});
});

describe('editorReducer: add', () => {
	it('adds a block after another one at the top level and selects it', () => {
		const state = run(stateWith([text('a'), text('b')]), {
			afterId: 'a',
			block: divider('new'),
			type: 'add',
		});
		expect(ids(state)).toStrictEqual(['a', 'new', 'b']);
		expect(state.selectedId).toBe('new');
		expect(state.dirty).toBe(true);
	});

	it('adds at the start without a block to follow and at the end after the last one', () => {
		const start = run(stateWith([text('a')]), { afterId: null, block: divider('x'), type: 'add' });
		expect(ids(start)).toStrictEqual(['x', 'a']);
		const end = run(start, { afterId: 'a', block: divider('y'), type: 'add' });
		expect(ids(end)).toStrictEqual(['x', 'a', 'y']);
	});

	it('adds into either side of a columns block', () => {
		const initial = stateWith([columns('c', [text('l1')])]);
		const state = run(
			initial,
			{ afterId: 'l1', block: divider('l2'), column: { parentId: 'c', side: 'left' }, type: 'add' },
			{
				afterId: null,
				block: divider('r1'),
				column: { parentId: 'c', side: 'right' },
				type: 'add',
			},
		);
		expect(ids(state)).toStrictEqual([{ c: [['l1', 'l2'], ['r1']] }]);
		expect(state.selectedId).toBe('r1');
	});

	it('refuses two columns inside a column', () => {
		const state = stateWith([columns('c')]);
		const next = editorReducer(state, {
			afterId: null,
			block: columns('inner'),
			column: { parentId: 'c', side: 'left' },
			type: 'add',
		});
		expect(next).toBe(state);
	});

	it('refuses a column of a block that is no columns block', () => {
		const state = stateWith([text('a')]);
		const next = editorReducer(state, {
			afterId: null,
			block: divider('x'),
			column: { parentId: 'a', side: 'left' },
			type: 'add',
		});
		expect(next).toBe(state);
	});

	it('refuses more blocks than a template may have, the blocks in columns included', () => {
		const many = Array.from({ length: MAX_BLOCKS - 2 }, (_, index) => divider(`d${String(index)}`));
		const state = stateWith([...many, columns('c', [divider('l')])]);
		expect(countBlocks(editorBlocks(state))).toBe(MAX_BLOCKS);
		const next = editorReducer(state, { afterId: null, block: divider('x'), type: 'add' });
		expect(next).toBe(state);
	});
});

describe('editorReducer: move', () => {
	it('moves a block of the top level and tells where it is now', () => {
		const state = run(stateWith([text('a'), divider('b'), text('c')]), {
			id: 'c',
			toIndex: 0,
			type: 'move',
		});
		expect(ids(state)).toStrictEqual(['c', 'a', 'b']);
		expect(state.dirty).toBe(true);
		expect(moveAnnouncement(state, 'c')).toStrictEqual({
			blockType: 'text',
			position: 1,
			total: 3,
		});
		const down = run(state, { id: 'c', toIndex: 2, type: 'move' });
		expect(ids(down)).toStrictEqual(['a', 'b', 'c']);
		expect(moveAnnouncement(down, 'b')).toStrictEqual({
			blockType: 'divider',
			position: 2,
			total: 3,
		});
	});

	it('moves a block inside its column and counts the column only', () => {
		const initial = stateWith([text('a'), columns('c', [text('l1'), divider('l2'), text('l3')])]);
		const state = run(initial, {
			column: { parentId: 'c', side: 'left' },
			id: 'l3',
			toIndex: 0,
			type: 'move',
		});
		expect(ids(state)).toStrictEqual(['a', { c: [['l3', 'l1', 'l2'], []] }]);
		expect(moveAnnouncement(state, 'l3')).toStrictEqual({
			blockType: 'text',
			position: 1,
			total: 3,
		});
	});

	it('moves a block from the top level into a column and out again', () => {
		const into = run(stateWith([text('a'), columns('c')]), {
			column: { parentId: 'c', side: 'right' },
			id: 'a',
			toIndex: 0,
			type: 'move',
		});
		expect(ids(into)).toStrictEqual([{ c: [[], ['a']] }]);
		const out = run(into, { id: 'a', toIndex: 1, type: 'move' });
		expect(ids(out)).toStrictEqual([{ c: [[], []] }, 'a']);
	});

	it('keeps the index inside the list', () => {
		const state = run(stateWith([text('a'), text('b')]), { id: 'a', toIndex: 9, type: 'move' });
		expect(ids(state)).toStrictEqual(['b', 'a']);
		const start = run(state, { id: 'a', toIndex: -4, type: 'move' });
		expect(ids(start)).toStrictEqual(['a', 'b']);
	});

	it('refuses to move two columns into a column, and unknown blocks', () => {
		const state = stateWith([columns('outer'), columns('c')]);
		expect(
			editorReducer(state, {
				column: { parentId: 'c', side: 'left' },
				id: 'outer',
				toIndex: 0,
				type: 'move',
			}),
		).toBe(state);
		expect(editorReducer(state, { id: 'nobody', toIndex: 0, type: 'move' })).toBe(state);
	});
});

describe('editorReducer: update and remove', () => {
	it('replaces a block wherever it stands', () => {
		const changed: ColumnBlock = { id: 'l', size: 'large', type: 'spacer' };
		const initial = stateWith([text('a'), columns('c', [divider('l')])]);
		const state = run(initial, { block: changed, type: 'update' });
		expect(locateBlock(editorBlocks(state), 'l')?.block).toStrictEqual(changed);
		expect(state.dirty).toBe(true);
	});

	it('refuses two columns in place of a block in a column, and unknown blocks', () => {
		const state = stateWith([columns('c', [divider('l')])]);
		expect(editorReducer(state, { block: columns('l'), type: 'update' })).toBe(state);
		expect(editorReducer(state, { block: divider('nobody'), type: 'update' })).toBe(state);
	});

	it('removes a block and its selection', () => {
		const selected = run(stateWith([text('a'), text('b')]), { id: 'b', type: 'select' });
		expect(selected.dirty).toBe(false);
		const state = run(selected, { id: 'b', type: 'remove' });
		expect(ids(state)).toStrictEqual(['a']);
		expect(state.selectedId).toBeNull();
		expect(state.dirty).toBe(true);
	});

	it('removes a block of a column and keeps another selection', () => {
		const initial = stateWith([text('a'), columns('c', [divider('l')], [divider('r')])]);
		const state = run(initial, { id: 'a', type: 'select' }, { id: 'r', type: 'remove' });
		expect(ids(state)).toStrictEqual(['a', { c: [['l'], []] }]);
		expect(state.selectedId).toBe('a');
	});

	it('drops the selection of a block inside a removed columns block', () => {
		const initial = stateWith([columns('c', [divider('l')])]);
		const state = run(initial, { id: 'l', type: 'select' }, { id: 'c', type: 'remove' });
		expect(ids(state)).toStrictEqual([]);
		expect(state.selectedId).toBeNull();
	});
});

describe('editorReducer: settings, layout and saving', () => {
	it('changes the fields besides the body', () => {
		const state = run(stateWith([]), {
			patch: { name: 'Herbstfest', subject: 'Einladung zum Herbstfest' },
			type: 'settings',
		});
		expect(state.input).toMatchObject({ name: 'Herbstfest', subject: 'Einladung zum Herbstfest' });
		expect(state.dirty).toBe(true);
	});

	it('changes the layout of a block template', () => {
		const layout = { kind: 'shared', layoutId: '00000000-0000-4000-8000-000000000001' } as const;
		const state = run(stateWith([text('a')]), { layout, type: 'layout' });
		expect(state.input.body).toStrictEqual({ blocks: [text('a')], kind: 'blocks', layout });
		expect(state.dirty).toBe(true);
	});

	it('takes the new version and is unchanged after saving', () => {
		const changed = run(stateWith([]), { patch: { name: 'Herbstfest' }, type: 'settings' });
		const saved = run(changed, { input: changed.input, type: 'saved', version: 4 });
		expect(saved).toStrictEqual({ ...changed, dirty: false, version: 4 });
	});

	it('stays changed when the template changed while it was being saved', () => {
		const sent = run(stateWith([]), { patch: { name: 'Herbstfest' }, type: 'settings' });
		const later = run(sent, { patch: { name: 'Winterfest' }, type: 'settings' });
		const saved = run(later, { input: sent.input, type: 'saved', version: 4 });
		expect(saved.version).toBe(4);
		expect(saved.dirty).toBe(true);
	});

	it('leaves the blocks of an HTML template alone', () => {
		const state = createEditorState(
			{ ...template([]), body: { html: '<p>Hallo</p>', kind: 'html' } },
			1,
		);
		expect(editorBlocks(state)).toStrictEqual([]);
		expect(editorReducer(state, { afterId: null, block: divider('x'), type: 'add' })).toBe(state);
		expect(editorReducer(state, { layout: { kind: 'standard' }, type: 'layout' })).toBe(state);
	});
});

describe(moveAnnouncement, () => {
	it('knows nothing of an unknown block', () => {
		const state = stateWith([text('a')]);
		expect(moveAnnouncement(state, 'b')).toBeNull();
	});
});

describe(salutationFormPatch, () => {
	it('switches the default texts along with the form', () => {
		const input = template([]);
		expect(salutationFormPatch(input, 'sie')).toStrictEqual({
			salutationForm: 'sie',
			salutationTexts: DEFAULT_SALUTATIONS.sie,
		});
	});

	it('keeps texts the template changed', () => {
		const texts = { ...DEFAULT_SALUTATIONS.du, noName: 'Hallo zusammen' };
		const input = { ...template([]), salutationTexts: texts };
		expect(salutationFormPatch(input, 'sie')).toStrictEqual({
			salutationForm: 'sie',
			salutationTexts: texts,
		});
	});
});

describe(openTopLevelBlock, () => {
	const blocks = [text('a'), columns('c', [divider('l')], [text('r')])];

	it('is the selected block of the top level', () => {
		expect(openTopLevelBlock(blocks, 'a')?.id).toBe('a');
	});

	it('is the columns block that holds a selected block of a column', () => {
		expect(openTopLevelBlock(blocks, 'l')?.id).toBe('c');
		expect(openTopLevelBlock(blocks, 'r')?.id).toBe('c');
	});

	it('is nothing without a selection or for an unknown block', () => {
		expect(openTopLevelBlock(blocks, null)).toBeUndefined();
		expect(openTopLevelBlock(blocks, 'x')).toBeUndefined();
	});
});
