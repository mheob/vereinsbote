import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	DropIndicator,
	GridList,
	GridListItem,
	Menu,
	MenuItem,
	MenuTrigger,
	Popover,
	Text,
	useDragAndDrop,
} from 'react-aria-components';
import type { DragAndDropOptions, DropTarget, Key, Selection } from 'react-aria-components';

import { DragIcon, MoreIcon } from '@/components/icons';
import { optionClass, popoverClass, secondaryButtonClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import type { Block } from '@/mail/blocks/block-schema';

import type { BlockType } from './block-factory';
import type { ColumnTarget } from './editor-state';
import type { EditorView } from './editor-view';

/** What `findIndex` gives for no match. */
const NOT_FOUND = -1;

/** The type of the dragged data: a block of this list, by id. */
const BLOCK_DRAG_TYPE = 'application/vnd.vereinsbote.block';

const rowClass =
	'flex items-center gap-2 border-b border-gray-300 px-2 py-1.5 outline-none last:border-b-0 data-dragging:opacity-50 data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700 data-selected:bg-blue-50';
const iconButtonClass =
	'flex size-8 shrink-0 items-center justify-center rounded-md border border-gray-600 data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-hovered:bg-gray-100';

const ROW_ACTIONS = ['up', 'down', 'duplicate', 'remove'] as const;
type RowAction = (typeof ROW_ACTIONS)[number];

const ROW_ACTION_LABELS = {
	down: 'editor.moveDown',
	duplicate: 'editor.duplicate',
	remove: 'editor.remove',
	up: 'editor.moveUp',
} as const;

/**
 * Whether a menu key is a row action.
 *
 * @param key The key.
 * @returns True for an action.
 */
function isRowAction(key: Key): key is RowAction {
	return (ROW_ACTIONS as readonly Key[]).includes(key);
}

/**
 * The menu of a row: up, down, duplicate, delete.
 *
 * @param props The props.
 * @param props.block The block.
 * @param props.index Its position in the list, from 0.
 * @param props.count The length of the list.
 * @param props.column The column of the list, or undefined at the top level.
 * @param props.line The line of the block, for the button's name.
 * @param props.view The editor's state and actions.
 * @returns The menu button.
 */
function RowMenu({
	block,
	column,
	count,
	index,
	line,
	view,
}: Readonly<{
	block: Block;
	index: number;
	count: number;
	column: ColumnTarget | undefined;
	line: string;
	view: EditorView;
}>): ReactNode {
	const t = useT();
	const { actions } = view;
	const disabledKeys = useMemo(() => {
		const keys: RowAction[] = [];
		if (index === 0) keys.push('up');
		if (index === count - 1) keys.push('down');
		if (!view.canAdd) keys.push('duplicate');
		return keys;
	}, [count, index, view.canAdd]);
	const onAction = useCallback(
		(key: Key) => {
			if (!isRowAction(key)) return;
			if (key === 'up') actions.move(block.id, index - 1, column);
			if (key === 'down') actions.move(block.id, index + 1, column);
			if (key === 'duplicate') actions.duplicate(block.id);
			if (key === 'remove') actions.remove(block.id);
		},
		[actions, block.id, column, index],
	);
	return (
		<MenuTrigger>
			<Button aria-label={t('editor.blockActions', { block: line })} className={iconButtonClass}>
				<MoreIcon />
			</Button>
			<Popover className={popoverClass} placement="bottom end">
				<Menu className="outline-none" disabledKeys={disabledKeys} onAction={onAction}>
					{ROW_ACTIONS.map((key) => (
						<MenuItem className={`${optionClass} data-disabled:text-gray-500`} id={key} key={key}>
							{t(ROW_ACTION_LABELS[key])}
						</MenuItem>
					))}
				</Menu>
			</Popover>
		</MenuTrigger>
	);
}

/**
 * The menu „Baustein hinzufügen“ below a list: every type the list may hold. At the limit of
 * blocks it says so instead.
 *
 * @param props The props.
 * @param props.label The label of the button.
 * @param props.types The types to offer.
 * @param props.column The column of the list, or undefined at the top level.
 * @param props.view The editor's state and actions.
 * @returns The menu.
 */
function AddBlockMenu({
	column,
	label,
	types,
	view,
}: Readonly<{
	label: string;
	types: readonly BlockType[];
	column: ColumnTarget | undefined;
	view: EditorView;
}>): ReactNode {
	const t = useT();
	const { actions } = view;
	const onAction = useCallback(
		(key: Key) => {
			const type = types.find((candidate) => candidate === key);
			if (type !== undefined) actions.add(type, column);
		},
		[actions, column, types],
	);
	if (!view.canAdd) return <p className="text-sm text-gray-700">{t('editor.tooManyBlocks')}</p>;
	return (
		<MenuTrigger>
			<Button className={`self-start ${secondaryButtonClass}`}>{label}</Button>
			<Popover className={popoverClass} placement="bottom start">
				<Menu className="outline-none" onAction={onAction}>
					{types.map((type) => (
						<MenuItem className={optionClass} id={type} key={type}>
							{t(`editor.blockType.${type}`)}
						</MenuItem>
					))}
				</Menu>
			</Popover>
		</MenuTrigger>
	);
}

/**
 * The blocks of the template or of one column, in order (Design 13). A block is chosen with a
 * click, Enter or Space; its form opens below the list. The order changes by drag and drop, with
 * the keyboard too (the handle of a row, Enter, arrow keys, Enter), or with „Nach oben“ and
 * „Nach unten“ in the row's menu. A block moves within its list only.
 *
 * @param props The props.
 * @param props.blocks The blocks of the list.
 * @param props.label The accessible name of the list.
 * @param props.column The column of the list, or undefined at the top level.
 * @param props.addLabel The label of the button that adds a block.
 * @param props.types The types the list may hold.
 * @param props.emptyText What an empty list says.
 * @param props.view The editor's state and actions.
 * @returns The list.
 */
export function BlockList({
	addLabel,
	blocks,
	column,
	emptyText,
	label,
	types,
	view,
}: Readonly<{
	blocks: readonly Block[];
	label: string;
	column: ColumnTarget | undefined;
	addLabel: string;
	types: readonly BlockType[];
	emptyText: string;
	view: EditorView;
}>): ReactNode {
	const { actions, isReadOnly, lineOf, problems, selectedId } = view;
	const t = useT();
	const lines = useMemo(
		() => new Map(blocks.map((block) => [block.id, lineOf(block)])),
		[blocks, lineOf],
	);
	const getItems = useCallback<NonNullable<DragAndDropOptions['getItems']>>(
		(keys) => [...keys].map((key) => ({ [BLOCK_DRAG_TYPE]: String(key) })),
		[],
	);
	const onReorder = useCallback<NonNullable<DragAndDropOptions['onReorder']>>(
		(event) => {
			const [id] = [...event.keys];
			if (typeof id !== 'string') return;
			const rest = blocks.filter((block) => block.id !== id);
			const target = rest.findIndex((block) => block.id === event.target.key);
			if (target === NOT_FOUND) return;
			actions.move(id, event.target.dropPosition === 'after' ? target + 1 : target, column);
		},
		[actions, blocks, column],
	);
	const renderDropIndicator = useCallback(
		// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- React Aria's drop target is a library type
		(target: DropTarget) => (
			<DropIndicator
				className="mx-2 h-0.5 rounded-full data-drop-target:bg-blue-700"
				target={target}
			/>
		),
		[],
	);
	const { dragAndDropHooks } = useDragAndDrop({ getItems, onReorder, renderDropIndicator });
	const selectedKeys = useMemo(
		() => (selectedId !== null && lines.has(selectedId) ? [selectedId] : []),
		[lines, selectedId],
	);
	const onSelectionChange = useCallback(
		(keys: Selection) => {
			const [first] = keys === 'all' ? [] : [...keys];
			if (typeof first === 'string') actions.select(first);
		},
		[actions],
	);
	const onAction = useCallback(
		(key: Key) => {
			if (typeof key === 'string') actions.select(key);
		},
		[actions],
	);
	const emptyState = useCallback(
		() => <p className="px-2 py-1.5 text-gray-700">{emptyText}</p>,
		[emptyText],
	);
	return (
		<div
			className="flex flex-col gap-2"
			data-block-list={column === undefined ? 'top' : `${column.parentId}.${column.side}`}
		>
			<GridList
				aria-label={label}
				className="rounded-md border border-gray-600 bg-white"
				disallowEmptySelection
				dragAndDropHooks={isReadOnly ? undefined : dragAndDropHooks}
				onAction={onAction}
				onSelectionChange={onSelectionChange}
				renderEmptyState={emptyState}
				selectedKeys={selectedKeys}
				selectionMode="single"
			>
				{blocks.map((block, index) => {
					const line = lines.get(block.id) ?? '';
					return (
						<GridListItem className={rowClass} id={block.id} key={block.id} textValue={line}>
							{isReadOnly ? null : (
								<Button className={iconButtonClass} slot="drag">
									<DragIcon />
								</Button>
							)}
							<span className="min-w-0 flex-1 truncate">{line}</span>
							{problems.blockIds.has(block.id) ? (
								<Text className="text-sm font-semibold text-red-700" slot="description">
									{t('editor.blockProblem')}
								</Text>
							) : null}
							{isReadOnly ? null : (
								<RowMenu
									block={block}
									column={column}
									count={blocks.length}
									index={index}
									line={line}
									view={view}
								/>
							)}
						</GridListItem>
					);
				})}
			</GridList>
			{isReadOnly ? null : (
				<AddBlockMenu column={column} label={addLabel} types={types} view={view} />
			)}
		</div>
	);
}
