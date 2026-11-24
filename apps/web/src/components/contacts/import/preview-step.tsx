import { useCallback, useId, useMemo, useRef, useState, useTransition } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
	Button,
	CheckboxButton,
	CheckboxField,
	CheckboxGroup,
	FieldError,
	Label,
	Text,
} from 'react-aria-components';
import type { FormProps } from 'react-aria-components';

import { CheckIcon } from '@/components/icons';
import { PostForm } from '@/components/post-form';
import { checkboxBoxClass, checkboxClass, secondaryButtonClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { useT } from '@/i18n/use-t';
import type { ContactKind } from '@/server/contacts/fields';
import type { MemberImportPreview } from '@/server/contacts/import/members';
import type { PartnerImportPreview } from '@/server/contacts/import/partners';
import { MAX_LISTED_ISSUES } from '@/server/contacts/import/plan';
import type { CustomFieldRecord } from '@/server/contacts/settings';

import {
	blockingMessage,
	changeText,
	countRows,
	fieldIssueReason,
	rowIssueMessage,
	withKeys,
} from './import-messages';
import type { KindPreview } from './import-messages';
import { LabelledCheckbox } from './labelled-checkbox';

/** What a confirm sends besides the payload. */
type ConfirmInput = Readonly<{ confirmedDeletions: number | null; deleteIds: readonly string[] }>;

const sectionTitleClass = 'text-lg font-semibold';
const headerCellClass = 'px-3 py-2 text-left font-semibold';
const cellClass = 'px-3 py-2';

/**
 * A note on the entries a list does not show.
 *
 * @param props The props.
 * @param props.count How many entries are not shown.
 * @returns The note, or nothing.
 */
function MoreNote({ count }: Readonly<{ count: number }>): ReactNode {
	const t = useT();
	return count > 0 ? <p className="text-gray-700">{t('import.more', { count })}</p> : null;
}

/**
 * What blocks the import: what to correct in the file or the mapping.
 *
 * @param props The props.
 * @param props.kind The contact kind.
 * @param props.preview The preview.
 * @returns The section.
 */
function BlockingIssues({
	kind,
	preview,
}: Readonly<{
	kind: ContactKind;
	preview: MemberImportPreview | PartnerImportPreview;
}>): ReactNode {
	const t = useT();
	const titleId = useId();
	const messages = withKeys(
		preview.blocking.slice(0, MAX_LISTED_ISSUES).map((issue) => blockingMessage(t, kind, issue)),
	);
	return (
		<section
			aria-labelledby={titleId}
			className="flex flex-col gap-2 border-l-4 border-red-700 bg-red-50 px-4 py-3"
		>
			<h3 className={sectionTitleClass} id={titleId}>
				{t('import.blockedTitle')}
			</h3>
			<p>{t('import.blockedText')}</p>
			<ul className="flex list-disc flex-col gap-1 pl-6">
				{messages.map(({ key, text }) => (
					<li key={key}>{text}</li>
				))}
			</ul>
			<MoreNote count={preview.blocking.length - messages.length} />
		</section>
	);
}

/**
 * The numbers of the preview as a table with a caption, one row per count.
 *
 * @param props The props.
 * @param props.result The preview and its kind.
 * @returns The table.
 */
function CountsTable({ result }: Readonly<{ result: KindPreview }>): ReactNode {
	const t = useT();
	return (
		<table className="w-auto border-collapse self-start">
			<caption className={`${sectionTitleClass} mb-2 text-left`}>
				{t(`import.countsCaption.${result.kind}`)}
			</caption>
			<thead className="border-b border-gray-600">
				<tr>
					<th className={headerCellClass} scope="col">
						{t('import.countKindHeader')}
					</th>
					<th className={`${headerCellClass} text-right`} scope="col">
						{t('import.countHeader')}
					</th>
				</tr>
			</thead>
			<tbody>
				{countRows(result).map(({ label, value }) => (
					<tr className="border-b border-gray-300" key={label}>
						<th
							className={`${cellClass} text-left font-normal ${label === 'import.count.removedExited' ? 'pl-8' : ''}`}
							scope="row"
						>
							{t(label)}
						</th>
						<td className={`${cellClass} text-right tabular-nums`}>{value}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

/**
 * The list of changes, folded: number and name per contact, the changed fields without values.
 *
 * @param props The props.
 * @param props.customFields The custom fields of the kind.
 * @param props.result The preview and its kind.
 * @returns The list, or nothing without changes.
 */
function ChangeList({
	customFields,
	result,
}: Readonly<{
	customFields: readonly Readonly<CustomFieldRecord>[];
	result: KindPreview;
}>): ReactNode {
	const t = useT();
	const { kind, preview } = result;
	const entries = withKeys(
		preview.changes.map((change) => changeText(t, { change, customFields, kind })),
	);
	if (entries.length === 0) return null;
	return (
		<details className="flex flex-col gap-2">
			<summary className="cursor-pointer font-semibold">
				{t('import.changesTitle', { count: entries.length + preview.moreChanges })}
			</summary>
			<ul className="mt-2 flex list-disc flex-col gap-1 pl-6">
				{entries.map(({ key, text }) => (
					<li key={key}>{text}</li>
				))}
			</ul>
			<MoreNote count={preview.moreChanges} />
		</details>
	);
}

/**
 * The field issues as a table: row, column and reason, never a value.
 *
 * @param props The props.
 * @param props.result The preview and its kind.
 * @returns The table, or nothing without issues.
 */
function FieldIssues({ result }: Readonly<{ result: KindPreview }>): ReactNode {
	const t = useT();
	const { fieldIssues, moreIssues } = result.preview;
	if (fieldIssues.length === 0) return null;
	return (
		<div className="flex flex-col gap-2 overflow-x-auto">
			<table className="w-auto border-collapse self-start">
				<caption className={`${sectionTitleClass} mb-2 text-left`}>
					{t(`import.issuesCaption.${result.kind}`)}
				</caption>
				<thead className="border-b border-gray-600">
					<tr>
						<th className={headerCellClass} scope="col">
							{t('import.issueLineHeader')}
						</th>
						<th className={headerCellClass} scope="col">
							{t('import.issueColumnHeader')}
						</th>
						<th className={headerCellClass} scope="col">
							{t('import.issueReasonHeader')}
						</th>
					</tr>
				</thead>
				<tbody>
					{fieldIssues.map(({ column, line, reason }) => (
						<tr className="border-b border-gray-300" key={`${line}:${column}`}>
							<td className={`${cellClass} tabular-nums`}>{line}</td>
							<td className={cellClass}>{column}</td>
							<td className={cellClass}>{fieldIssueReason(t, reason)}</td>
						</tr>
					))}
				</tbody>
			</table>
			<MoreNote count={moreIssues} />
		</div>
	);
}

/**
 * Partners: the cells that keep a stored value, folded, and the rows the import skips.
 *
 * @param props The props.
 * @param props.preview The partner preview.
 * @returns The lists, or nothing.
 */
function PartnerNotes({ preview }: Readonly<{ preview: PartnerImportPreview }>): ReactNode {
	const t = useT();
	const titleId = useId();
	const { keptValues, moreKeptValues, moreRowIssues, rowIssues } = preview;
	return (
		<>
			{rowIssues.length > 0 ? (
				<section aria-labelledby={titleId} className="flex flex-col gap-2">
					<h3 className={sectionTitleClass} id={titleId}>
						{t('import.rowIssuesTitle')}
					</h3>
					<ul className="flex list-disc flex-col gap-1 pl-6">
						{rowIssues.map((issue) => (
							<li key={`${issue.line}:${issue.reason}`}>{rowIssueMessage(t, issue)}</li>
						))}
					</ul>
					<MoreNote count={moreRowIssues} />
				</section>
			) : null}
			{keptValues.length > 0 ? (
				<details className="flex flex-col gap-2">
					<summary className="cursor-pointer font-semibold">
						{t('import.keptTitle', { count: keptValues.length + moreKeptValues })}
					</summary>
					<ul className="mt-2 flex list-disc flex-col gap-1 pl-6">
						{keptValues.map(({ column, line }) => (
							<li key={`${line}:${column}`}>{t('import.keptValue', { column, line })}</li>
						))}
					</ul>
					<MoreNote count={moreKeptValues} />
				</details>
			) : null}
		</>
	);
}

/**
 * Partners missing from the export: deleted only when ticked.
 *
 * @param props The props.
 * @param props.onChange Called with the ticked partners.
 * @param props.partners The partners missing from the export.
 * @param props.value The ticked partners.
 * @returns The checkbox group, or nothing.
 */
function NotInExport({
	onChange,
	partners,
	value,
}: Readonly<{
	onChange: (ids: readonly string[]) => void;
	partners: PartnerImportPreview['notInExport'];
	value: readonly string[];
}>): ReactNode {
	const t = useT();
	const ticked = useMemo(() => [...value], [value]);
	if (partners.length === 0) return null;
	return (
		<CheckboxGroup className="flex flex-col gap-2" onChange={onChange} value={ticked}>
			<Label className={sectionTitleClass}>{t('import.notInExport')}</Label>
			<Text className="text-sm text-gray-700" slot="description">
				{t('import.notInExportHelp')}
			</Text>
			{partners.map(({ customerNumber, id, name }) => (
				<LabelledCheckbox
					key={id}
					label={[customerNumber, name.primary, name.secondary ?? ''].join(' ').trim()}
					value={id}
				/>
			))}
		</CheckboxGroup>
	);
}

/**
 * The confirmation of the deletions a member import needs above 20 % of the stock. Without the
 * tick, „Import bestätigen“ shows the error at the checkbox and moves the focus there.
 *
 * @param props The props.
 * @param props.deletions The number of members the import deletes.
 * @param props.inputRef The checkbox, for the focus.
 * @param props.isInvalid Whether the error shows.
 * @param props.isSelected Whether it is ticked.
 * @param props.onChange Called with the new state.
 * @returns The checkbox.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a ref is a mutable handle by design
function DeletionConfirmation({
	deletions,
	inputRef,
	isInvalid,
	isSelected,
	onChange,
}: Readonly<{
	deletions: number;
	inputRef: RefObject<HTMLInputElement | null>;
	isInvalid: boolean;
	isSelected: boolean;
	onChange: (isSelected: boolean) => void;
}>): ReactNode {
	const t = useT();
	const label =
		deletions === 1
			? t('import.confirmDeletionsOne')
			: t('import.confirmDeletions', { count: deletions });
	return (
		<CheckboxField
			className="flex flex-col gap-1"
			inputRef={inputRef}
			isInvalid={isInvalid}
			isSelected={isSelected}
			onChange={onChange}
		>
			<CheckboxButton className={`${checkboxClass} font-semibold`}>
				{({ isSelected: checked }) => (
					<>
						<span className={checkboxBoxClass}>{checked ? <CheckIcon /> : null}</span>
						{label}
					</>
				)}
			</CheckboxButton>
			<FieldError className="text-sm text-red-700">
				{t('import.confirmDeletionsRequired')}
			</FieldError>
		</CheckboxField>
	);
}

/**
 * The preview of a file without blocking issues and its confirmation: the counts, the changes,
 * the field issues, for partners the skipped rows, the kept values and the partners missing from
 * the export, for members the confirmation of many deletions.
 *
 * @param props The props.
 * @param props.customFields The custom fields of the kind.
 * @param props.onBack Goes back to the mapping.
 * @param props.onConfirm Confirms the import.
 * @param props.result The preview and its kind.
 * @returns The form.
 */
function ConfirmForm({
	customFields,
	onBack,
	onConfirm,
	result,
}: Readonly<{
	customFields: readonly Readonly<CustomFieldRecord>[];
	onBack: () => void;
	onConfirm: (input: ConfirmInput) => Promise<void>;
	result: KindPreview;
}>): ReactNode {
	const t = useT();
	const confirmRef = useRef<HTMLInputElement>(null);
	const [isPending, startPending] = useTransition();
	const [confirmed, setConfirmed] = useState(false);
	const [showError, setShowError] = useState(false);
	const [deleteIds, setDeleteIds] = useState<readonly string[]>([]);
	const confirmation = result.kind === 'member' ? result.preview.confirmation : null;
	const required = confirmation?.required === true;
	const onConfirmed = useCallback((isSelected: boolean) => {
		setConfirmed(isSelected);
		if (isSelected) setShowError(false);
	}, []);
	const refuse = useCallback(() => {
		setShowError(true);
		confirmRef.current?.focus();
	}, []);
	const onSubmit = useCallback<NonNullable<FormProps['onSubmit']>>(
		(event) => {
			event.preventDefault();
			if (required && !confirmed) {
				refuse();
				return;
			}
			const input: ConfirmInput = {
				confirmedDeletions: required ? confirmation.deletions : null,
				deleteIds,
			};
			startPending(async () => {
				await onConfirm(input);
			});
		},
		[confirmation, confirmed, deleteIds, onConfirm, refuse, required],
	);
	return (
		<PostForm className="flex flex-col gap-6" onSubmit={onSubmit}>
			<CountsTable result={result} />
			<ChangeList customFields={customFields} result={result} />
			<FieldIssues result={result} />
			{result.kind === 'partner' ? (
				<>
					<PartnerNotes preview={result.preview} />
					<NotInExport
						onChange={setDeleteIds}
						partners={result.preview.notInExport}
						value={deleteIds}
					/>
				</>
			) : null}
			{required ? (
				<DeletionConfirmation
					deletions={confirmation.deletions}
					inputRef={confirmRef}
					isInvalid={showError}
					isSelected={confirmed}
					onChange={onConfirmed}
				/>
			) : null}
			<div className="flex flex-wrap gap-3">
				<Button className={secondaryButtonClass} onPress={onBack}>
					{t('import.backToMapping')}
				</Button>
				<SubmitButton isPending={isPending}>{t('import.confirm')}</SubmitButton>
			</div>
		</PostForm>
	);
}

/**
 * Step 3: the preview. With blocking issues it says what to correct and offers no confirmation
 * (the counts of such a preview would read as „nothing changes“); otherwise it shows what the
 * import changes and confirms it.
 *
 * @param props The props.
 * @param props.customFields The custom fields of the kind.
 * @param props.filteredOut How many rows the filters left out.
 * @param props.onBack Goes back to the mapping.
 * @param props.onConfirm Confirms the import.
 * @param props.onOtherFile Goes back to the file.
 * @param props.result The preview and its kind.
 * @returns The step.
 */
export function PreviewStep({
	customFields,
	filteredOut,
	onBack,
	onConfirm,
	onOtherFile,
	result,
}: Readonly<{
	customFields: readonly Readonly<CustomFieldRecord>[];
	filteredOut: number;
	onBack: () => void;
	onConfirm: (input: ConfirmInput) => Promise<void>;
	onOtherFile: () => void;
	result: KindPreview;
}>): ReactNode {
	const t = useT();
	const blocked = result.preview.blocking.length > 0;
	return (
		<div className="flex flex-col gap-6">
			{filteredOut > 0 ? (
				<p>
					{filteredOut === 1
						? t('import.filteredOutOne')
						: t('import.filteredOut', { count: filteredOut })}
				</p>
			) : null}
			{blocked ? (
				<>
					<BlockingIssues kind={result.kind} preview={result.preview} />
					<div className="flex flex-wrap gap-3">
						<Button className={secondaryButtonClass} onPress={onBack}>
							{t('import.backToMapping')}
						</Button>
						<Button className={secondaryButtonClass} onPress={onOtherFile}>
							{t('import.otherFile')}
						</Button>
					</div>
				</>
			) : (
				<ConfirmForm
					customFields={customFields}
					onBack={onBack}
					onConfirm={onConfirm}
					result={result}
				/>
			)}
		</div>
	);
}

export type { ConfirmInput };
