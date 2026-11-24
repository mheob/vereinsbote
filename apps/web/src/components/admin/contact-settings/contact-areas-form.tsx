import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useActionState, useCallback, useId } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	FieldError,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
} from 'react-aria-components';
import type { Key } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { ChevronIcon } from '@/components/icons';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import { optionClass, popoverClass, selectButtonClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { useFormSubmit } from '@/components/use-form-submit';
import { submitContactAreas } from '@/functions/contact-settings';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import type { ContactSettings } from '@/server/contacts/settings';

import type { SettingsArea } from './field-areas';

/** The two selects of the form, by the name of their value. */
type AreaSetting = 'membersAreaId' | 'partnersAreaId';

const AREA_SELECTS: readonly Readonly<{ label: MessageKey; name: AreaSetting }>[] = [
	{ label: 'contactSettings.membersArea', name: 'membersAreaId' },
	{ label: 'contactSettings.partnersArea', name: 'partnersAreaId' },
];

/**
 * Reads a chosen area of the submitted form.
 *
 * @param formData The submitted form.
 * @param name The select.
 * @returns The area id, or an empty string.
 */
function chosenArea(formData: FormData, name: AreaSetting): string {
	const value = formData.get(name);
	return typeof value === 'string' ? value : '';
}

/**
 * One area select, „Mitglieder-Bereich“ or „Partner-Bereich“. It needs a choice.
 *
 * @param props The props.
 * @param props.areas The areas to choose from.
 * @param props.defaultValue The stored area, or null while none is set.
 * @param props.label The label.
 * @param props.name The name of the value in the form.
 * @returns The select.
 */
function AreaSelect({
	areas,
	defaultValue,
	label,
	name,
}: Readonly<{
	areas: readonly SettingsArea[];
	defaultValue: string | null;
	label: string;
	name: AreaSetting;
}>): ReactNode {
	const t = useT();
	const validate = useCallback(
		(value: Key | null) => (value === null ? t('contactSettings.areaRequired') : null),
		[t],
	);
	return (
		<Select
			className="flex flex-col gap-1"
			defaultValue={defaultValue}
			isRequired
			name={name}
			validate={validate}
		>
			<Label className="font-semibold">{label}</Label>
			<Button className={selectButtonClass}>
				<SelectValue />
				<ChevronIcon />
			</Button>
			<FieldError className="text-sm text-red-700" />
			<Popover className={popoverClass}>
				<ListBox className="outline-none">
					{areas.map((area) => (
						<ListBoxItem className={optionClass} id={area.id} key={area.id}>
							{area.name}
						</ListBoxItem>
					))}
				</ListBox>
			</Popover>
		</Select>
	);
}

/**
 * The form „Bereiche“: which area holds the members and which the partners. While one is not
 * set (an instance set up before the contacts existed), a hint says that imports need them. An
 * area deleted in another tab is refused; the selects then show the stored areas again.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.areas All areas, by name.
 * @param props.settings The stored settings.
 * @returns The section with the form.
 */
export function ContactAreasForm({
	announce,
	areas,
	settings,
}: Readonly<{
	announce: Announce;
	areas: readonly SettingsArea[];
	settings: Readonly<ContactSettings>;
}>): ReactNode {
	const t = useT();
	const router = useRouter();
	const save = useServerFn(submitContactAreas);
	const headingId = useId();
	// Counts the refusals of a gone area; each one shows the selects anew with the stored areas.
	const [revision, submitForm, isPending] = useActionState(
		async (previous: number, formData: FormData): Promise<number> => {
			const result = await settle(
				save({
					data: {
						membersAreaId: chosenArea(formData, 'membersAreaId'),
						partnersAreaId: chosenArea(formData, 'partnersAreaId'),
					},
				}),
			);
			if (result === undefined) return previous;
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
				return previous;
			}
			// The navigation and the import rights follow the areas; a gone area leaves the list.
			await router.invalidate();
			if (!result.ok) {
				announce(t('contactSettings.gone'), 'alert');
				return previous + 1;
			}
			announce(t('contactSettings.areasSaved'), 'status');
			return previous;
		},
		0,
	);
	const onSubmit = useFormSubmit(submitForm);
	const missing = settings.membersAreaId === null || settings.partnersAreaId === null;
	return (
		<section aria-labelledby={headingId} className="flex max-w-md flex-col gap-4">
			<h2 className="text-xl font-bold" id={headingId}>
				{t('contactSettings.areasTitle')}
			</h2>
			{missing ? <p className="font-semibold">{t('contactSettings.areasMissing')}</p> : null}
			<p>{t('contactSettings.areasHelp')}</p>
			<PostForm aria-labelledby={headingId} className="flex flex-col gap-4" onSubmit={onSubmit}>
				{AREA_SELECTS.map((select) => (
					<AreaSelect
						areas={areas}
						defaultValue={settings[select.name]}
						key={`${select.name}-${revision}`}
						label={t(select.label)}
						name={select.name}
					/>
				))}
				<div>
					<SubmitButton isPending={isPending}>{t('contactSettings.save')}</SubmitButton>
				</div>
			</PostForm>
		</section>
	);
}
