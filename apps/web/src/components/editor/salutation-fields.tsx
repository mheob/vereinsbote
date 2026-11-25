import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Button, Label, RadioGroup } from 'react-aria-components';

import { Choice } from '@/components/admin/brand/choice';
import { secondaryButtonClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import { DEFAULT_SALUTATIONS, SALUTATION_CASES } from '@/mail/placeholders/salutation';
import type { SalutationForm, SalutationTexts } from '@/mail/placeholders/salutation';
import type { TemplateInput } from '@/mail/templates/template-schema';
import type { EditorPlaceholder } from '@/server/templates/editor-placeholders';

import { salutationFormPatch } from './editor-state';
import type { SettingsPatch } from './editor-state';
import { SyntaxEditor } from './syntax-editor';

/** The only placeholders a salutation text may use (Design 10.3). */
const SALUTATION_KEYS: ReadonlySet<string> = new Set([
	'contact.firstName',
	'contact.lastName',
	'contact.organization',
]);

const FORMS: readonly SalutationForm[] = ['du', 'sie'];

type SalutationCase = keyof SalutationTexts;

/**
 * The text of one salutation case.
 *
 * @param props The props.
 * @param props.salutationCase The case.
 * @param props.texts All texts.
 * @param props.onChange Called with the changed texts.
 * @param props.placeholders The placeholders the button offers.
 * @param props.labels The placeholders whose names the marks show.
 * @param props.isReadOnly Whether the field is read-only.
 * @param props.error The message of a refusal, or null.
 * @returns The field.
 */
function SalutationText({
	error,
	isReadOnly,
	labels,
	onChange,
	placeholders,
	salutationCase,
	texts,
}: Readonly<{
	salutationCase: SalutationCase;
	texts: SalutationTexts;
	onChange: (texts: SalutationTexts) => void;
	placeholders: readonly EditorPlaceholder[];
	labels: readonly EditorPlaceholder[];
	isReadOnly: boolean;
	error: string | null;
}>): ReactNode {
	const t = useT();
	const change = useCallback(
		(text: string) => {
			onChange({ ...texts, [salutationCase]: text });
		},
		[onChange, salutationCase, texts],
	);
	return (
		<SyntaxEditor
			description={null}
			error={error}
			focusKey={`salutation.${salutationCase}`}
			isReadOnly={isReadOnly}
			label={t(`editor.salutation.${salutationCase}`)}
			labels={labels}
			onChange={change}
			placeholders={placeholders}
			value={texts[salutationCase]}
		/>
	);
}

/**
 * The salutation of a template (Design 10.3): „Du“ or „Sie“ and the text of each case, which
 * may use the first name, the last name and the organization. „Auf Standard zurücksetzen“ brings
 * back the texts of the chosen form.
 *
 * @param props The props.
 * @param props.input The template.
 * @param props.onChange Called with the changed fields.
 * @param props.placeholders The placeholders of the area.
 * @param props.errors The messages of refused fields, by `data-problem-focus`.
 * @param props.isReadOnly Whether the fields are read-only.
 * @param props.onReset Called after the texts were reset, for the announcement.
 * @returns The fields.
 */
export function SalutationFields({
	errors,
	input,
	isReadOnly,
	onChange,
	onReset,
	placeholders,
}: Readonly<{
	input: TemplateInput;
	onChange: (patch: SettingsPatch) => void;
	placeholders: readonly EditorPlaceholder[];
	errors: ReadonlyMap<string, string>;
	isReadOnly: boolean;
	onReset: () => void;
}>): ReactNode {
	const t = useT();
	const offered = useMemo(
		() => placeholders.filter(({ key }) => SALUTATION_KEYS.has(key)),
		[placeholders],
	);
	const changeForm = useCallback(
		(value: string) => {
			const form = FORMS.find((candidate) => candidate === value);
			if (form !== undefined) onChange(salutationFormPatch(input, form));
		},
		[input, onChange],
	);
	const changeTexts = useCallback(
		(salutationTexts: SalutationTexts) => {
			onChange({ salutationTexts });
		},
		[onChange],
	);
	const reset = useCallback(() => {
		onChange({ salutationTexts: DEFAULT_SALUTATIONS[input.salutationForm] });
		onReset();
	}, [input.salutationForm, onChange, onReset]);
	return (
		<div className="flex flex-col gap-4">
			<RadioGroup
				className="flex flex-col gap-2"
				isReadOnly={isReadOnly}
				onChange={changeForm}
				orientation="horizontal"
				value={input.salutationForm}
			>
				<Label className="font-semibold">{t('editor.salutationForm')}</Label>
				<div className="flex flex-wrap gap-4">
					{FORMS.map((form) => (
						<Choice key={form} label={t(`editor.salutationForm.${form}`)} value={form} />
					))}
				</div>
			</RadioGroup>
			<fieldset className="flex flex-col gap-3">
				<legend className="font-semibold">{t('editor.salutationTexts')}</legend>
				<p className="text-sm text-gray-700">{t('editor.salutationTextsHelp')}</p>
				{SALUTATION_CASES.map((salutationCase) => (
					<SalutationText
						error={errors.get(`salutation.${salutationCase}`) ?? null}
						isReadOnly={isReadOnly}
						key={salutationCase}
						labels={placeholders}
						onChange={changeTexts}
						placeholders={offered}
						salutationCase={salutationCase}
						texts={input.salutationTexts}
					/>
				))}
				{isReadOnly ? null : (
					<Button className={`self-start ${secondaryButtonClass}`} onPress={reset}>
						{t('editor.salutationReset')}
					</Button>
				)}
			</fieldset>
		</div>
	);
}
