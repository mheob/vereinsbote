/* oxlint-disable typescript/prefer-readonly-parameter-types -- the editor state holds the template input from zod, whose records are mutable */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { Announce } from '@/components/announcements';
import type { TemplateEditorPage } from '@/functions/templates';
import { useT } from '@/i18n/use-t';
import { MAX_BLOCKS } from '@/mail/blocks/block-schema';
import type { Block } from '@/mail/blocks/block-schema';
import type { TemplateInput, TemplateLayout } from '@/mail/templates/template-schema';
import type { EditorMedia } from '@/server/templates/editor-data';
import { placeholderLabel } from '@/server/templates/editor-placeholders';

import { duplicateBlock, newBlock } from './block-factory';
import type { BlockType } from './block-factory';
import { blockLine } from './block-summary';
import {
	countBlocks,
	createEditorState,
	editorBlocks,
	editorReducer,
	locateBlock,
	moveAnnouncement,
} from './editor-state';
import type { ColumnTarget, EditorAction, EditorState, SettingsPatch } from './editor-state';
import type { EditorActions, EditorView } from './editor-view';

/** The index of the last item, for `at`. */
const LAST = -1;

/** Called after a save with what was saved and the version the template got. */
type SavedHandler = (input: TemplateInput, version: number) => void;

/** What the template editor works with. */
interface EditorModel {
	readonly state: EditorState;
	/** The newest state, also between a change and the next render. */
	readonly stateRef: RefObject<EditorState>;
	readonly apply: (action: EditorAction) => EditorState;
	readonly blocks: readonly Block[];
	/** The blocks of the newest state. */
	readonly blocksNow: () => readonly Block[];
	readonly media: ReadonlyMap<string, EditorMedia>;
	readonly view: Omit<EditorView, 'problems'>;
	readonly setSettings: (patch: SettingsPatch) => void;
	readonly setLayout: (layout: TemplateLayout) => void;
	/** Opens a block's form and moves the focus to its heading. */
	readonly jumpTo: (blockId: string) => void;
	/** The name of a placeholder key. */
	readonly label: (key: string) => string;
}

/**
 * The input part of a loaded template.
 *
 * @param page What the editor loaded.
 * @returns Name, subject, preview text, salutation and body.
 */
function inputOf(page: TemplateEditorPage): TemplateInput {
	const { body, name, preheader, salutationForm, salutationTexts, subject } = page.template;
	return { body, name, preheader, salutationForm, salutationTexts, subject };
}

/**
 * Where a new block of a list goes: after the chosen block of the list, else at its end.
 *
 * @param blocks The blocks of the template.
 * @param column The list's column, or undefined for the top level.
 * @param selectedId The chosen block.
 * @returns The block to follow, or null for an empty list.
 */
function insertionPoint(
	blocks: readonly Block[],
	column: ColumnTarget | undefined,
	selectedId: string | null,
): string | null {
	const parent = column === undefined ? null : blocks.find(({ id }) => id === column.parentId);
	let list: readonly Block[] = blocks;
	if (parent?.type === 'columns' && column !== undefined) list = parent[column.side];
	if (selectedId !== null && list.some(({ id }) => id === selectedId)) return selectedId;
	return list.at(LAST)?.id ?? null;
}

/**
 * The selector of what gets the focus after a block was removed: its neighbour in the list, or
 * the list itself when it is empty now.
 *
 * @param siblings The list before the removal.
 * @param index The position of the removed block.
 * @param column The list's column, or null for the top level.
 * @returns The selector.
 */
function focusAfterRemoval(
	siblings: readonly Block[],
	index: number,
	column: ColumnTarget | null,
): string {
	const neighbour = siblings[index + 1] ?? siblings[index - 1];
	if (neighbour !== undefined) return `[role="row"][data-key="${CSS.escape(neighbour.id)}"]`;
	const list = column === null ? 'top' : `${column.parentId}.${column.side}`;
	return `[data-block-list="${CSS.escape(list)}"] [role="grid"]`;
}

/**
 * The state of the block editor and the actions of its lists and forms. Every change is applied
 * at once to a ref as well, so an announcement can say where a block ended up.
 *
 * @param options The options.
 * @param options.page What the editor loaded.
 * @param options.isReadOnly Whether the editor is read-only.
 * @param options.announce Announces in the page's live region.
 * @param options.setPendingFocus Asks for the focus on an element, by selector.
 * @returns The model.
 */
export function useEditorModel({
	announce,
	isReadOnly,
	page,
	setPendingFocus,
}: Readonly<{
	page: TemplateEditorPage;
	isReadOnly: boolean;
	announce: Announce;
	setPendingFocus: (selector: string | null) => void;
}>): EditorModel {
	const t = useT();
	const label = useCallback(
		(key: string) => placeholderLabel(key, page.placeholders, t),
		[page.placeholders, t],
	);
	const [state, setState] = useState(() => createEditorState(inputOf(page), page.template.version));
	const stateRef = useRef(state);
	const [media, setMedia] = useState<ReadonlyMap<string, EditorMedia>>(
		() => new Map(Object.entries(page.media)),
	);
	const apply = useCallback((action: EditorAction): EditorState => {
		const next = editorReducer(stateRef.current, action);
		stateRef.current = next;
		setState(next);
		return next;
	}, []);
	const blocksNow = useCallback(() => editorBlocks(stateRef.current), []);
	const typeName = useCallback((type: BlockType) => t(`editor.blockType.${type}`), [t]);
	const announcePlace = useCallback(
		(next: EditorState, id: string, key: 'editor.added' | 'editor.moved') => {
			const place = moveAnnouncement(next, id);
			if (place === null) return;
			const { blockType, position, total } = place;
			announce(t(key, { position, total, type: typeName(blockType) }), 'status');
		},
		[announce, t, typeName],
	);
	const actions = useMemo(
		(): EditorActions => ({
			add: (type, column) => {
				const before = stateRef.current;
				const block = newBlock(type);
				const afterId = insertionPoint(editorBlocks(before), column, before.selectedId);
				const next = apply({ afterId, block, column, type: 'add' });
				if (next !== before) announcePlace(next, block.id, 'editor.added');
			},
			addMedia: (id, info) => {
				setMedia((previous) => new Map([...previous, [id, info]]));
			},
			duplicate: (id) => {
				const location = locateBlock(editorBlocks(stateRef.current), id);
				if (location === null) return;
				const copy = duplicateBlock(location.block);
				const column = location.column ?? undefined;
				const next = apply({ afterId: id, block: copy, column, type: 'add' });
				announcePlace(next, copy.id, 'editor.added');
			},
			move: (id, toIndex, column) => {
				const before = stateRef.current;
				const next = apply({ column, id, toIndex, type: 'move' });
				if (next !== before) announcePlace(next, id, 'editor.moved');
			},
			remove: (id) => {
				const location = locateBlock(editorBlocks(stateRef.current), id);
				if (location === null) return;
				apply({ id, type: 'remove' });
				announce(t('editor.removed', { type: typeName(location.block.type) }), 'status');
				setPendingFocus(focusAfterRemoval(location.siblings, location.index, location.column));
			},
			select: (id) => {
				apply({ id, type: 'select' });
			},
			update: (block) => {
				apply({ block, type: 'update' });
			},
		}),
		[announce, announcePlace, apply, setPendingFocus, t, typeName],
	);
	const setSettings = useCallback(
		(patch: SettingsPatch) => {
			apply({ patch, type: 'settings' });
		},
		[apply],
	);
	const setLayout = useCallback(
		(layout: TemplateLayout) => {
			apply({ layout, type: 'layout' });
		},
		[apply],
	);
	const jumpTo = useCallback(
		(blockId: string) => {
			apply({ id: blockId, type: 'select' });
			setPendingFocus(`[data-block-form="${CSS.escape(blockId)}"]`);
		},
		[apply, setPendingFocus],
	);
	const blocks = editorBlocks(state);
	const lineOf = useCallback((block: Block) => blockLine(block, label, t), [label, t]);
	const view = useMemo(
		() => ({
			actions,
			areaId: page.template.areaId,
			canAdd: countBlocks(blocks) < MAX_BLOCKS,
			isReadOnly,
			lineOf,
			media,
			placeholders: page.placeholders,
			selectedId: state.selectedId,
		}),
		[
			actions,
			blocks,
			isReadOnly,
			lineOf,
			media,
			page.placeholders,
			page.template.areaId,
			state.selectedId,
		],
	);
	return {
		apply,
		blocks,
		blocksNow,
		jumpTo,
		label,
		media,
		setLayout,
		setSettings,
		state,
		stateRef,
		view,
	};
}

export type { SavedHandler };
