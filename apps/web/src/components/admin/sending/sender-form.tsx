import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import {
	startTransition,
	useActionState,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useTransition,
} from 'react';
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
import type { Key } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { LabelledCheckbox } from '@/components/contacts/import/labelled-checkbox';
import { ChevronIcon } from '@/components/icons';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import {
	inputClass,
	optionClass,
	popoverClass,
	secondaryButtonClass,
	selectButtonClass,
} from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { useFormSubmit } from '@/components/use-form-submit';
import { useHydrated } from '@/components/use-hydrated';
import { submitCreateSender, submitSystemSender, submitUpdateSender } from '@/functions/sending';
import type { CreatedResult, SavedResult, SenderPage } from '@/functions/sending';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import { normalizeEmail } from '@/server/auth/email';
import type { ConnectionKind } from '@/server/sending/connections';
import type { SendingFailure } from '@/server/sending/failures';
import {
	DEFAULT_GRAPH_PER_MINUTE,
	MAX_ADDRESS_LENGTH,
	MAX_NAME_LENGTH,
} from '@/server/sending/limits';

const fieldClass = 'flex max-w-xl flex-col gap-1';
const errorClass = 'text-sm text-red-700';

/** The text fields of the form, by name. */
type TextFieldName =
	| 'archiveBcc'
	| 'dailyLimit'
	| 'displayName'
	| 'email'
	| 'perMinute'
	| 'replyTo';

/** The fields a refusal can belong to: the text fields and the two choices. */
type FormField = TextFieldName | 'areaIds' | 'connectionId';

/** The state of the form after a refusal; null before the first and after a success. */
type FormState = Readonly<{ fields: Readonly<Partial<Record<FormField, MessageKey>>> }> | null;

const MESSAGE_BY_FIELD: Readonly<Record<string, readonly [FormField, MessageKey]>> = {
	archiveBcc: ['archiveBcc', 'sending.emailInvalid'],
	areaIds: ['areaIds', 'sending.areasInvalid'],
	connectionId: ['connectionId', 'sending.connectionInvalid'],
	dailyLimit: ['dailyLimit', 'sending.limitInvalid'],
	displayName: ['displayName', 'sending.nameInvalid'],
	email: ['email', 'sending.emailInvalid'],
	perMinute: ['perMinute', 'sending.limitInvalid'],
	replyTo: ['replyTo', 'sending.emailInvalid'],
};

/**
 * The message at the field a refusal belongs to.
 *
 * @param failure The refusal.
 * @returns The message per field; empty for a refusal that belongs to no field.
 */
function fieldErrors(failure: SendingFailure): Readonly<Partial<Record<FormField, MessageKey>>> {
	if (failure.failure === 'emailTaken') return { email: 'sending.emailTaken' };
	if (failure.failure === 'areaInUse') return { areaIds: 'sending.areasInvalid' };
	if (failure.failure !== 'invalid') return {};
	const entry = MESSAGE_BY_FIELD[failure.field];
	return entry === undefined ? {} : { [entry[0]]: entry[1] };
}

/**
 * Reads a text field of the submitted form.
 *
 * @param formData The submitted form.
 * @param name The field name.
 * @returns The value, or an empty string.
 */
function textValue(formData: FormData, name: TextFieldName): string {
	const value = formData.get(name);
	return typeof value === 'string' ? value : '';
}

/**
 * A number field of the submitted form: empty is null, a text that is no number is NaN (which
 * the server refuses).
 *
 * @param formData The submitted form.
 * @param name The field name.
 * @returns The number, or null.
 */
function numberValue(formData: FormData, name: TextFieldName): number | null {
	const value = textValue(formData, name).trim();
	return value === '' ? null : Number(value);
}

/**
 * A text field of the form.
 *
 * @param props The props.
 * @param props.name The field name.
 * @param props.label The label.
 * @param props.defaultValue The stored value.
 * @param props.isRequired Whether the browser asks for a value.
 * @param props.help A description, or null.
 * @param props.maxLength The longest value.
 * @param props.type The input type.
 * @returns The field.
 */
function SenderTextField({
	defaultValue,
	help = null,
	isRequired = false,
	label,
	maxLength,
	name,
	type = 'text',
}: Readonly<{
	name: TextFieldName;
	label: string;
	defaultValue: string;
	maxLength: number;
	isRequired?: boolean;
	help?: string | null;
	type?: 'email' | 'text';
}>): ReactNode {
	return (
		<TextField
			className={fieldClass}
			defaultValue={defaultValue}
			isRequired={isRequired}
			maxLength={maxLength}
			name={name}
			type={type}
		>
			<Label className="font-semibold">{label}</Label>
			<Input className={inputClass} />
			{help === null ? null : (
				<Text className="text-sm" slot="description">
					{help}
				</Text>
			)}
			<FieldError className={errorClass} />
		</TextField>
	);
}

/** What the sender form holds besides its text fields. */
interface Choices {
	readonly connectionId: string;
	readonly kind: ConnectionKind;
	readonly areaIds: readonly string[];
}

/** What saving a sender gave: the state of the form, its submit handler and whether it runs. */
type Save = readonly [FormState, ReturnType<typeof useFormSubmit>, boolean];

/**
 * The action of the form: creates the sender (and goes to the overview) or saves it, and turns a
 * refusal into the messages at the fields.
 *
 * @param sender The sender to change, or null for a new one.
 * @param choices The chosen connection and areas.
 * @param announce Announces results in the page's live region.
 * @returns The state of the form, its submit handler and whether a save runs.
 */
function useSenderSave(
	sender: SenderPage['sender'],
	choices: Readonly<Choices>,
	announce: Announce,
): Save {
	const t = useT();
	const router = useRouter();
	const create = useServerFn(submitCreateSender);
	const update = useServerFn(submitUpdateSender);
	// The version a save gives, so the next save of the same page is not refused as changed.
	const [version, setVersion] = useState(sender?.version ?? 1);
	const [state, submitForm, isPending] = useActionState(
		async (_previous: FormState, formData: FormData): Promise<FormState> => {
			const isGraph = choices.kind === 'graph';
			const input = {
				archiveBcc: isGraph ? null : textValue(formData, 'archiveBcc'),
				areaIds: [...choices.areaIds],
				connectionId: choices.connectionId,
				dailyLimit: isGraph ? numberValue(formData, 'dailyLimit') : null,
				displayName: textValue(formData, 'displayName'),
				email: textValue(formData, 'email'),
				perMinute: isGraph ? numberValue(formData, 'perMinute') : null,
				replyTo: textValue(formData, 'replyTo'),
			};
			const call: Promise<CreatedResult | SavedResult> =
				sender === null
					? create({ data: { input } })
					: update({ data: { id: sender.id, input, version } });
			const result = await settle(call);
			if (result === undefined) return null;
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
				return null;
			}
			if (!result.ok) {
				if (result.failure === 'changed') announce(t('sending.changed'), 'alert');
				else if (result.failure === 'gone') announce(t('sending.senderGone'), 'alert');
				else if (result.failure === 'areaInUse') {
					announce(t('sending.areaInUse', { count: result.occasions.length }), 'alert');
				}
				return { fields: fieldErrors(result) };
			}
			if ('id' in result) {
				startTransition(async () => {
					await router.navigate({
						state: { sendingNotice: { kind: 'senderCreated', name: normalizeEmail(input.email) } },
						to: '/admin/sending',
					});
				});
				return null;
			}
			setVersion(result.version);
			announce(t('sending.saved'), 'status');
			startTransition(async () => router.invalidate());
			return null;
		},
		null,
	);
	const onSubmit = useFormSubmit(submitForm);
	return [state, onSubmit, isPending];
}

/**
 * The choice of the connection of a sender.
 *
 * @param props The props.
 * @param props.connections The connections to choose from.
 * @param props.value The chosen connection.
 * @param props.error The message of a refusal, or undefined.
 * @param props.onChange Called with the chosen connection.
 * @returns The select.
 */
function ConnectionSelect({
	connections,
	error,
	onChange,
	value,
}: Readonly<{
	connections: SenderPage['connections'];
	value: string;
	error: string | undefined;
	onChange: (id: string) => void;
}>): ReactNode {
	const t = useT();
	const change = useCallback(
		(key: Key | null) => {
			if (typeof key === 'string') onChange(key);
		},
		[onChange],
	);
	return (
		<Select className={fieldClass} isInvalid={error !== undefined} onChange={change} value={value}>
			<Label className="font-semibold">{t('sending.connectionLabel')}</Label>
			<Button className={selectButtonClass}>
				<SelectValue />
				<ChevronIcon />
			</Button>
			<FieldError className={errorClass}>{error}</FieldError>
			<Popover className={popoverClass}>
				<ListBox className="outline-none">
					{connections.map((connection) => (
						<ListBoxItem className={optionClass} id={connection.id} key={connection.id}>
							{connection.name}
						</ListBoxItem>
					))}
				</ListBox>
			</Popover>
		</Select>
	);
}

/**
 * The checkboxes of the areas a sender is released to.
 *
 * @param props The props.
 * @param props.areas The areas to choose from.
 * @param props.value The ids of the released areas.
 * @param props.error The message of a refusal, or undefined.
 * @param props.onChange Called with the released areas.
 * @returns The group.
 */
function AreasField({
	areas,
	error,
	onChange,
	value,
}: Readonly<{
	areas: SenderPage['areas'];
	value: readonly string[];
	error: string | undefined;
	onChange: (ids: readonly string[]) => void;
}>): ReactNode {
	const t = useT();
	const selected = useMemo(() => [...value], [value]);
	const change = useCallback(
		(ids: readonly string[]) => {
			onChange(ids);
		},
		[onChange],
	);
	return (
		<CheckboxGroup
			className="flex flex-col gap-2"
			isInvalid={error !== undefined}
			onChange={change}
			value={selected}
		>
			<Label className="font-semibold">{t('sending.areasLabel')}</Label>
			<Text className="text-sm" slot="description">
				{t('sending.areasHelp')}
			</Text>
			{areas.length === 0 ? <p>{t('sending.noAreasExist')}</p> : null}
			{areas.map((area) => (
				<LabelledCheckbox key={area.id} label={area.name} value={area.id} />
			))}
			<FieldError className={errorClass}>{error}</FieldError>
		</CheckboxGroup>
	);
}

/**
 * The fields that depend on the kind of the connection: the limits of a Graph sender, or the
 * archive copy of a Resend sender.
 *
 * @param props The props.
 * @param props.kind The kind of the chosen connection.
 * @param props.sender The sender to change, or null for a new one.
 * @returns The fields.
 */
function KindFields({
	kind,
	sender,
}: Readonly<{ kind: ConnectionKind; sender: SenderPage['sender'] }>): ReactNode {
	const t = useT();
	const dailyLimit = sender?.dailyLimit ?? null;
	if (kind === 'resend') {
		return (
			<>
				<p className="text-sm">{t('sending.inheritedLimits')}</p>
				<SenderTextField
					defaultValue={sender?.archiveBcc ?? ''}
					help={t('sending.archiveBccHelp')}
					label={t('sending.archiveBccLabel')}
					maxLength={MAX_ADDRESS_LENGTH}
					name="archiveBcc"
					type="email"
				/>
			</>
		);
	}
	return (
		<>
			<p className="text-sm">{t('sending.senderLimitsHelp')}</p>
			<SenderTextField
				defaultValue={String(sender?.perMinute ?? DEFAULT_GRAPH_PER_MINUTE)}
				isRequired
				label={t('sending.perMinuteLabel')}
				maxLength={6}
				name="perMinute"
			/>
			<SenderTextField
				defaultValue={dailyLimit === null ? '' : String(dailyLimit)}
				help={t('sending.dailyLimitHelp')}
				label={t('sending.dailyLimitLabel')}
				maxLength={8}
				name="dailyLimit"
			/>
		</>
	);
}

/**
 * The form of a sender: address, display name, reply-to address, connection, the limits of a
 * Graph sender or the archive copy of a Resend sender, and the released areas. A refused value
 * shows its message at its field.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.page The sender to change (or null for a new one) with the choices.
 * @returns The form.
 */
export function SenderForm({
	announce,
	page,
}: Readonly<{ announce: Announce; page: SenderPage }>): ReactNode {
	const t = useT();
	const formRef = useRef<HTMLFormElement>(null);
	const { areas, connections, sender } = page;
	const [connectionId, setConnectionId] = useState<string>(
		sender?.connectionId ?? connections[0]?.id ?? '',
	);
	const [areaIds, setAreaIds] = useState<readonly string[]>(sender?.areaIds ?? []);
	const kind = connections.find(({ id }) => id === connectionId)?.kind ?? 'graph';
	const [state, onSubmit, isPending] = useSenderSave(
		sender,
		{ areaIds, connectionId, kind },
		announce,
	);
	const validationErrors = useMemo(
		(): Readonly<Record<string, string>> =>
			Object.fromEntries(
				Object.entries(state?.fields ?? {}).map(([field, key]) => [field, t(key)]),
			),
		[state, t],
	);
	useEffect(() => {
		// A refused field gets the focus, so a screen reader reads it with its error.
		if (state === null || Object.keys(state.fields).length === 0) return;
		formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}, [state]);
	return (
		<PostForm
			className="flex max-w-xl flex-col gap-4"
			onSubmit={onSubmit}
			ref={formRef}
			validationErrors={validationErrors}
		>
			<SenderTextField
				defaultValue={sender?.email ?? ''}
				isRequired
				label={t('sending.senderEmailLabel')}
				maxLength={MAX_ADDRESS_LENGTH}
				name="email"
				type="email"
			/>
			<SenderTextField
				defaultValue={sender?.displayName ?? ''}
				isRequired
				label={t('sending.displayNameLabel')}
				maxLength={MAX_NAME_LENGTH}
				name="displayName"
			/>
			<SenderTextField
				defaultValue={sender?.replyTo ?? ''}
				help={t('sending.replyToHelp')}
				label={t('sending.replyToLabel')}
				maxLength={MAX_ADDRESS_LENGTH}
				name="replyTo"
				type="email"
			/>
			<ConnectionSelect
				connections={connections}
				error={validationErrors.connectionId}
				onChange={setConnectionId}
				value={connectionId}
			/>
			<KindFields kind={kind} sender={sender} />
			<AreasField
				areas={areas}
				error={validationErrors.areaIds}
				onChange={setAreaIds}
				value={areaIds}
			/>
			<div>
				<SubmitButton isPending={isPending}>
					{t(sender === null ? 'sending.create' : 'sending.save')}
				</SubmitButton>
			</div>
		</PostForm>
	);
}

/**
 * „Systemmails“ of a sender: says whether it sends them, and the button that makes it the system
 * sender (replacing the one before) or removes the mark.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.senderId The sender.
 * @param props.isSystem Whether it is the system sender.
 * @returns The section.
 */
export function SystemSenderControl({
	announce,
	isSystem,
	senderId,
}: Readonly<{ announce: Announce; senderId: string; isSystem: boolean }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const hydrated = useHydrated();
	const save = useServerFn(submitSystemSender);
	const [isPending, startPending] = useTransition();
	const toggle = useCallback(() => {
		startPending(async () => {
			const result = await settle(save({ data: { senderId: isSystem ? null : senderId } }));
			if (result === undefined) return;
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
				return;
			}
			if (result.ok) {
				announce(t(isSystem ? 'sending.systemClearDone' : 'sending.systemSetDone'), 'status');
			} else {
				announce(t('sending.senderGone'), 'alert');
			}
			startTransition(async () => router.invalidate());
		});
	}, [announce, isSystem, router, save, senderId, t]);
	return (
		<section className="flex max-w-xl flex-col gap-3">
			<h2 className="text-xl font-bold">{t('sending.systemHeading')}</h2>
			<p>{t(isSystem ? 'sending.systemOn' : 'sending.systemOff')}</p>
			<Button
				className={`self-start ${secondaryButtonClass}`}
				isPending={!hydrated || isPending}
				onPress={toggle}
			>
				{t(isSystem ? 'sending.systemClear' : 'sending.systemSet')}
			</Button>
		</section>
	);
}
