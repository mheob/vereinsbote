/* oxlint-disable typescript/prefer-readonly-parameter-types -- the editor state holds the template input from zod, whose records are mutable */
/*
 * The state of the block editor and its changes, as a reducer without React. Every change keeps
 * the template valid for the block schema: no two columns inside a column, at most
 * `MAX_BLOCKS` blocks. A change marks the template as changed (`dirty`); saving clears that unless
 * the template changed again while it was being saved.
 */
import { MAX_BLOCKS } from '@/mail/blocks/block-schema';
import type { Block, ColumnBlock, ColumnsBlock } from '@/mail/blocks/block-schema';
import { DEFAULT_SALUTATIONS, SALUTATION_CASES } from '@/mail/placeholders/salutation';
import type { SalutationForm } from '@/mail/placeholders/salutation';
import type { TemplateInput, TemplateLayout } from '@/mail/templates/template-schema';

interface EditorState {
	readonly input: TemplateInput;
	/** The version the template was loaded or last saved with. */
	readonly version: number;
	/** The block whose form is open. */
	readonly selectedId: string | null;
	/** Whether the template changed since it was loaded or saved. */
	readonly dirty: boolean;
}

/** One side of a columns block. */
interface ColumnTarget {
	readonly parentId: string;
	readonly side: 'left' | 'right';
}

type SettingsPatch = Partial<Omit<TemplateInput, 'body'>>;

type EditorAction =
	/** Adds a block after `afterId` (null: at the start) at the top level or into a column. */
	| { type: 'add'; block: Block; afterId: string | null; column?: ColumnTarget }
	/** Moves a block to `toIndex` of the top level or of a column. */
	| { type: 'move'; id: string; toIndex: number; column?: ColumnTarget }
	| { type: 'update'; block: Block }
	| { type: 'remove'; id: string }
	| { type: 'select'; id: string | null }
	| { type: 'settings'; patch: SettingsPatch }
	| { type: 'layout'; layout: TemplateLayout }
	/** `input`: what was sent; a template that changed since stays changed. */
	| { type: 'saved'; version: number; input?: TemplateInput };

/** Where a block stands: its list, its index there and, inside a column, which one. */
interface BlockLocation {
	readonly block: Block;
	readonly index: number;
	readonly siblings: readonly Block[];
	readonly column: ColumnTarget | null;
}

const SIDES = ['left', 'right'] as const;
/** What `findIndex` gives for no match. */
const NOT_FOUND = -1;

/**
 * The state of a template as it was loaded.
 *
 * @param input The template.
 * @param version Its version.
 * @returns The state: unchanged, nothing selected.
 */
function createEditorState(input: TemplateInput, version: number): EditorState {
	return { dirty: false, input, selectedId: null, version };
}

/**
 * The blocks of the template; none for an HTML template.
 *
 * @param state The state.
 * @returns The blocks.
 */
function editorBlocks(state: EditorState): readonly Block[] {
	return state.input.body.kind === 'blocks' ? state.input.body.blocks : [];
}

/**
 * The number of blocks, those in columns included.
 *
 * @param blocks The blocks.
 * @returns The count.
 */
function countBlocks(blocks: readonly Block[]): number {
	return blocks.reduce(
		(sum, block) =>
			sum + 1 + (block.type === 'columns' ? block.left.length + block.right.length : 0),
		0,
	);
}

/**
 * Finds a block in the two columns of a columns block.
 *
 * @param parent The columns block.
 * @param id The block.
 * @returns Where it stands, or null.
 */
function locateInColumns(parent: ColumnsBlock, id: string): BlockLocation | null {
	for (const side of SIDES) {
		const index = parent[side].findIndex((block) => block.id === id);
		const block = parent[side][index];
		if (block !== undefined) {
			return { block, column: { parentId: parent.id, side }, index, siblings: parent[side] };
		}
	}
	return null;
}

/**
 * Finds a block at the top level or in a column.
 *
 * @param blocks The blocks.
 * @param id The id.
 * @returns Where it stands, or null.
 */
function locateBlock(blocks: readonly Block[], id: string): BlockLocation | null {
	const index = blocks.findIndex((block) => block.id === id);
	const found = blocks[index];
	if (found !== undefined) return { block: found, column: null, index, siblings: blocks };
	for (const parent of blocks) {
		const inside = parent.type === 'columns' ? locateInColumns(parent, id) : null;
		if (inside !== null) return inside;
	}
	return null;
}

/**
 * Whether a block contains the selected block: it is selected, or it is the columns block that
 * holds it.
 *
 * @param block The block.
 * @param selectedId The selected block.
 * @returns True when removing the block removes the selection.
 */
function holdsSelection(block: Block, selectedId: string | null): boolean {
	if (selectedId === null) return false;
	if (block.id === selectedId) return true;
	return (
		block.type === 'columns' &&
		[...block.left, ...block.right].some((child) => child.id === selectedId)
	);
}

/**
 * A copy of a list with an item inserted.
 *
 * @param list The list.
 * @param index Where the item goes; kept inside the list.
 * @param item The item.
 * @returns The new list.
 */
function insertAt<T>(list: readonly T[], index: number, item: T): T[] {
	const at = Math.min(Math.max(index, 0), list.length);
	return [...list.slice(0, at), item, ...list.slice(at)];
}

/**
 * The index after a block of a list, or the start.
 *
 * @param list The list.
 * @param afterId The block to follow, null for the start.
 * @returns The index; the end when the block is not in the list.
 */
function indexAfter(list: readonly Block[], afterId: string | null): number {
	if (afterId === null) return 0;
	const index = list.findIndex((block) => block.id === afterId);
	return index === NOT_FOUND ? list.length : index + 1;
}

/**
 * Removes a block from wherever it stands.
 *
 * @param blocks The blocks.
 * @param id The block.
 * @returns The blocks without it.
 */
function without(blocks: readonly Block[], id: string): Block[] {
	const kept: Block[] = [];
	for (const block of blocks) {
		if (block.id !== id) {
			kept.push(
				block.type === 'columns'
					? {
							id: block.id,
							left: block.left.filter((child) => child.id !== id),
							right: block.right.filter((child) => child.id !== id),
							type: 'columns',
						}
					: block,
			);
		}
	}
	return kept;
}

/**
 * Puts a block into a list at an index: the top level or a side of a columns block.
 *
 * @param blocks The blocks.
 * @param block The block.
 * @param target The index and, for a column, which one.
 * @param target.index Where the block goes in its list.
 * @param target.column The column, or undefined for the top level.
 * @returns The new blocks, or null when the target is no columns block or the block may not
 * stand in a column.
 */
function placeBlock(
	blocks: readonly Block[],
	block: Block,
	target: Readonly<{ index: number; column: ColumnTarget | undefined }>,
): Block[] | null {
	const { column, index } = target;
	if (column === undefined) return insertAt(blocks, index, block);
	if (block.type === 'columns') return null;
	const parent = blocks.find(
		(candidate): candidate is ColumnsBlock =>
			candidate.id === column.parentId && candidate.type === 'columns',
	);
	if (parent === undefined) return null;
	const changed: ColumnsBlock = {
		...parent,
		[column.side]: insertAt<ColumnBlock>(parent[column.side], index, block),
	};
	return blocks.map((candidate) => (candidate === parent ? changed : candidate));
}

/**
 * The list a block goes into.
 *
 * @param blocks The blocks.
 * @param column The column, or undefined for the top level.
 * @returns The list, or an empty list when the column does not exist.
 */
function targetList(blocks: readonly Block[], column: ColumnTarget | undefined): readonly Block[] {
	if (column === undefined) return blocks;
	const parent = blocks.find((block) => block.id === column.parentId);
	return parent?.type === 'columns' ? parent[column.side] : [];
}

/**
 * A state with new blocks, changed; unchanged when the blocks are null.
 *
 * @param state The state.
 * @param blocks The new blocks, or null for a refused change.
 * @param selectedId The selection afterwards.
 * @returns The new state.
 */
function withBlocks(
	state: EditorState,
	blocks: readonly Block[] | null,
	selectedId: string | null = state.selectedId,
): EditorState {
	const { body } = state.input;
	if (blocks === null || body.kind !== 'blocks') return state;
	return {
		...state,
		dirty: true,
		input: { ...state.input, body: { ...body, blocks } },
		selectedId,
	};
}

/**
 * Adds a block; refused beyond `MAX_BLOCKS` or for two columns inside a column.
 *
 * @param state The state.
 * @param action The action.
 * @returns The new state.
 */
function add(state: EditorState, action: Extract<EditorAction, { type: 'add' }>): EditorState {
	const blocks = editorBlocks(state);
	if (state.input.body.kind !== 'blocks') return state;
	if (countBlocks(blocks) + countBlocks([action.block]) > MAX_BLOCKS) return state;
	const index = indexAfter(targetList(blocks, action.column), action.afterId);
	const placed = placeBlock(blocks, action.block, { column: action.column, index });
	return withBlocks(state, placed, action.block.id);
}

/**
 * Moves a block to an index of the top level or of a column.
 *
 * @param state The state.
 * @param action The action.
 * @returns The new state.
 */
function move(state: EditorState, action: Extract<EditorAction, { type: 'move' }>): EditorState {
	const blocks = editorBlocks(state);
	const location = locateBlock(blocks, action.id);
	if (location === null) return state;
	const rest = without(blocks, action.id);
	return withBlocks(
		state,
		placeBlock(rest, location.block, { column: action.column, index: action.toIndex }),
	);
}

/**
 * Replaces a block wherever it stands; two columns never replace a block of a column.
 *
 * @param state The state.
 * @param block The changed block.
 * @returns The new state.
 */
function update(state: EditorState, block: Block): EditorState {
	const blocks = editorBlocks(state);
	const location = locateBlock(blocks, block.id);
	if (location === null) return state;
	if (location.column === null) {
		return withBlocks(
			state,
			blocks.map((candidate) => (candidate.id === block.id ? block : candidate)),
		);
	}
	if (block.type === 'columns') return state;
	return withBlocks(
		state,
		placeBlock(without(blocks, block.id), block, {
			column: location.column,
			index: location.index,
		}),
	);
}

/**
 * Removes a block and, when it held the selection, the selection.
 *
 * @param state The state.
 * @param id The block.
 * @returns The new state.
 */
function remove(state: EditorState, id: string): EditorState {
	const blocks = editorBlocks(state);
	const location = locateBlock(blocks, id);
	if (location === null) return state;
	const selectedId = holdsSelection(location.block, state.selectedId) ? null : state.selectedId;
	return withBlocks(state, without(blocks, id), selectedId);
}

/**
 * Sets the layout of a block template.
 *
 * @param state The state.
 * @param layout The layout.
 * @returns The new state.
 */
function setLayout(state: EditorState, layout: TemplateLayout): EditorState {
	const { body } = state.input;
	if (body.kind !== 'blocks') return state;
	return { ...state, dirty: true, input: { ...state.input, body: { ...body, layout } } };
}

/**
 * The changes that touch no block: the choice, the settings and the saved version.
 *
 * @param state The state.
 * @param action The change.
 * @returns The new state.
 */
function transition(
	state: EditorState,
	action: Extract<EditorAction, { type: 'select' | 'settings' | 'saved' }>,
): EditorState {
	if (action.type === 'select') return { ...state, selectedId: action.id };
	if (action.type === 'settings') {
		return { ...state, dirty: true, input: { ...state.input, ...action.patch } };
	}
	const dirty = action.input !== undefined && action.input !== state.input;
	return { ...state, dirty, version: action.version };
}

/**
 * Applies a change of the editor.
 *
 * @param state The state.
 * @param action The change.
 * @returns The new state; the same object when the change is refused.
 */
function editorReducer(state: EditorState, action: EditorAction): EditorState {
	if (action.type === 'select' || action.type === 'settings' || action.type === 'saved') {
		return transition(state, action);
	}
	switch (action.type) {
		case 'add': {
			return add(state, action);
		}
		case 'move': {
			return move(state, action);
		}
		case 'update': {
			return update(state, action.block);
		}
		case 'remove': {
			return remove(state, action.id);
		}
		case 'layout': {
			return setLayout(state, action.layout);
		}
		default: {
			return state;
		}
	}
}

/**
 * What the live region says after a block moved: its type and where it stands in its list.
 *
 * @param state The state after the move.
 * @param id The block.
 * @returns The type, the position (from 1) and the length of its list, or null for an unknown
 * block.
 */
function moveAnnouncement(
	state: EditorState,
	id: string,
): { blockType: Block['type']; position: number; total: number } | null {
	const location = locateBlock(editorBlocks(state), id);
	if (location === null) return null;
	return {
		blockType: location.block.type,
		position: location.index + 1,
		total: location.siblings.length,
	};
}

/**
 * The change of the salutation form. Texts that are the defaults of the old form become those of
 * the new one; texts the template changed stay.
 *
 * @param input The template.
 * @param form The new form.
 * @returns The patch for `settings`.
 */
function salutationFormPatch(input: TemplateInput, form: SalutationForm): SettingsPatch {
	const defaults = DEFAULT_SALUTATIONS[input.salutationForm];
	const isDefault = SALUTATION_CASES.every(
		(salutationCase) => input.salutationTexts[salutationCase] === defaults[salutationCase],
	);
	return {
		salutationForm: form,
		salutationTexts: isDefault ? DEFAULT_SALUTATIONS[form] : input.salutationTexts,
	};
}

export {
	countBlocks,
	createEditorState,
	editorBlocks,
	editorReducer,
	locateBlock,
	moveAnnouncement,
	salutationFormPatch,
};
export type { BlockLocation, ColumnTarget, EditorAction, EditorState, SettingsPatch };
