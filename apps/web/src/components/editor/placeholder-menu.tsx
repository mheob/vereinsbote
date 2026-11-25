import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
	Button,
	Dialog,
	Heading,
	Input,
	Label,
	ListBox,
	ListBoxItem,
	Modal,
	ModalOverlay,
	RadioButton,
	RadioField,
	RadioGroup,
	Text,
	TextField,
} from 'react-aria-components';
import type { Selection } from 'react-aria-components';

import { PostForm } from '@/components/post-form';
import { inputClass, optionClass, secondaryButtonClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import type { SubmitHandler } from '@/components/use-form-submit';
import { useT } from '@/i18n/use-t';
import type { PlaceholderRef } from '@/mail/placeholders/syntax';
import { placeholderLabel } from '@/server/templates/editor-placeholders';
import type {
	EditorPlaceholder,
	EditorPlaceholderGroup,
} from '@/server/templates/editor-placeholders';

/** What happens when the value is missing: required, empty or a fallback text. */
type MissingMode = 'required' | 'empty' | 'text';

const MODES: readonly MissingMode[] = ['required', 'empty', 'text'];
const GROUPS: readonly EditorPlaceholderGroup[] = ['contact', 'salutation', 'brand'];
/** The longest fallback the schema allows. */
const MAX_FALLBACK_LENGTH = 200;

const MODE_LABELS = {
	empty: ['editor.missing.empty', 'editor.missing.emptyHelp'],
	required: ['editor.missing.required', 'editor.missing.requiredHelp'],
	text: ['editor.missing.text', 'editor.missing.textHelp'],
} as const;

const GROUP_LABELS = {
	brand: 'editor.placeholderGroup.brand',
	contact: 'editor.placeholderGroup.contact',
	salutation: 'editor.placeholderGroup.salutation',
} as const;

const radioClass = 'flex items-center gap-2';

/**
 * The mode of a fallback.
 *
 * @param fallback The fallback: null for required, `''` for empty, else a text.
 * @returns The mode.
 */
function modeOf(fallback: string | null): MissingMode {
	if (fallback === null) return 'required';
	return fallback === '' ? 'empty' : 'text';
}

/**
 * The fallback of a mode.
 *
 * @param mode The mode.
 * @param text The fallback text for `text`.
 * @returns The fallback of the placeholder.
 */
function fallbackOf(mode: MissingMode, text: string): string | null {
	if (mode === 'required') return null;
	return mode === 'empty' ? '' : text;
}

/**
 * Whether a key names a mode.
 *
 * @param key The key of the radio group.
 * @returns True for a mode.
 */
function isMode(key: string): key is MissingMode {
	return (MODES as readonly string[]).includes(key);
}

/**
 * One choice with a description below its label.
 *
 * @param props The props.
 * @param props.value The value.
 * @param props.label The label.
 * @param props.help The description.
 * @returns The radio.
 */
function ModeChoice({
	help,
	label,
	value,
}: Readonly<{ value: string; label: string; help: string }>): ReactNode {
	return (
		<RadioField className="flex flex-col gap-0.5" value={value}>
			<RadioButton className={radioClass}>
				{({ isFocusVisible, isSelected }) => (
					<>
						<span
							className={`size-5 rounded-full border-2 ${isSelected ? 'border-blue-700 bg-blue-700 shadow-[inset_0_0_0_3px_white]' : 'border-gray-600'} ${isFocusVisible ? 'outline-2 outline-offset-2 outline-blue-700' : ''}`}
						/>
						{label}
					</>
				)}
			</RadioButton>
			<Text className="ml-7 text-sm text-gray-700" slot="description">
				{help}
			</Text>
		</RadioField>
	);
}

/**
 * One group of placeholders (contact, salutation, club) as a list of its own below a heading.
 * The groups share one choice: the list that does not hold the chosen key shows none.
 *
 * @param props The props.
 * @param props.items The placeholders of the group.
 * @param props.label The name of the group.
 * @param props.labelOf The name of a placeholder.
 * @param props.selectedKey The chosen key of all groups, or null.
 * @param props.onSelect Called with the key the user chose.
 * @param props.describedBy The id of the message that asks for a choice, or undefined.
 * @param props.listRef Receives the list, to focus it.
 * @returns The group.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the props hold a ref
function PlaceholderGroup({
	describedBy,
	items,
	label,
	labelOf,
	listRef,
	onSelect,
	selectedKey,
}: Readonly<{
	items: readonly EditorPlaceholder[];
	label: string;
	labelOf: (key: string) => string;
	selectedKey: string | null;
	onSelect: (key: string) => void;
	describedBy: string | undefined;
	listRef: RefObject<HTMLDivElement | null> | undefined;
}>): ReactNode {
	const headingId = useId();
	const selectedKeys = useMemo(
		() =>
			selectedKey !== null && items.some(({ key }) => key === selectedKey) ? [selectedKey] : [],
		[items, selectedKey],
	);
	const onSelectionChange = useCallback(
		(keys: Selection) => {
			const [first] = keys === 'all' ? [] : [...keys];
			if (typeof first === 'string') onSelect(first);
		},
		[onSelect],
	);
	return (
		<div className="flex flex-col gap-1">
			<h3 className="text-sm font-semibold text-gray-700" id={headingId}>
				{label}
			</h3>
			<ListBox
				aria-describedby={describedBy}
				aria-labelledby={headingId}
				className="rounded-md border border-gray-600 py-1 outline-none data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700"
				onSelectionChange={onSelectionChange}
				ref={listRef}
				selectedKeys={selectedKeys}
				selectionMode="single"
			>
				{items.map((entry) => (
					<ListBoxItem
						className={optionClass}
						id={entry.key}
						key={entry.key}
						textValue={labelOf(entry.key)}
					>
						{labelOf(entry.key)}
					</ListBoxItem>
				))}
			</ListBox>
		</div>
	);
}

/**
 * The form of the open dialog: the placeholder, grouped (contact, salutation, club), and what
 * happens when its value is missing.
 *
 * @param props The props.
 * @param props.initial The placeholder to change, or null to insert a new one.
 * @param props.onPick Called with the chosen placeholder.
 * @param props.placeholders The placeholders to offer.
 * @param props.submitLabel The label of the submit button.
 * @returns The form.
 */
function PlaceholderForm({
	initial,
	onPick,
	placeholders,
	submitLabel,
}: Readonly<{
	initial: Readonly<PlaceholderRef> | null;
	onPick: (ref: Readonly<PlaceholderRef>) => void;
	placeholders: readonly EditorPlaceholder[];
	submitLabel: string;
}>): ReactNode {
	const t = useT();
	const firstListRef = useRef<HTMLDivElement>(null);
	const missingId = useId();
	const [key, setKey] = useState<string | null>(initial?.key ?? null);
	const [mode, setMode] = useState<MissingMode>(modeOf(initial?.fallback ?? null));
	const [text, setText] = useState(initial?.fallback ?? '');
	const [missingKey, setMissingKey] = useState(false);
	const groups = useMemo(
		() =>
			GROUPS.map((group) => ({
				group,
				items: placeholders.filter((entry) => entry.group === group),
			})).filter(({ items }) => items.length > 0),
		[placeholders],
	);
	const labelOf = useCallback(
		(entry: string) => placeholderLabel(entry, placeholders, t),
		[placeholders, t],
	);
	const onSelect = useCallback((next: string) => {
		setKey(next);
		setMissingKey(false);
	}, []);
	const onModeChange = useCallback((value: string) => {
		if (isMode(value)) setMode(value);
	}, []);
	const submit = useCallback<SubmitHandler>(
		(event) => {
			event.preventDefault();
			if (key === null) {
				setMissingKey(true);
				firstListRef.current?.focus();
				return;
			}
			onPick({ fallback: fallbackOf(mode, text), key });
		},
		[key, mode, onPick, text],
	);
	const describedBy = missingKey ? missingId : undefined;
	return (
		<PostForm className="flex flex-col gap-4" onSubmit={submit}>
			{groups.map(({ group, items }) => (
				<PlaceholderGroup
					items={items}
					key={group}
					describedBy={describedBy}
					label={t(GROUP_LABELS[group])}
					labelOf={labelOf}
					listRef={group === groups[0]?.group ? firstListRef : undefined}
					onSelect={onSelect}
					selectedKey={key}
				/>
			))}
			{missingKey ? (
				<p className="text-sm text-red-700" id={missingId} role="alert">
					{t('editor.placeholderChoose')}
				</p>
			) : null}
			<RadioGroup className="flex flex-col gap-2" onChange={onModeChange} value={mode}>
				<Label className="font-semibold">{t('editor.missing')}</Label>
				{MODES.map((value) => (
					<ModeChoice
						help={t(MODE_LABELS[value][1])}
						key={value}
						label={t(MODE_LABELS[value][0])}
						value={value}
					/>
				))}
			</RadioGroup>
			{mode === 'text' ? (
				<TextField
					autoComplete="off"
					className="flex flex-col gap-1"
					isRequired
					maxLength={MAX_FALLBACK_LENGTH}
					onChange={setText}
					value={text}
				>
					<Label className="font-semibold">{t('editor.fallback')}</Label>
					<Input className={inputClass} />
				</TextField>
			) : null}
			<div className="flex justify-end gap-3">
				<Button className={secondaryButtonClass} slot="close">
					{t('templates.cancel')}
				</Button>
				<SubmitButton>{submitLabel}</SubmitButton>
			</div>
		</PostForm>
	);
}

/**
 * The dialog that chooses a placeholder and what happens when its value is missing (Design 10):
 * „Pflicht“ (no fallback), „Leer lassen“ (empty fallback) or „Text“ (a fallback text). Only the
 * placeholders the area allows are offered. React Aria keeps the focus inside and gives it back
 * to the button that opened the dialog.
 *
 * @param props The props.
 * @param props.initial The placeholder to change, or null to insert one.
 * @param props.isOpen Whether the dialog is open.
 * @param props.onOpenChange Called when the dialog wants to open or close.
 * @param props.onPick Called with the chosen placeholder; the dialog closes then.
 * @param props.placeholders The placeholders to offer.
 * @returns The dialog.
 */
export function PlaceholderDialog({
	initial,
	isOpen,
	onOpenChange,
	onPick,
	placeholders,
}: Readonly<{
	initial: Readonly<PlaceholderRef> | null;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onPick: (ref: Readonly<PlaceholderRef>) => void;
	placeholders: readonly EditorPlaceholder[];
}>): ReactNode {
	const t = useT();
	const pick = useCallback(
		(ref: Readonly<PlaceholderRef>) => {
			onPick(ref);
			onOpenChange(false);
		},
		[onOpenChange, onPick],
	);
	const title = t(initial === null ? 'editor.insertPlaceholder' : 'editor.changePlaceholder');
	return (
		<ModalOverlay
			className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
			isDismissable
			isOpen={isOpen}
			onOpenChange={onOpenChange}
		>
			<Modal className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
				<Dialog className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto outline-none">
					<Heading className="text-xl font-bold" slot="title">
						{title}
					</Heading>
					<PlaceholderForm
						initial={initial}
						onPick={pick}
						placeholders={placeholders}
						submitLabel={t(
							initial === null ? 'editor.placeholderInsert' : 'editor.placeholderApply',
						)}
					/>
				</Dialog>
			</Modal>
		</ModalOverlay>
	);
}
