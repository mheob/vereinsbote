import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	CheckboxGroup,
	FieldError,
	Input,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
	Text,
	TextField,
} from 'react-aria-components';
import type { FormProps, Key } from 'react-aria-components';

import { ChevronIcon } from '@/components/icons';
import { PostForm } from '@/components/post-form';
import {
	inputClass,
	optionClass,
	popoverClass,
	secondaryButtonClass,
	selectButtonClass,
} from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import type { MessageKey } from '@/i18n/translate';
import { useLocale, useT } from '@/i18n/use-t';
import { CONTACT_FIELDS, CUSTOM_FIELD_TYPES, GENDERS } from '@/server/contacts/fields';
import type { ContactKind, Gender } from '@/server/contacts/fields';
import {
	MAX_CUSTOM_FIELD_NAME_LENGTH,
	MAX_EMPTY_MARKERS,
	MAX_FILTER_RULES,
	MAX_MARKER_LENGTH,
	mappingChanges,
} from '@/server/contacts/import/mapping';
import type {
	ColumnTarget,
	FilterRule,
	ImportOptions,
	SavedMapping,
} from '@/server/contacts/import/mapping';
import { cleanText } from '@/server/contacts/import/values';
import type { CustomFieldRecord } from '@/server/contacts/settings';

import { genderChoices, sampleValues } from './build-payload';
import type { GenderChoice, MappingDraft } from './build-payload';
import type { ReadFile } from './file-step';
import { LabelledCheckbox } from './labelled-checkbox';
import {
	formatEmptyMarkers,
	missingFilterColumns,
	parseEmptyMarkers,
	targetKey,
	targetOfKey,
} from './mapping-draft';

type NewCustomField = Extract<ColumnTarget, { type: 'newCustomField' }>;

/** A filter rule with a key that stays when rules before it go. */
type FilterRow = Readonly<{ key: number; rule: FilterRule }>;

/** An option of a select. */
type Option = Readonly<{ id: string; label: string }>;

/** A problem of the last „Weiter zur Vorschau“; `id` makes a repeat new. */
type Problem = Readonly<{ id: number; key: MessageKey }> | null;

/** What the mapping step edits; `options.emptyMarkers` is the last valid list of `markersText`. */
type MappingForm = Readonly<{
	columns: MappingDraft['columns'];
	rows: readonly FilterRow[];
	options: ImportOptions;
	markersText: string;
}>;

const headerCellClass = 'px-3 py-2 text-left align-top font-semibold';
const cellClass = 'px-3 py-2 align-top';
const legendClass = 'mb-2 text-lg font-semibold';
const fieldClass = 'flex flex-col gap-1';
/** Long sample values are cut, so the table stays readable. */
const SAMPLE_LENGTH = 60;
const DISCARD: ColumnTarget = { type: 'discard' };
const NO_SAMPLES: readonly string[] = [];
const SEPARATORS = [
	{ label: 'import.separator.comma', value: ',' },
	{ label: 'import.separator.semicolon', value: ';' },
] as const;

/**
 * A sample value as the table shows it.
 *
 * @param value The value.
 * @returns The value, cut after `SAMPLE_LENGTH` characters.
 */
function shortSample(value: string): string {
	return value.length > SAMPLE_LENGTH ? `${value.slice(0, SAMPLE_LENGTH - 1)}…` : value;
}

/**
 * A select with options; the label is visible unless `hiddenLabel`.
 *
 * @param props The props.
 * @param props.hiddenLabel Whether the label is for screen readers only.
 * @param props.label The label.
 * @param props.onChange Called with the chosen key.
 * @param props.options The options.
 * @param props.placeholder What shows without a value.
 * @param props.value The key of the chosen option, or null.
 * @returns The select.
 */
function OptionSelect({
	hiddenLabel = false,
	label,
	onChange,
	options,
	placeholder,
	value,
}: Readonly<{
	hiddenLabel?: boolean;
	label: string;
	onChange: (key: Key | null) => void;
	options: readonly Option[];
	placeholder?: string;
	value: string | null;
}>): ReactNode {
	return (
		<Select className={fieldClass} onChange={onChange} placeholder={placeholder} value={value}>
			<Label className={hiddenLabel ? 'sr-only' : 'font-semibold'}>{label}</Label>
			<Button className={selectButtonClass}>
				<SelectValue />
				<ChevronIcon />
			</Button>
			<Popover className={popoverClass}>
				<ListBox className="max-h-80 overflow-auto outline-none">
					{options.map((option) => (
						<ListBoxItem className={optionClass} id={option.id} key={option.id}>
							{option.label}
						</ListBoxItem>
					))}
				</ListBox>
			</Popover>
		</Select>
	);
}

/**
 * The name and the type of a new custom field.
 *
 * @param props The props.
 * @param props.header The column header.
 * @param props.onChange Called with the changed target.
 * @param props.target The new custom field.
 * @returns The fields.
 */
function NewFieldFields({
	header,
	onChange,
	target,
}: Readonly<{
	header: string;
	onChange: (target: NewCustomField) => void;
	target: NewCustomField;
}>): ReactNode {
	const t = useT();
	const typeOptions = useMemo(
		() => CUSTOM_FIELD_TYPES.map((type) => ({ id: type, label: t(`import.fieldType.${type}`) })),
		[t],
	);
	const onName = useCallback(
		(name: string) => {
			onChange({ ...target, name });
		},
		[onChange, target],
	);
	const onType = useCallback(
		(key: Key | null) => {
			const valueType = CUSTOM_FIELD_TYPES.find((type) => type === key);
			if (valueType !== undefined) onChange({ ...target, valueType });
		},
		[onChange, target],
	);
	const validateName = useCallback(
		(name: string) =>
			cleanText(name) === ''
				? t('import.newFieldNameInvalid', { max: MAX_CUSTOM_FIELD_NAME_LENGTH })
				: null,
		[t],
	);
	return (
		<>
			<TextField
				autoComplete="off"
				className={fieldClass}
				maxLength={MAX_CUSTOM_FIELD_NAME_LENGTH}
				onChange={onName}
				validate={validateName}
				value={target.name}
			>
				<Label className="font-semibold">{t('import.newFieldName', { column: header })}</Label>
				<Input className={inputClass} />
				<FieldError className="text-sm text-red-700" />
			</TextField>
			<OptionSelect
				label={t('import.newFieldType', { column: header })}
				onChange={onType}
				options={typeOptions}
				value={target.valueType}
			/>
		</>
	);
}

/**
 * One column of the file: its header, up to three sample values (only in the browser) and its
 * target, „{Spalte} zuordnen“.
 *
 * @param props The props.
 * @param props.header The column header.
 * @param props.kind The contact kind.
 * @param props.onChange Called with the column's new target.
 * @param props.options The targets to choose from.
 * @param props.samples The sample values.
 * @param props.target The column's target.
 * @returns The row.
 */
function ColumnRow({
	header,
	kind,
	onChange,
	options,
	samples,
	target,
}: Readonly<{
	header: string;
	kind: ContactKind;
	onChange: (header: string, target: ColumnTarget) => void;
	options: readonly Option[];
	samples: readonly string[];
	target: ColumnTarget;
}>): ReactNode {
	const t = useT();
	const onTarget = useCallback(
		(key: Key | null) => {
			const next =
				typeof key === 'string' ? targetOfKey(key, { current: target, header, kind }) : null;
			if (next !== null) onChange(header, next);
		},
		[header, kind, onChange, target],
	);
	const onNewField = useCallback(
		(next: NewCustomField) => {
			onChange(header, next);
		},
		[header, onChange],
	);
	return (
		<tr className="border-b border-gray-300">
			<th className={headerCellClass} scope="row">
				{header}
			</th>
			<td className={cellClass}>
				{samples.length === 0 ? (
					<span className="text-gray-700">{t('import.noSamples')}</span>
				) : (
					<ul className="flex flex-col gap-1 wrap-break-word">
						{samples.map((sample) => (
							<li key={sample}>{shortSample(sample)}</li>
						))}
					</ul>
				)}
			</td>
			<td className={cellClass}>
				<div className="flex min-w-56 flex-col gap-2">
					<OptionSelect
						hiddenLabel
						label={t('import.target', { column: header })}
						onChange={onTarget}
						options={options}
						value={targetKey(target)}
					/>
					{target.type === 'newCustomField' ? (
						<NewFieldFields header={header} onChange={onNewField} target={target} />
					) : null}
				</div>
			</td>
		</tr>
	);
}

/**
 * The hints above the mapping: whether the saved mapping was taken over or which columns are
 * missing or new, and filter rules whose column the file lacks.
 *
 * @param props The props.
 * @param props.filters The filter rules.
 * @param props.headers The column headers of the file.
 * @param props.savedMapping The mapping of the last import, or null.
 * @returns The hints.
 */
function MappingNotices({
	filters,
	headers,
	savedMapping,
}: Readonly<{
	filters: readonly FilterRule[];
	headers: readonly string[];
	savedMapping: SavedMapping | null;
}>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const changes =
		savedMapping === null ? { added: [], missing: [] } : mappingChanges(headers, savedMapping);
	// The saved mapping keeps no column order; the missing columns are named alphabetically.
	const missing = changes.missing.toSorted((a, b) => a.localeCompare(b, locale));
	const unchanged =
		savedMapping !== null && changes.missing.length === 0 && changes.added.length === 0;
	return (
		<div className="flex flex-col gap-2">
			<p>{t('import.mappingHelp')}</p>
			{unchanged ? <p>{t('import.savedMappingApplied')}</p> : null}
			{missing.length > 0 ? (
				<p className="font-semibold">
					{t('import.columnsMissing', { columns: missing.join(', ') })}
				</p>
			) : null}
			{changes.added.length > 0 ? (
				<p>{t('import.columnsAdded', { columns: changes.added.join(', ') })}</p>
			) : null}
			{missingFilterColumns(headers, filters).map((column) => (
				<p className="font-semibold text-amber-800" key={column}>
					{t('import.filterColumnMissing', { column })}
				</p>
			))}
		</div>
	);
}

/**
 * The select of one value of the gender column.
 *
 * @param props The props.
 * @param props.choice The value and its gender, if any.
 * @param props.onChange Called with the value and the chosen gender.
 * @param props.options The genders.
 * @returns The select.
 */
function GenderValueSelect({
	choice,
	onChange,
	options,
}: Readonly<{
	choice: GenderChoice;
	onChange: (value: string, gender: Gender) => void;
	options: readonly Option[];
}>): ReactNode {
	const t = useT();
	const { gender, value } = choice;
	const onGender = useCallback(
		(key: Key | null) => {
			const chosen = GENDERS.find((candidate) => candidate === key);
			if (chosen !== undefined) onChange(value, chosen);
		},
		[onChange, value],
	);
	return (
		<div className="min-w-48">
			<OptionSelect
				label={t('import.genderValue', { value })}
				onChange={onGender}
				options={options}
				placeholder={t('import.genderUnset')}
				value={gender}
			/>
		</div>
	);
}

/**
 * „Geschlecht übersetzen“: a select per value of the gender column.
 *
 * @param props The props.
 * @param props.choices The values and their genders.
 * @param props.onChange Called with a value and its gender.
 * @returns The fieldset.
 */
function GenderTranslation({
	choices,
	onChange,
}: Readonly<{
	choices: readonly GenderChoice[];
	onChange: (value: string, gender: Gender) => void;
}>): ReactNode {
	const t = useT();
	const options = useMemo(
		() => GENDERS.map((gender) => ({ id: gender, label: t(`import.gender.${gender}`) })),
		[t],
	);
	return (
		<fieldset className="flex flex-col gap-3">
			<legend className={legendClass}>{t('import.genderTitle')}</legend>
			<div className="flex flex-wrap gap-4">
				{choices.map((choice) => (
					<GenderValueSelect
						choice={choice}
						key={choice.value}
						onChange={onChange}
						options={options}
					/>
				))}
			</div>
		</fieldset>
	);
}

/**
 * How cells are read: the empty markers, the group separators (members) or the organization
 * rule (partners).
 *
 * @param props The props.
 * @param props.form The form.
 * @param props.kind The contact kind.
 * @param props.onMarkers Called with the typed markers.
 * @param props.onOptions Called with changed options.
 * @returns The fieldset.
 */
function ReadingOptions({
	form,
	kind,
	onMarkers,
	onOptions,
}: Readonly<{
	form: MappingForm;
	kind: ContactKind;
	onMarkers: (text: string) => void;
	onOptions: (options: Partial<ImportOptions>) => void;
}>): ReactNode {
	const t = useT();
	const separators = useMemo(
		() => [...form.options.groupSeparators],
		[form.options.groupSeparators],
	);
	const onSeparators = useCallback(
		(groupSeparators: readonly string[]) => {
			onOptions({ groupSeparators });
		},
		[onOptions],
	);
	const onOrganizationRule = useCallback(
		(organizationFromLastName: boolean) => {
			onOptions({ organizationFromLastName });
		},
		[onOptions],
	);
	const validateMarkers = useCallback(
		(text: string) =>
			parseEmptyMarkers(text) === null
				? t('import.emptyMarkersInvalid', {
						count: MAX_EMPTY_MARKERS - 1,
						length: MAX_MARKER_LENGTH,
					})
				: null,
		[t],
	);
	return (
		<fieldset className="flex flex-col gap-4">
			<legend className={legendClass}>{t('import.optionsTitle')}</legend>
			<TextField
				autoComplete="off"
				className={`${fieldClass} max-w-md`}
				onChange={onMarkers}
				validate={validateMarkers}
				value={form.markersText}
			>
				<Label className="font-semibold">{t('import.emptyMarkers')}</Label>
				<Input className={inputClass} />
				<Text className="text-sm text-gray-700" slot="description">
					{t('import.emptyMarkersHelp')}
				</Text>
				<FieldError className="text-sm text-red-700" />
			</TextField>
			{kind === 'member' ? (
				<CheckboxGroup className="flex flex-col gap-2" onChange={onSeparators} value={separators}>
					<Label className="font-semibold">{t('import.groupSeparators')}</Label>
					{SEPARATORS.map(({ label, value }) => (
						<LabelledCheckbox key={value} label={t(label)} value={value} />
					))}
				</CheckboxGroup>
			) : (
				<LabelledCheckbox
					isSelected={form.options.organizationFromLastName}
					label={t('import.organizationRule')}
					onChange={onOrganizationRule}
				/>
			)}
		</fieldset>
	);
}

/**
 * One filter rule: column, condition and value, and its remove button.
 *
 * @param props The props.
 * @param props.columns The columns of the file.
 * @param props.number The number of the rule, from 1.
 * @param props.onChange Called with the key of the rule and the changed rule.
 * @param props.onRemove Called with the key of the rule to remove.
 * @param props.row The rule and its key.
 * @returns The fieldset.
 */
function FilterRuleFields({
	columns,
	number,
	onChange,
	onRemove,
	row,
}: Readonly<{
	columns: readonly Option[];
	number: number;
	onChange: (key: number, rule: FilterRule) => void;
	onRemove: (key: number) => void;
	row: FilterRow;
}>): ReactNode {
	const t = useT();
	const { key, rule } = row;
	const operators = useMemo(
		() =>
			(['is', 'isNot'] as const).map((operator) => ({
				id: operator,
				label: t(`import.filterOperator.${operator}`),
			})),
		[t],
	);
	const onColumn = useCallback(
		(chosen: Key | null) => {
			if (typeof chosen === 'string') onChange(key, { ...rule, column: chosen });
		},
		[key, onChange, rule],
	);
	const onOperator = useCallback(
		(chosen: Key | null) => {
			if (chosen === 'is' || chosen === 'isNot') onChange(key, { ...rule, operator: chosen });
		},
		[key, onChange, rule],
	);
	const onValue = useCallback(
		(value: string) => {
			onChange(key, { ...rule, value });
		},
		[key, onChange, rule],
	);
	const remove = useCallback(() => {
		onRemove(key);
	}, [key, onRemove]);
	const known = columns.some(({ id }) => id === rule.column);
	return (
		<fieldset className="flex flex-wrap items-end gap-4 border-l-4 border-gray-300 pl-4">
			<legend className="mb-2 font-semibold">{t('import.filterRule', { number })}</legend>
			<div className="min-w-48">
				<OptionSelect
					label={t('import.filterColumn')}
					onChange={onColumn}
					options={columns}
					placeholder={t('import.filterColumnPlaceholder')}
					value={known ? rule.column : null}
				/>
			</div>
			<div className="min-w-36">
				<OptionSelect
					label={t('import.filterOperator')}
					onChange={onOperator}
					options={operators}
					value={rule.operator}
				/>
			</div>
			<TextField autoComplete="off" className={fieldClass} onChange={onValue} value={rule.value}>
				<Label className="font-semibold">{t('import.filterValue')}</Label>
				<Input className={inputClass} />
			</TextField>
			<Button className={secondaryButtonClass} onPress={remove}>
				{t('import.filterRemove', { number })}
			</Button>
		</fieldset>
	);
}

/**
 * The filter rules: all must hold for a row to be imported.
 *
 * @param props The props.
 * @param props.headers The column headers of the file.
 * @param props.kind The contact kind.
 * @param props.onChange Called with the new rules.
 * @param props.rows The rules.
 * @returns The fieldset.
 */
function FilterRules({
	headers,
	kind,
	onChange,
	rows,
}: Readonly<{
	headers: readonly string[];
	kind: ContactKind;
	onChange: (rows: readonly FilterRow[]) => void;
	rows: readonly FilterRow[];
}>): ReactNode {
	const t = useT();
	const addRef = useRef<HTMLButtonElement>(null);
	const columns = useMemo(
		() => headers.map((header) => ({ id: header, label: header })),
		[headers],
	);
	const add = useCallback(() => {
		const key = Math.max(0, ...rows.map((row) => row.key)) + 1;
		onChange([...rows, { key, rule: { column: headers[0] ?? '', operator: 'is', value: '' } }]);
	}, [headers, onChange, rows]);
	const onRule = useCallback(
		(key: number, rule: FilterRule) => {
			onChange(rows.map((row) => (row.key === key ? { key, rule } : row)));
		},
		[onChange, rows],
	);
	const onRemove = useCallback(
		(key: number) => {
			onChange(rows.filter((row) => row.key !== key));
			// The pressed button is gone; the focus goes to where rules are added.
			addRef.current?.focus();
		},
		[onChange, rows],
	);
	return (
		<fieldset className="flex flex-col gap-4">
			<legend className={legendClass}>{t('import.filtersTitle')}</legend>
			<p>{t(`import.filtersHelp.${kind}`)}</p>
			{rows.map((row, index) => (
				<FilterRuleFields
					columns={columns}
					key={row.key}
					number={index + 1}
					onChange={onRule}
					onRemove={onRemove}
					row={row}
				/>
			))}
			<div>
				<Button
					className={secondaryButtonClass}
					isDisabled={rows.length >= MAX_FILTER_RULES}
					onPress={add}
					ref={addRef}
				>
					{t('import.filterAdd')}
				</Button>
			</div>
		</fieldset>
	);
}

/**
 * The targets a column can have: the fields of the kind, the groups (members), the existing custom
 * fields, a new custom field and „Verwerfen“.
 *
 * @param t The texts.
 * @param kind The contact kind.
 * @param customFields The custom fields of the kind.
 * @returns The options.
 */
function targetOptions(
	t: ReturnType<typeof useT>,
	kind: ContactKind,
	customFields: readonly Readonly<CustomFieldRecord>[],
): Option[] {
	return [
		...CONTACT_FIELDS[kind].map((field) => ({
			id: targetKey({ field, type: 'field' }),
			label: t(`import.field.${field}`),
		})),
		...(kind === 'member' ? [{ id: 'groups', label: t('import.target.groups') }] : []),
		...customFields.map((customField) => ({
			id: targetKey({ customFieldId: customField.id, type: 'customField' }),
			label: t('import.target.customField', { name: customField.name }),
		})),
		{ id: 'newCustomField', label: t('import.target.newCustomField') },
		{ id: 'discard', label: t('import.target.discard') },
	];
}

/**
 * The target of a column; a column without one is discarded.
 *
 * @param columns The targets by header.
 * @param header The column header.
 * @returns The target.
 */
function targetOfColumn(columns: MappingDraft['columns'], header: string): ColumnTarget {
	return Object.hasOwn(columns, header) ? (columns[header] ?? DISCARD) : DISCARD;
}

/**
 * The draft a form stands for.
 *
 * @param form The form.
 * @param kind The contact kind.
 * @returns The draft.
 */
function draftOfForm(form: MappingForm, kind: ContactKind): MappingDraft {
	return {
		columns: form.columns,
		filters: form.rows.map(({ rule }) => rule),
		options: {
			...form.options,
			organizationFromLastName: kind === 'partner' && form.options.organizationFromLastName,
		},
	};
}

/**
 * Step 2: the mapping. A table of the columns with sample values and a target each, the
 * translation of the gender values, how cells are read and the filter rules. „Weiter zur
 * Vorschau“ builds and sends the payload; a problem shows at the form.
 *
 * @param props The props.
 * @param props.customFields The custom fields of the kind.
 * @param props.draft The draft the step starts with.
 * @param props.file The read file.
 * @param props.kind The contact kind.
 * @param props.onBack Goes back to the file.
 * @param props.onPreview Builds the payload and asks for the preview; resolves to a problem.
 * @param props.savedMapping The mapping of the last import, or null.
 * @returns The step.
 */
export function MappingStep({
	customFields,
	draft,
	file,
	kind,
	onBack,
	onPreview,
	savedMapping,
}: Readonly<{
	customFields: readonly Readonly<CustomFieldRecord>[];
	draft: MappingDraft;
	file: ReadFile;
	kind: ContactKind;
	onBack: () => void;
	onPreview: (draft: MappingDraft) => Promise<MessageKey | null>;
	savedMapping: SavedMapping | null;
}>): ReactNode {
	const t = useT();
	const [isPending, startPending] = useTransition();
	const [problem, setProblem] = useState<Problem>(null);
	const [form, setForm] = useState<MappingForm>(() => ({
		columns: draft.columns,
		markersText: formatEmptyMarkers(draft.options.emptyMarkers),
		options: draft.options,
		rows: draft.filters.map((rule, index) => ({ key: index + 1, rule })),
	}));
	const { headers } = file.sheet;
	const samples = useMemo(
		() => new Map(headers.map((header) => [header, sampleValues(file.sheet, header)])),
		[file.sheet, headers],
	);
	const options = useMemo(() => targetOptions(t, kind, customFields), [customFields, kind, t]);
	const current = useMemo(() => draftOfForm(form, kind), [form, kind]);
	const choices = useMemo(() => genderChoices(file.sheet, current), [file.sheet, current]);
	const onColumn = useCallback((header: string, target: ColumnTarget) => {
		setForm((previous) => ({ ...previous, columns: { ...previous.columns, [header]: target } }));
	}, []);
	const onGender = useCallback((value: string, gender: Gender) => {
		setForm((previous) => ({
			...previous,
			options: {
				...previous.options,
				genderValues: { ...previous.options.genderValues, [value]: gender },
			},
		}));
	}, []);
	const onMarkers = useCallback((markersText: string) => {
		const emptyMarkers = parseEmptyMarkers(markersText);
		setForm((previous) => ({
			...previous,
			markersText,
			options: emptyMarkers === null ? previous.options : { ...previous.options, emptyMarkers },
		}));
	}, []);
	const onOptions = useCallback((changed: Partial<ImportOptions>) => {
		setForm((previous) => ({ ...previous, options: { ...previous.options, ...changed } }));
	}, []);
	const onRows = useCallback((rows: readonly FilterRow[]) => {
		setForm((previous) => ({ ...previous, rows }));
	}, []);
	const onSubmit = useCallback<NonNullable<FormProps['onSubmit']>>(
		(event) => {
			event.preventDefault();
			// The field shows why; the form does not go on with markers it cannot take.
			if (parseEmptyMarkers(form.markersText) === null) return;
			startPending(async () => {
				const found = await onPreview(current);
				setProblem((previous) =>
					found === null ? null : { id: (previous?.id ?? 0) + 1, key: found },
				);
			});
		},
		[current, form.markersText, onPreview],
	);
	return (
		<PostForm className="flex flex-col gap-8" onSubmit={onSubmit}>
			<MappingNotices filters={current.filters} headers={headers} savedMapping={savedMapping} />
			<div className="overflow-x-auto">
				<table className="w-full border-collapse">
					<caption className="mb-2 text-left text-lg font-semibold">
						{t('import.columnsCaption')}
					</caption>
					<thead className="border-b border-gray-600">
						<tr>
							<th className={headerCellClass} scope="col">
								{t('import.columnHeader')}
							</th>
							<th className={headerCellClass} scope="col">
								{t('import.samplesHeader')}
							</th>
							<th className={headerCellClass} scope="col">
								{t('import.targetHeader')}
							</th>
						</tr>
					</thead>
					<tbody>
						{headers.map((header) => (
							<ColumnRow
								header={header}
								key={header}
								kind={kind}
								onChange={onColumn}
								options={options}
								samples={samples.get(header) ?? NO_SAMPLES}
								target={targetOfColumn(form.columns, header)}
							/>
						))}
					</tbody>
				</table>
			</div>
			{choices.length > 0 ? <GenderTranslation choices={choices} onChange={onGender} /> : null}
			<ReadingOptions form={form} kind={kind} onMarkers={onMarkers} onOptions={onOptions} />
			<FilterRules headers={headers} kind={kind} onChange={onRows} rows={form.rows} />
			<div className="flex flex-col gap-3">
				{problem === null ? null : (
					// An alert of its own, at the form: the status region of the page tells the steps.
					<p className="font-semibold text-red-700" key={problem.id} role="alert">
						{t(problem.key)}
					</p>
				)}
				<div className="flex flex-wrap gap-3">
					<Button className={secondaryButtonClass} onPress={onBack}>
						{t('import.otherFile')}
					</Button>
					<SubmitButton isPending={isPending}>{t('import.toPreview')}</SubmitButton>
				</div>
			</div>
		</PostForm>
	);
}
