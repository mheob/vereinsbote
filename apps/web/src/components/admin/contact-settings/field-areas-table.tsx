import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { startTransition, useCallback, useId, useOptimistic } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	CheckboxButton,
	CheckboxField,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
} from 'react-aria-components';
import type { Key } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { CheckIcon, ChevronIcon } from '@/components/icons';
import { FAILED, settle } from '@/components/settle';
import {
	checkboxBoxClass,
	checkboxClass,
	optionClass,
	popoverClass,
	selectButtonClass,
} from '@/components/styles';
import { submitCustomFieldProtection, submitFieldAreas } from '@/functions/contact-settings';
import { useT } from '@/i18n/use-t';
import { CONTACT_KINDS, PROTECTIONS } from '@/server/contacts/fields';
import type { ContactKind, Protection } from '@/server/contacts/fields';
import type { CustomFieldRecord } from '@/server/contacts/settings';

import { areaNames, protectedFieldName, toggledAreaIds } from './field-areas';
import type { ProtectedFieldRow, SettingsArea } from './field-areas';

const cellClass = 'px-3 py-2 align-middle';
const headerCellClass = 'px-3 py-2 text-left font-semibold whitespace-nowrap';

/**
 * Tells whether a select key is a protection.
 *
 * @param key The key of the chosen option.
 * @returns True for `base` and `protected`.
 */
function isProtection(key: Key | null): key is Protection {
	return PROTECTIONS.some((protection) => protection === key);
}

/**
 * One checkbox of the table, labelled „{field} ({kind}) für {area}“; the row and column headers
 * show the field and the area.
 *
 * @param props The props.
 * @param props.areaId The area of the column.
 * @param props.isSelected Whether the area sees the field.
 * @param props.label The label.
 * @param props.onToggle Called with the area and its new state.
 * @returns The checkbox.
 */
function AreaCheckbox({
	areaId,
	isSelected,
	label,
	onToggle,
}: Readonly<{
	areaId: string;
	isSelected: boolean;
	label: string;
	onToggle: (areaId: string, isSelected: boolean) => void;
}>): ReactNode {
	const onChange = useCallback(
		(selected: boolean) => {
			onToggle(areaId, selected);
		},
		[areaId, onToggle],
	);
	return (
		<CheckboxField aria-label={label} isSelected={isSelected} onChange={onChange}>
			<CheckboxButton className={checkboxClass}>
				{({ isSelected: checked }) => (
					<span className={checkboxBoxClass}>{checked ? <CheckIcon /> : null}</span>
				)}
			</CheckboxButton>
		</CheckboxField>
	);
}

/**
 * One protected field with a checkbox per area. A change is saved at once and shown until the
 * saved state arrives; a refused or failed save falls back to the stored areas. Unticking the
 * last area is refused before anything is sent, and the checkbox stays ticked.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.areas All areas, by name.
 * @param props.field The field with its areas.
 * @param props.kind The kind the field belongs to.
 * @returns The row.
 */
function FieldAreasRow({
	announce,
	areas,
	field,
	kind,
}: Readonly<{
	announce: Announce;
	areas: readonly SettingsArea[];
	field: ProtectedFieldRow;
	kind: ContactKind;
}>): ReactNode {
	const t = useT();
	const router = useRouter();
	const save = useServerFn(submitFieldAreas);
	const [shown, showAreas] = useOptimistic<readonly string[]>(field.areaIds);
	const fieldName = protectedFieldName(field, t);
	const kindName = t(`contacts.kind.${kind}`);
	const onToggle = useCallback(
		(areaId: string, selected: boolean) => {
			const next = toggledAreaIds(shown, areaId, selected);
			if (next === null) {
				announce(t('contactSettings.keepOneArea'), 'alert');
				return;
			}
			startTransition(async () => {
				showAreas(next);
				const result = await settle(
					save({ data: { areaIds: [...next], fieldKey: field.key, kind } }),
				);
				if (result === undefined) return;
				if (result === FAILED || !result.ok) {
					announce(
						t(result === FAILED ? 'auth.requestFailed' : 'contactSettings.keepOneArea'),
						'alert',
					);
					return;
				}
				await router.invalidate();
				const names = areaNames(next, areas).join(', ');
				announce(
					t('contactSettings.fieldAreas', { areas: names, field: fieldName, kind: kindName }),
					'status',
				);
			});
		},
		[announce, areas, field.key, fieldName, kind, kindName, router, save, shown, showAreas, t],
	);
	return (
		<tr className="border-b border-gray-300">
			<th className={headerCellClass} scope="row">
				{fieldName}
			</th>
			{areas.map((area) => (
				<td className={cellClass} key={area.id}>
					<AreaCheckbox
						areaId={area.id}
						isSelected={shown.includes(area.id)}
						label={t('contactSettings.fieldAreasLabel', {
							area: area.name,
							field: fieldName,
							kind: kindName,
						})}
						onToggle={onToggle}
					/>
				</td>
			))}
		</tr>
	);
}

/**
 * The protected fields of one kind: a row per field, a column per area.
 *
 * @param props The props.
 * @param props.announce Announces results.
 * @param props.areas All areas, by name.
 * @param props.fields The protected fields of the kind.
 * @param props.kind The kind.
 * @returns The table.
 */
function KindFieldsTable({
	announce,
	areas,
	fields,
	kind,
}: Readonly<{
	announce: Announce;
	areas: readonly SettingsArea[];
	fields: readonly ProtectedFieldRow[];
	kind: ContactKind;
}>): ReactNode {
	const t = useT();
	return (
		<div className="overflow-x-auto">
			<table className="border-collapse">
				<caption className="mb-2 text-left text-lg font-semibold">
					{t(`contactSettings.fieldsCaption.${kind}`)}
				</caption>
				<thead>
					<tr className="border-b border-gray-600">
						<th className={headerCellClass} scope="col">
							{t('contactSettings.fieldColumn')}
						</th>
						{areas.map((area) => (
							<th className={headerCellClass} key={area.id} scope="col">
								{area.name}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{fields.map((field) => (
						<FieldAreasRow
							announce={announce}
							areas={areas}
							field={field}
							key={field.key}
							kind={kind}
						/>
					))}
				</tbody>
			</table>
		</div>
	);
}

/**
 * The section „Geschützte Felder“: per kind, which areas see each protected field.
 *
 * @param props The props.
 * @param props.announce Announces results.
 * @param props.areas All areas, by name.
 * @param props.fields The protected fields of each kind.
 * @returns The section.
 */
function FieldAreasTable({
	announce,
	areas,
	fields,
}: Readonly<{
	announce: Announce;
	areas: readonly SettingsArea[];
	fields: Readonly<Record<ContactKind, readonly ProtectedFieldRow[]>>;
}>): ReactNode {
	const t = useT();
	const headingId = useId();
	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-4">
			<h2 className="text-xl font-bold" id={headingId}>
				{t('contactSettings.fieldsTitle')}
			</h2>
			<p>{t('contactSettings.fieldsHelp')}</p>
			{CONTACT_KINDS.map((kind) => (
				<KindFieldsTable
					announce={announce}
					areas={areas}
					fields={fields[kind]}
					key={kind}
					kind={kind}
				/>
			))}
		</section>
	);
}

/**
 * The protection select of one custom field, labelled „Schutz von {name}“. A change is saved at
 * once and shown until the saved state arrives; a failed save falls back to the stored one.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.field The custom field.
 * @returns The select.
 */
function ProtectionSelect({
	announce,
	field,
}: Readonly<{ announce: Announce; field: Readonly<CustomFieldRecord> }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const save = useServerFn(submitCustomFieldProtection);
	const [shown, showProtection] = useOptimistic<Protection>(field.protection);
	const onChange = useCallback(
		(key: Key | null) => {
			if (!isProtection(key)) return;
			startTransition(async () => {
				showProtection(key);
				const result = await settle(save({ data: { customFieldId: field.id, protection: key } }));
				if (result === undefined) return;
				if (result === FAILED) {
					announce(t('auth.requestFailed'), 'alert');
					return;
				}
				// A protected field gets its row in the table above.
				await router.invalidate();
				const protection = t(`contactSettings.protection.${key}`);
				announce(
					t('contactSettings.protectionChanged', { name: field.name, protection }),
					'status',
				);
			});
		},
		[announce, field.id, field.name, router, save, showProtection, t],
	);
	return (
		<Select className="min-w-36" onChange={onChange} value={shown}>
			{/* The row header shows the field and the column header the protection. */}
			<Label className="sr-only">
				{t('contactSettings.protectionLabel', { name: field.name })}
			</Label>
			<Button className={selectButtonClass}>
				<SelectValue />
				<ChevronIcon />
			</Button>
			<Popover className={popoverClass}>
				<ListBox className="outline-none">
					{PROTECTIONS.map((protection) => (
						<ListBoxItem className={optionClass} id={protection} key={protection}>
							{t(`contactSettings.protection.${protection}`)}
						</ListBoxItem>
					))}
				</ListBox>
			</Popover>
		</Select>
	);
}

/**
 * The section „Zusatzfelder“: each custom field with its kind, type and protection.
 *
 * @param props The props.
 * @param props.announce Announces results.
 * @param props.customFields The custom fields of both kinds.
 * @returns The section.
 */
function CustomFieldsTable({
	announce,
	customFields,
}: Readonly<{
	announce: Announce;
	customFields: readonly Readonly<CustomFieldRecord>[];
}>): ReactNode {
	const t = useT();
	const headingId = useId();
	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-4">
			<h2 className="text-xl font-bold" id={headingId}>
				{t('contactSettings.customFieldsTitle')}
			</h2>
			{customFields.length === 0 ? (
				<p>{t('contactSettings.customFieldsEmpty')}</p>
			) : (
				<>
					<p>{t('contactSettings.customFieldsHelp')}</p>
					<div className="overflow-x-auto">
						<table aria-labelledby={headingId} className="border-collapse">
							<thead>
								<tr className="border-b border-gray-600">
									<th className={headerCellClass} scope="col">
										{t('contactSettings.nameColumn')}
									</th>
									<th className={headerCellClass} scope="col">
										{t('contactSettings.kindColumn')}
									</th>
									<th className={headerCellClass} scope="col">
										{t('contactSettings.typeColumn')}
									</th>
									<th className={headerCellClass} scope="col">
										{t('contactSettings.protectionColumn')}
									</th>
								</tr>
							</thead>
							<tbody>
								{customFields.map((field) => (
									<tr className="border-b border-gray-300" key={field.id}>
										<th className={headerCellClass} scope="row">
											{field.name}
										</th>
										<td className={cellClass}>{t(`contacts.kind.${field.kind}`)}</td>
										<td className={cellClass}>{t(`import.fieldType.${field.type}`)}</td>
										<td className={cellClass}>
											<ProtectionSelect announce={announce} field={field} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			)}
		</section>
	);
}

export { CustomFieldsTable, FieldAreasTable };
