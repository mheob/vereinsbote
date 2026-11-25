import { useServerFn } from '@tanstack/react-start';
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FieldError, Input, Label, RadioGroup, TextField } from 'react-aria-components';

import { Choice } from '@/components/admin/brand/choice';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import { inputClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { useFormSubmit } from '@/components/use-form-submit';
import type { TemplateArea } from '@/functions/templates';
import { submitCreateTemplate } from '@/functions/templates';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import type { Brand } from '@/mail/brand/brand-schema';
import { MAX_TEMPLATE_NAME_LENGTH, MAX_TEMPLATE_SUBJECT_LENGTH } from '@/server/templates/limits';

import { AreaSelect } from './area-select';
import { HtmlStart } from './html-start';
import { resolveAreaId } from './resolve-area';
import {
	isStartChoice,
	namesAfterStartChange,
	START_CHOICES,
	startDefaults,
} from './start-defaults';
import type { StartChoice, TemplateNames } from './start-defaults';

/** The label of each way to start. */
const START_LABELS: Readonly<Record<StartChoice, MessageKey>> = {
	empty: 'templates.start.empty',
	html: 'templates.start.html',
	invitation: 'templates.start.invitation',
};

/** What the server refused. */
type CreateState = Readonly<{ failure: 'nameTaken' | 'invalid' | 'gone' }> | null;

/**
 * The form „Neue Vorlage“: the area (only those the user may edit), how to start, the name and the
 * subject. A starter prefills name and subject; what the user typed stays when the start changes.
 * The template is created with the same checks as a save; a taken name is shown at the field.
 *
 * @param props The props.
 * @param props.areas The areas the user may edit; at least one.
 * @param props.brand The brand, for the preview of an import.
 * @param props.appOrigin The origin of the app, for the preview's image addresses.
 * @param props.onCreated Called with the id of the new template.
 * @param props.onGone Called when the area is gone, so the page loads it anew.
 * @returns The form.
 */
export function CreateTemplateForm({
	appOrigin,
	areas,
	brand,
	onCreated,
	onGone,
}: Readonly<{
	areas: readonly TemplateArea[];
	brand: Brand;
	appOrigin: string;
	onCreated: (id: string) => void;
	onGone: () => void;
}>): ReactNode {
	const t = useT();
	const create = useServerFn(submitCreateTemplate);
	const nameRef = useRef<HTMLInputElement>(null);
	const [chosenAreaId, setChosenAreaId] = useState(areas[0]?.id ?? '');
	// An area deleted in the meantime drops out of `areas` on reload; then the first one counts.
	const areaId = resolveAreaId(areas, chosenAreaId);
	const [start, setStart] = useState<StartChoice>('empty');
	const [names, setNames] = useState<TemplateNames>(startDefaults('empty'));
	const [htmlNameTaken, setHtmlNameTaken] = useState(false);
	const changeStart = useCallback(
		(value: string) => {
			if (!isStartChoice(value)) return;
			setNames((current) => namesAfterStartChange(current, start, value));
			setStart(value);
		},
		[start],
	);
	const changeName = useCallback((name: string) => {
		setHtmlNameTaken(false);
		setNames((current) => ({ ...current, name }));
	}, []);
	const changeSubject = useCallback((subject: string) => {
		setNames((current) => ({ ...current, subject }));
	}, []);
	const [state, submitForm] = useActionState(
		async (_previous: CreateState): Promise<CreateState> => {
			// The HTML start has no submit button; Enter in a field does not reach this.
			if (start === 'html') return null;
			const result = await settle(
				create({ data: { areaId, name: names.name.trim(), start, subject: names.subject.trim() } }),
			);
			if (result === undefined) return null;
			if (result === FAILED) return { failure: 'invalid' };
			if (result.ok) {
				onCreated(result.id);
				return null;
			}
			if (result.failure === 'gone') onGone();
			return { failure: result.failure };
		},
		null,
	);
	const onSubmit = useFormSubmit(submitForm);
	const validationErrors = useMemo(
		(): Readonly<Record<string, string>> =>
			state?.failure === 'nameTaken' || htmlNameTaken ? { name: t('templates.nameTaken') } : {},
		[htmlNameTaken, state, t],
	);
	useEffect(() => {
		if (state?.failure === 'nameTaken' || htmlNameTaken) nameRef.current?.focus();
	}, [htmlNameTaken, state]);
	const nameTaken = useCallback(() => {
		setHtmlNameTaken(true);
	}, []);
	return (
		<PostForm
			className="flex max-w-xl flex-col gap-6"
			onSubmit={onSubmit}
			validationErrors={validationErrors}
		>
			<AreaSelect
				areas={areas}
				label={t('templates.areaLabel')}
				onChange={setChosenAreaId}
				value={areaId}
			/>
			<RadioGroup className="flex flex-col gap-2" onChange={changeStart} value={start}>
				<Label className="font-semibold">{t('templates.start')}</Label>
				{START_CHOICES.map((choice) => (
					<Choice key={choice} label={t(START_LABELS[choice])} value={choice} />
				))}
			</RadioGroup>
			<TextField
				className="flex flex-col gap-1"
				isRequired
				maxLength={MAX_TEMPLATE_NAME_LENGTH}
				name="name"
				onChange={changeName}
				value={names.name}
			>
				<Label className="font-semibold">{t('templates.nameLabel')}</Label>
				<Input className={inputClass} ref={nameRef} />
				<FieldError className="text-sm text-red-700" />
			</TextField>
			<TextField
				className="flex flex-col gap-1"
				isRequired
				maxLength={MAX_TEMPLATE_SUBJECT_LENGTH}
				name="subject"
				onChange={changeSubject}
				value={names.subject}
			>
				<Label className="font-semibold">{t('templates.subjectLabel')}</Label>
				<Input className={inputClass} />
				<FieldError className="text-sm text-red-700" />
			</TextField>
			{state?.failure === 'invalid' ? (
				<p className="text-red-700" role="alert">
					{t('templates.createInvalid')}
				</p>
			) : null}
			{state?.failure === 'gone' ? (
				<p className="text-red-700" role="alert">
					{t('templates.createGone')}
				</p>
			) : null}
			{start === 'html' ? (
				<HtmlStart
					appOrigin={appOrigin}
					areaId={areaId}
					brand={brand}
					names={names}
					onCreated={onCreated}
					onGone={onGone}
					onNameTaken={nameTaken}
				/>
			) : (
				<div>
					<SubmitButton>{t('templates.createSubmit')}</SubmitButton>
				</div>
			)}
		</PostForm>
	);
}
