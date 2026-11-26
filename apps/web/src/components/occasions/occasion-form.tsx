import { useServerFn } from '@tanstack/react-start';
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FieldError, Input, Label, TextField } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { LabelledCheckbox } from '@/components/contacts/import/labelled-checkbox';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import { inputClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { AreaSelect } from '@/components/templates/area-select';
import { resolveAreaId } from '@/components/templates/resolve-area';
import { useFormSubmit } from '@/components/use-form-submit';
import { submitCreateOccasion, submitUpdateOccasion } from '@/functions/occasions';
import type {
	CreateOccasionResult,
	OccasionArea,
	SaveOccasionResult,
	SenderChoice,
	TemplateChoice,
} from '@/functions/occasions';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import type { OccasionProblem } from '@/server/occasions/errors';
import type { OccasionFailure } from '@/server/occasions/failures';
import { defaultUnsubscribe, MAX_OCCASION_NAME_LENGTH } from '@/server/occasions/limits';
import type { OccasionKind } from '@/server/occasions/limits';
import type { OccasionRecord } from '@/server/occasions/occasions';

import { ChoiceField, KindField } from './occasion-fields';

/** The message of each refusal that is no problem of the name. */
const PROBLEM_MESSAGE: Readonly<Record<Exclude<OccasionProblem, 'name'>, MessageKey>> = {
	archived: 'occasions.archivedInvalid',
	senderNotReleased: 'occasions.senderInvalid',
	templateArea: 'occasions.templateInvalid',
};

/** What the server refused; null before the first save and after a success. */
type FormState = Readonly<{
	failure: OccasionFailure['failure'];
	problem?: OccasionProblem;
}> | null;

/** What a save sends besides the name. */
interface Choices {
	readonly areaId: string;
	readonly kind: OccasionKind;
	readonly senderId: string;
	readonly templateId: string;
	readonly unsubscribe: boolean;
}

/** What a save needs to tell its page. */
interface SaveCallbacks {
	readonly announce: Announce;
	readonly onCreated?: (id: string) => void;
	readonly onGone: () => void;
	readonly onSaved?: (version: number) => void;
}

/**
 * The message at the name for a refusal that belongs to it.
 *
 * @param state The refusal.
 * @returns The message key, or null when the refusal is not about the name.
 */
function nameMessage(state: FormState): MessageKey | null {
	if (state?.failure === 'nameTaken') return 'occasions.nameTaken';
	if (state?.failure === 'invalid' && state.problem === 'name') return 'occasions.nameInvalid';
	return null;
}

/**
 * The message for a refusal that belongs to no field.
 *
 * @param state The refusal.
 * @returns The message key, or null.
 */
function formMessage(state: FormState): MessageKey | null {
	if (state?.failure === 'changed') return 'occasions.changed';
	if (state?.failure === 'gone') return 'occasions.gone';
	if (state?.failure !== 'invalid' || state.problem === undefined || state.problem === 'name') {
		return null;
	}
	return PROBLEM_MESSAGE[state.problem];
}

/**
 * The action of the form: creates the occasion or saves it, and turns a refusal into the state
 * the form shows.
 *
 * @param occasion The occasion to change, or null for a new one.
 * @param choices What the form holds besides the name.
 * @param callbacks The live region and what to do with a success or a vanished area.
 * @returns The state of the form and its submit handler.
 */
function useOccasionSave(
	occasion: Readonly<OccasionRecord> | null,
	choices: Readonly<Choices>,
	callbacks: Readonly<SaveCallbacks>,
): readonly [FormState, ReturnType<typeof useFormSubmit>] {
	const { announce, onCreated, onGone, onSaved } = callbacks;
	const t = useT();
	const create = useServerFn(submitCreateOccasion);
	const update = useServerFn(submitUpdateOccasion);
	// The version a save gives, so the next save of the same page is not refused as changed.
	const [version, setVersion] = useState(occasion?.version ?? 1);
	const [state, submitForm] = useActionState(
		async (_previous: FormState, formData: FormData): Promise<FormState> => {
			const name = formData.get('name');
			const { areaId, ...rest } = choices;
			const input = { ...rest, name: typeof name === 'string' ? name : '' };
			const call: Promise<CreateOccasionResult | SaveOccasionResult> =
				occasion === null
					? create({ data: { areaId, input } })
					: update({ data: { id: occasion.id, input, version } });
			const result = await settle(call);
			if (result === undefined) return null;
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
				return null;
			}
			if (!result.ok) {
				if (result.failure === 'gone') onGone();
				return 'problem' in result
					? { failure: result.failure, problem: result.problem }
					: { failure: result.failure };
			}
			if ('id' in result) {
				onCreated?.(result.id);
				return null;
			}
			setVersion(result.version);
			announce(t('occasions.saved'), 'status');
			onSaved?.(result.version);
			return null;
		},
		null,
	);
	const onSubmit = useFormSubmit(submitForm);
	return [state, onSubmit];
}

/**
 * The form of an occasion: the area (new occasions only), the name, the kind, the template of the
 * area, a sender released to it and whether the mails carry an unsubscribe link. The link is
 * preset by the kind until the user decides it. The trigger is „manuell“ in this version.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.areas The areas an occasion can be created in; the occasion's own for a change.
 * @param props.occasion The occasion to change; null for a new one.
 * @param props.onCreated Called with the id of a new occasion.
 * @param props.onGone Called when the area or the occasion is gone, so the page loads it anew.
 * @param props.onSaved Called after a save with the new version.
 * @param props.senders The senders released to the areas.
 * @param props.templates The templates of the areas.
 * @returns The form.
 */
export function OccasionForm({
	announce,
	areas,
	occasion,
	onCreated,
	onGone,
	onSaved,
	senders,
	templates,
}: Readonly<{
	announce: Announce;
	areas: readonly Readonly<OccasionArea>[];
	occasion: Readonly<OccasionRecord> | null;
	onCreated?: (id: string) => void;
	onGone: () => void;
	onSaved?: (version: number) => void;
	senders: readonly Readonly<SenderChoice>[];
	templates: readonly Readonly<TemplateChoice>[];
}>): ReactNode {
	const t = useT();
	const nameRef = useRef<HTMLInputElement>(null);
	const [chosenAreaId, setChosenAreaId] = useState(occasion?.areaId ?? areas[0]?.id ?? '');
	const areaId = resolveAreaId(areas, chosenAreaId);
	const [kind, setKind] = useState<OccasionKind>(occasion?.kind ?? 'circular');
	const [unsubscribe, setUnsubscribe] = useState(
		occasion?.unsubscribe ?? defaultUnsubscribe('circular'),
	);
	// A saved occasion keeps its choice; for a new one the kind presets it until it is touched.
	const [unsubscribeTouched, setUnsubscribeTouched] = useState(occasion !== null);
	const [chosenTemplateId, setChosenTemplateId] = useState(occasion?.templateId ?? '');
	const [chosenSenderId, setChosenSenderId] = useState(occasion?.senderId ?? '');
	const areaTemplates = useMemo(
		() => templates.filter((template) => template.areaId === areaId),
		[areaId, templates],
	);
	const areaSenders = useMemo(
		() => senders.filter((sender) => sender.areaId === areaId),
		[areaId, senders],
	);
	const senderChoices = useMemo(
		() => areaSenders.map(({ id, label }) => ({ id, name: label })),
		[areaSenders],
	);
	const templateId = resolveAreaId(areaTemplates, chosenTemplateId);
	const senderId = resolveAreaId(areaSenders, chosenSenderId);
	const changeKind = useCallback(
		(value: OccasionKind) => {
			setKind(value);
			if (!unsubscribeTouched) setUnsubscribe(defaultUnsubscribe(value));
		},
		[unsubscribeTouched],
	);
	const changeUnsubscribe = useCallback((value: boolean) => {
		setUnsubscribeTouched(true);
		setUnsubscribe(value);
	}, []);
	const choices = useMemo(
		() => ({ areaId, kind, senderId, templateId, unsubscribe }),
		[areaId, kind, senderId, templateId, unsubscribe],
	);
	const [state, onSubmit] = useOccasionSave(occasion, choices, {
		announce,
		onCreated,
		onGone,
		onSaved,
	});
	const nameKey = nameMessage(state);
	const validationErrors = useMemo(
		(): Readonly<Record<string, string>> => (nameKey === null ? {} : { name: t(nameKey) }),
		[nameKey, t],
	);
	useEffect(() => {
		if (nameMessage(state) !== null) nameRef.current?.focus();
	}, [state]);
	const messageKey = formMessage(state);
	return (
		<PostForm
			className="flex max-w-xl flex-col gap-6"
			onSubmit={onSubmit}
			validationErrors={validationErrors}
		>
			{occasion === null ? (
				<AreaSelect
					areas={areas}
					label={t('occasions.areaLabel')}
					onChange={setChosenAreaId}
					value={areaId}
				/>
			) : null}
			<TextField
				className="flex flex-col gap-1"
				defaultValue={occasion?.name ?? ''}
				isRequired
				maxLength={MAX_OCCASION_NAME_LENGTH}
				name="name"
			>
				<Label className="font-semibold">{t('occasions.nameLabel')}</Label>
				<Input className={inputClass} ref={nameRef} />
				<FieldError className="text-sm text-red-700" />
			</TextField>
			<KindField onChange={changeKind} value={kind} />
			<ChoiceField
				choices={areaTemplates}
				emptyKey="occasions.noTemplates"
				label={t('occasions.templateLabel')}
				onChange={setChosenTemplateId}
				value={templateId}
			/>
			<ChoiceField
				choices={senderChoices}
				emptyKey="occasions.noSenders"
				label={t('occasions.senderLabel')}
				onChange={setChosenSenderId}
				value={senderId}
			/>
			<div className="flex flex-col gap-1">
				<LabelledCheckbox
					isSelected={unsubscribe}
					label={t('occasions.unsubscribeLabel')}
					onChange={changeUnsubscribe}
				/>
				<span className="pl-7 text-sm text-gray-700">{t('occasions.unsubscribeHelp')}</span>
			</div>
			<p>{t('occasions.triggerManual')}</p>
			{messageKey === null ? null : (
				<p className="text-red-700" role="alert">
					{t(messageKey)}
				</p>
			)}
			{areaTemplates.length > 0 && areaSenders.length > 0 ? (
				<div>
					<SubmitButton>
						{t(occasion === null ? 'occasions.createSubmit' : 'occasions.save')}
					</SubmitButton>
				</div>
			) : null}
		</PostForm>
	);
}
