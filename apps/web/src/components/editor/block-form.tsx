import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Input, Label, RadioGroup, Text, TextField } from 'react-aria-components';

import { Choice } from '@/components/admin/brand/choice';
import { inputClass, secondaryButtonClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import type {
	Block,
	ButtonBlock,
	ColumnsBlock,
	HeadingBlock,
	PlaceholderLineBlock,
	SpacerBlock,
} from '@/mail/blocks/block-schema';
import type { InlineNode } from '@/mail/blocks/text-doc';
import type { PlaceholderRef } from '@/mail/placeholders/syntax';
import { placeholderLabel } from '@/server/templates/editor-placeholders';

import { COLUMN_BLOCK_TYPES } from './block-factory';
import { BlockList } from './block-list';
import { describePlaceholder } from './describe-placeholder';
import type { ColumnTarget } from './editor-state';
import type { EditorView } from './editor-view';
import { HrefField } from './href-field';
import { ImageFields } from './image-fields';
import { InlineEditor } from './inline-editor';
import { PlaceholderDialog } from './placeholder-menu';
import { TextBlockEditor } from './text-block-editor';

const LEVELS = ['1', '2', '3'] as const;
const SIZES = ['small', 'medium', 'large'] as const;
const ALIGNS = ['left', 'center'] as const;
/** The longest suffix the schema allows. */
const MAX_SUFFIX_LENGTH = 10;

const groupClass = 'flex flex-col gap-2';

/**
 * The fields of a heading: its level and its text.
 *
 * @param props The props.
 * @param props.block The heading.
 * @param props.view The editor's state and actions.
 * @returns The fields.
 */
function HeadingFields({
	block,
	view,
}: Readonly<{ block: HeadingBlock; view: EditorView }>): ReactNode {
	const t = useT();
	const { actions } = view;
	const changeLevel = useCallback(
		(value: string) => {
			const level = Number(value);
			if (level === 1 || level === 2 || level === 3) actions.update({ ...block, level });
		},
		[actions, block],
	);
	const changeText = useCallback(
		(content: readonly InlineNode[]) => {
			actions.update({ ...block, content });
		},
		[actions, block],
	);
	return (
		<>
			<RadioGroup
				className={groupClass}
				isReadOnly={view.isReadOnly}
				onChange={changeLevel}
				orientation="horizontal"
				value={String(block.level)}
			>
				<Label className="font-semibold">{t('editor.level')}</Label>
				<div className="flex flex-wrap gap-4">
					{LEVELS.map((level) => (
						<Choice key={level} label={t(`editor.level.${level}`)} value={level} />
					))}
				</div>
			</RadioGroup>
			<InlineEditor
				description={null}
				error={view.problems.byField.get(`content.${block.id}`) ?? null}
				focusKey={`content.${block.id}`}
				isReadOnly={view.isReadOnly}
				label={t('editor.headingText')}
				labels={view.placeholders}
				onChange={changeText}
				placeholders={view.placeholders}
				value={block.content}
			/>
		</>
	);
}

/**
 * The fields of a button: its label, its link and its alignment; the colour comes from the CD.
 *
 * @param props The props.
 * @param props.block The button.
 * @param props.view The editor's state and actions.
 * @returns The fields.
 */
function ButtonFields({
	block,
	view,
}: Readonly<{ block: ButtonBlock; view: EditorView }>): ReactNode {
	const t = useT();
	const { actions } = view;
	const changeLabel = useCallback(
		(label: readonly InlineNode[]) => {
			actions.update({ ...block, label });
		},
		[actions, block],
	);
	const changeHref = useCallback(
		(href: string) => {
			actions.update({ ...block, href });
		},
		[actions, block],
	);
	const changeAlign = useCallback(
		(value: string) => {
			const align = ALIGNS.find((candidate) => candidate === value);
			if (align !== undefined) actions.update({ ...block, align });
		},
		[actions, block],
	);
	return (
		<>
			<InlineEditor
				description={null}
				error={view.problems.byField.get(`content.${block.id}`) ?? null}
				focusKey={`content.${block.id}`}
				isReadOnly={view.isReadOnly}
				label={t('editor.buttonLabel')}
				labels={view.placeholders}
				onChange={changeLabel}
				placeholders={view.placeholders}
				value={block.label}
			/>
			<HrefField
				error={view.problems.byField.get(`href.${block.id}`) ?? null}
				focusKey={`href.${block.id}`}
				isReadOnly={view.isReadOnly}
				isRequired
				label={t('editor.buttonHref')}
				onChange={changeHref}
				value={block.href}
			/>
			<RadioGroup
				className={groupClass}
				isReadOnly={view.isReadOnly}
				onChange={changeAlign}
				orientation="horizontal"
				value={block.align}
			>
				<Label className="font-semibold">{t('editor.align')}</Label>
				<div className="flex flex-wrap gap-4">
					{ALIGNS.map((align) => (
						<Choice key={align} label={t(`editor.align.${align}`)} value={align} />
					))}
				</div>
			</RadioGroup>
		</>
	);
}

/**
 * The size of a spacer.
 *
 * @param props The props.
 * @param props.block The spacer.
 * @param props.view The editor's state and actions.
 * @returns The field.
 */
function SpacerFields({
	block,
	view,
}: Readonly<{ block: SpacerBlock; view: EditorView }>): ReactNode {
	const t = useT();
	const { actions } = view;
	const changeSize = useCallback(
		(value: string) => {
			const size = SIZES.find((candidate) => candidate === value);
			if (size !== undefined) actions.update({ ...block, size });
		},
		[actions, block],
	);
	return (
		<RadioGroup
			className={groupClass}
			isReadOnly={view.isReadOnly}
			onChange={changeSize}
			orientation="horizontal"
			value={block.size}
		>
			<Label className="font-semibold">{t('editor.size')}</Label>
			<div className="flex flex-wrap gap-4">
				{SIZES.map((size) => (
					<Choice key={size} label={t(`editor.size.${size}`)} value={size} />
				))}
			</div>
		</RadioGroup>
	);
}

/**
 * The fields of a placeholder line: the placeholder with its fallback, and the characters after
 * it (the comma of a salutation).
 *
 * @param props The props.
 * @param props.block The placeholder line.
 * @param props.view The editor's state and actions.
 * @returns The fields.
 */
function PlaceholderLineFields({
	block,
	view,
}: Readonly<{ block: PlaceholderLineBlock; view: EditorView }>): ReactNode {
	const t = useT();
	const { actions } = view;
	const [isOpen, setIsOpen] = useState(false);
	const open = useCallback(() => {
		setIsOpen(true);
	}, []);
	const pick = useCallback(
		(ref: Readonly<PlaceholderRef>) => {
			actions.update({ ...block, ref });
		},
		[actions, block],
	);
	const changeSuffix = useCallback(
		(suffix: string) => {
			actions.update({ ...block, suffix });
		},
		[actions, block],
	);
	const name = placeholderLabel(block.ref.key, view.placeholders, t);
	const error = view.problems.byField.get(`content.${block.id}`) ?? null;
	return (
		<>
			<div className="flex flex-col gap-2">
				<p>
					<span className="font-semibold">{`${t('editor.placeholder')}: `}</span>
					{describePlaceholder(block.ref, name, t)}
				</p>
				{view.isReadOnly ? null : (
					<Button
						className={`self-start ${secondaryButtonClass}`}
						data-problem-focus={`content.${block.id}`}
						onPress={open}
					>
						{t('editor.changePlaceholder')}
					</Button>
				)}
				{error === null ? null : <p className="text-sm text-red-700">{error}</p>}
			</div>
			<TextField
				autoComplete="off"
				className="flex flex-col gap-1"
				isReadOnly={view.isReadOnly}
				maxLength={MAX_SUFFIX_LENGTH}
				onChange={changeSuffix}
				value={block.suffix}
			>
				<Label className="font-semibold">{t('editor.suffix')}</Label>
				<Input className={`${inputClass} w-24`} />
				<Text className="text-sm text-gray-700" slot="description">
					{t('editor.suffixHelp')}
				</Text>
			</TextField>
			{view.isReadOnly ? null : (
				<PlaceholderDialog
					initial={block.ref}
					isOpen={isOpen}
					onOpenChange={setIsOpen}
					onPick={pick}
					placeholders={view.placeholders}
				/>
			)}
		</>
	);
}

/**
 * The two columns: a list of blocks each, and the form of the chosen block of a column.
 *
 * @param props The props.
 * @param props.block The columns block.
 * @param props.view The editor's state and actions.
 * @returns The fields.
 */
function ColumnsFields({
	block,
	view,
}: Readonly<{ block: ColumnsBlock; view: EditorView }>): ReactNode {
	const t = useT();
	const left = useMemo((): ColumnTarget => ({ parentId: block.id, side: 'left' }), [block.id]);
	const right = useMemo((): ColumnTarget => ({ parentId: block.id, side: 'right' }), [block.id]);
	const child = [...block.left, ...block.right].find(({ id }) => id === view.selectedId);
	return (
		<>
			<p className="text-sm text-gray-700">{t('editor.columnsHint')}</p>
			<div className="grid gap-4 xl:grid-cols-2">
				<BlockList
					addLabel={t('editor.addBlockLeft')}
					blocks={block.left}
					column={left}
					emptyText={t('editor.columnEmpty')}
					label={t('editor.columnLeft')}
					types={COLUMN_BLOCK_TYPES}
					view={view}
				/>
				<BlockList
					addLabel={t('editor.addBlockRight')}
					blocks={block.right}
					column={right}
					emptyText={t('editor.columnEmpty')}
					label={t('editor.columnRight')}
					types={COLUMN_BLOCK_TYPES}
					view={view}
				/>
			</div>
			{/* oxlint-disable-next-line no-use-before-define -- a columns block and the form of its child refer to each other */}
			{child === undefined ? null : <BlockForm block={child} key={child.id} view={view} />}
		</>
	);
}

/**
 * The fields of a block by its type.
 *
 * @param props The props.
 * @param props.block The block.
 * @param props.view The editor's state and actions.
 * @returns The fields.
 */
function BlockFields({ block, view }: Readonly<{ block: Block; view: EditorView }>): ReactNode {
	const t = useT();
	const { actions } = view;
	const changeText = useCallback(
		(doc: Extract<Block, { type: 'text' }>['doc']) => {
			if (block.type === 'text') actions.update({ ...block, doc });
		},
		[actions, block],
	);
	if (block.type === 'divider') return <p className="text-gray-700">{t('editor.dividerHint')}</p>;
	switch (block.type) {
		case 'heading': {
			return <HeadingFields block={block} view={view} />;
		}
		case 'text': {
			return (
				<TextBlockEditor
					error={view.problems.byField.get(`content.${block.id}`) ?? null}
					focusKey={`content.${block.id}`}
					isReadOnly={view.isReadOnly}
					label={t('editor.text')}
					onChange={changeText}
					placeholders={view.placeholders}
					value={block.doc}
				/>
			);
		}
		case 'image': {
			return <ImageFields block={block} view={view} />;
		}
		case 'button': {
			return <ButtonFields block={block} view={view} />;
		}
		case 'spacer': {
			return <SpacerFields block={block} view={view} />;
		}
		case 'placeholderLine': {
			return <PlaceholderLineFields block={block} view={view} />;
		}
		case 'columns': {
			return <ColumnsFields block={block} view={view} />;
		}
		default: {
			return null;
		}
	}
}

/**
 * The form of the chosen block below its list (Design 13). Its heading takes the focus when a
 * hint jumps to the block.
 *
 * @param props The props.
 * @param props.block The block.
 * @param props.view The editor's state and actions.
 * @returns The form.
 */
export function BlockForm({
	block,
	view,
}: Readonly<{ block: Block; view: EditorView }>): ReactNode {
	const t = useT();
	const headingId = `block-form-${block.id}`;
	return (
		<section
			aria-labelledby={headingId}
			className="flex flex-col gap-4 rounded-md border border-gray-600 p-4"
		>
			<h3
				className="text-lg font-semibold outline-none"
				data-block-form={block.id}
				id={headingId}
				tabIndex={-1}
			>
				{t('editor.blockForm', { type: t(`editor.blockType.${block.type}`) })}
			</h3>
			<BlockFields block={block} view={view} />
		</section>
	);
}
