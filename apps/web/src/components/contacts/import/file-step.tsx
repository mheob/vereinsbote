import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
	Button,
	DropZone,
	FileTrigger,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
	Text,
} from 'react-aria-components';
import type { FileDropItem, FileTriggerProps, Key } from 'react-aria-components';

import { ChevronIcon } from '@/components/icons';
import {
	optionClass,
	popoverClass,
	primaryButtonClass,
	selectButtonClass,
} from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { useT } from '@/i18n/use-t';

import type { SheetData } from './build-payload';
import type { Message } from './import-messages';
import { readImportFile } from './read-file';
import type { SheetChoice } from './read-file';

/** A read file: its name and the sheet to import. */
type ReadFile = Readonly<{ name: string; sheet: SheetData }>;

/** The file chooser offers CSV and XLSX files; the reader checks the name again. */
const ACCEPTED_FILE_TYPES = [
	'.csv',
	'.xlsx',
	'text/csv',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const dropZoneClass =
	'flex flex-col items-start gap-3 rounded-md border-2 border-dashed border-gray-600 p-6 data-drop-target:border-blue-700 data-drop-target:bg-blue-50 data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700';

/** Why the last read failed, at the file or at the sheet select; `id` makes a repeat new. */
type ReadError = Readonly<{ at: 'file' | 'sheet'; id: number; message: Message }> | null;

/** A workbook with several sheets while the user chooses one; `read` is the chosen sheet. */
type Workbook = Readonly<{
	file: File;
	sheetNames: readonly string[];
	sheetName: string | null;
	read: ReadFile | null;
}> | null;

/**
 * The sheet select of a workbook with several sheets, and „Weiter zur Zuordnung“ once a sheet
 * could be read. An empty sheet keeps the select, so the user can choose another one.
 *
 * @param props The props.
 * @param props.buttonRef The select's button, focused when the select appears.
 * @param props.error The error of the last choice and its number, if any.
 * @param props.onChoose Reads the chosen sheet.
 * @param props.onContinue Goes on with the read sheet.
 * @param props.workbook The workbook.
 * @returns The select.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a ref and a File are mutable handles by design
function SheetChoiceFields({
	buttonRef,
	error,
	onChoose,
	onContinue,
	workbook,
}: Readonly<{
	buttonRef: RefObject<HTMLButtonElement | null>;
	error: Readonly<{ id: number; text: string }> | null;
	onChoose: (sheetName: string) => void;
	onContinue: (file: ReadFile) => void;
	workbook: NonNullable<Workbook>;
}>): ReactNode {
	const t = useT();
	const errorId = useId();
	const onChange = useCallback(
		(key: Key | null) => {
			if (typeof key === 'string') onChoose(key);
		},
		[onChoose],
	);
	const { read } = workbook;
	const next = useCallback(() => {
		if (read !== null) onContinue(read);
	}, [onContinue, read]);
	return (
		<div className="flex max-w-md flex-col gap-4">
			<p>{t('import.fileName', { name: workbook.file.name })}</p>
			<Select
				aria-describedby={error === null ? undefined : errorId}
				className="flex flex-col gap-1"
				isInvalid={error !== null}
				onChange={onChange}
				value={workbook.sheetName}
			>
				<Label className="font-semibold">{t('import.sheet')}</Label>
				<Button className={selectButtonClass} ref={buttonRef}>
					<SelectValue />
					<ChevronIcon />
				</Button>
				<Text className="text-sm text-gray-700" slot="description">
					{t('import.sheetsFound')}
				</Text>
				<Popover className={popoverClass}>
					<ListBox className="max-h-80 overflow-auto outline-none">
						{workbook.sheetNames.map((name) => (
							<ListBoxItem className={optionClass} id={name} key={name}>
								{name}
							</ListBoxItem>
						))}
					</ListBox>
				</Popover>
			</Select>
			{error === null ? null : (
				// The read ends after the focus is back on the select: an alert has the error read out.
				<p className="text-sm text-red-700" id={errorId} key={error.id} role="alert">
					{error.text}
				</p>
			)}
			{read === null ? null : (
				<div>
					<Button className={primaryButtonClass} onPress={next}>
						{t('import.toMapping')}
					</Button>
				</div>
			)}
		</div>
	);
}

/**
 * Step 1: the file. Dropped or chosen with „Datei auswählen“ (both work with the keyboard), read
 * in the browser only. A workbook with several sheets asks for the sheet first; any other file
 * goes on to the mapping once it is read. Why a file cannot be imported shows at the field.
 *
 * @param props The props.
 * @param props.onRead Goes on with the read file.
 * @returns The step.
 */
export function FileStep({ onRead }: Readonly<{ onRead: (file: ReadFile) => void }>): ReactNode {
	const t = useT();
	const helpId = useId();
	const errorId = useId();
	const sheetButtonRef = useRef<HTMLButtonElement>(null);
	const [isPending, startPending] = useTransition();
	const [error, setError] = useState<ReadError>(null);
	const [workbook, setWorkbook] = useState<Workbook>(null);
	const [sheetFocus, setSheetFocus] = useState(0);
	// Until hydration a press would open no file chooser: the button is pending, like `SubmitButton`.
	const hydrated = useHydrated();
	const read = useCallback(
		async (file: File, choice?: SheetChoice) => {
			const outcome = await readImportFile(file, choice);
			const at = choice === undefined ? 'file' : 'sheet';
			if (outcome.ok) setError(null);
			else {
				setError((previous) => ({ at, id: (previous?.id ?? 0) + 1, message: outcome.message }));
			}
			const readFile = outcome.ok ? { name: outcome.name, sheet: outcome.sheet } : null;
			if (outcome.sheetNames.length <= 1) {
				setWorkbook(null);
				if (readFile !== null) onRead(readFile);
				return;
			}
			const sheetName = outcome.ok ? outcome.sheetName : (choice?.sheetName ?? null);
			setWorkbook({ file, read: readFile, sheetName, sheetNames: outcome.sheetNames });
			// The select appears: the focus goes there, so its description is read.
			if (choice === undefined) setSheetFocus((count) => count + 1);
		},
		[onRead],
	);
	useEffect(() => {
		if (sheetFocus > 0) sheetButtonRef.current?.focus();
	}, [sheetFocus]);
	const onSelect = useCallback<NonNullable<FileTriggerProps['onSelect']>>(
		(files) => {
			const file = files?.item(0);
			if (file !== null && file !== undefined) startPending(async () => read(file));
		},
		[read],
	);
	const onDrop = useCallback(
		(event: Readonly<{ items: readonly Readonly<{ kind: string }>[] }>) => {
			const item = event.items.find((entry): entry is FileDropItem => entry.kind === 'file');
			if (item !== undefined) startPending(async () => read(await item.getFile()));
		},
		[read],
	);
	const onChooseSheet = useCallback(
		(sheetName: string) => {
			if (workbook === null) return;
			const choice = { sheetName, sheetNames: workbook.sheetNames };
			startPending(async () => read(workbook.file, choice));
		},
		[read, workbook],
	);
	const fileError = error?.at === 'file' ? error : null;
	const sheetError = useMemo(
		() =>
			error?.at === 'sheet'
				? { id: error.id, text: t(error.message.key, error.message.params) }
				: null,
		[error, t],
	);
	const getDropOperation = useCallback(() => 'copy' as const, []);
	return (
		<div className="flex flex-col gap-4">
			<p id={helpId}>{t('import.fileHelp')}</p>
			<DropZone className={dropZoneClass} getDropOperation={getDropOperation} onDrop={onDrop}>
				<Text slot="label">{t('import.dropZone')}</Text>
				<FileTrigger acceptedFileTypes={ACCEPTED_FILE_TYPES} onSelect={onSelect}>
					<Button
						aria-describedby={fileError === null ? helpId : `${errorId} ${helpId}`}
						className={primaryButtonClass}
						isPending={!hydrated || isPending}
					>
						{t('import.chooseFile')}
					</Button>
				</FileTrigger>
				{isPending ? <p>{t('import.reading')}</p> : null}
			</DropZone>
			{fileError === null ? null : (
				// An alert of its own, at the field: the status region of the page tells the steps.
				<p className="text-red-700" id={errorId} key={fileError.id} role="alert">
					{t(fileError.message.key, fileError.message.params)}
				</p>
			)}
			{workbook === null ? null : (
				<SheetChoiceFields
					buttonRef={sheetButtonRef}
					error={sheetError}
					onChoose={onChooseSheet}
					onContinue={onRead}
					workbook={workbook}
				/>
			)}
		</div>
	);
}

export type { ReadFile };
