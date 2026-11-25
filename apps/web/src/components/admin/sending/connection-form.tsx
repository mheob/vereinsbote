import { parseDate } from '@internationalized/date';
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
} from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	DateField,
	DateInput,
	DateSegment,
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
import { ChevronIcon } from '@/components/icons';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import { inputClass, optionClass, popoverClass, selectButtonClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { useFormSubmit } from '@/components/use-form-submit';
import { submitCreateConnection, submitUpdateConnection } from '@/functions/sending';
import type { CreatedResult, SavedResult } from '@/functions/sending';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import type {
	ConnectionDetail,
	ConnectionInput,
	ConnectionKind,
} from '@/server/sending/connections';
import type { SendingFailure } from '@/server/sending/failures';
import {
	DEFAULT_RESEND_PER_MINUTE,
	MAX_CREDENTIAL_LENGTH,
	MAX_NAME_LENGTH,
} from '@/server/sending/limits';

const KINDS: readonly Readonly<{ id: ConnectionKind; label: MessageKey }>[] = [
	{ id: 'graph', label: 'sending.kindGraph' },
	{ id: 'resend', label: 'sending.kindResend' },
];
const fieldClass = 'flex max-w-xl flex-col gap-1';
const errorClass = 'text-sm text-red-700';
const dateInputClass =
	'flex w-fit rounded-md border border-gray-600 px-3 py-2 data-focus-within:outline-2 data-focus-within:outline-offset-2 data-focus-within:outline-blue-700 data-invalid:border-red-700';
const segmentClass =
	'rounded-sm px-0.5 tabular-nums outline-none data-focused:bg-blue-700 data-focused:text-white data-placeholder:text-gray-600';

/** The form fields by their name in the form; the refused field of the server maps to one. */
type FormField =
	| 'apiKey'
	| 'clientId'
	| 'clientSecret'
	| 'dailyLimit'
	| 'name'
	| 'perMinute'
	| 'secretExpiresOn'
	| 'tenantId'
	| 'webhookSecret';

/** The state of the form after a refusal; null before the first and after a success. */
type FormState = Readonly<{ fields: Readonly<Partial<Record<FormField, MessageKey>>> }> | null;

/**
 * Reads a text field of the submitted form.
 *
 * @param formData The submitted form.
 * @param name The field name.
 * @returns The value, or an empty string.
 */
function textField(formData: FormData, name: FormField): string {
	const value = formData.get(name);
	return typeof value === 'string' ? value : '';
}

/**
 * A secret field of the submitted form: empty is `null`, the stored one stays.
 *
 * @param formData The submitted form.
 * @param name The field name.
 * @returns The secret, or null.
 */
function secretField(formData: FormData, name: FormField): string | null {
	const value = textField(formData, name);
	return value === '' ? null : value;
}

/**
 * A number field of the submitted form: empty is null, a text that is no number is NaN (which
 * the server refuses).
 *
 * @param formData The submitted form.
 * @param name The field name.
 * @returns The number, or null.
 */
function numberField(formData: FormData, name: FormField): number | null {
	const value = textField(formData, name).trim();
	return value === '' ? null : Number(value);
}

/**
 * What the form sends for the chosen kind.
 *
 * @param kind The kind.
 * @param formData The submitted form.
 * @returns The input of the server function.
 */
function inputOf(kind: ConnectionKind, formData: FormData): ConnectionInput {
	const name = textField(formData, 'name');
	if (kind === 'graph') {
		return {
			clientId: textField(formData, 'clientId'),
			clientSecret: secretField(formData, 'clientSecret'),
			kind,
			name,
			secretExpiresOn: textField(formData, 'secretExpiresOn'),
			tenantId: textField(formData, 'tenantId'),
		};
	}
	return {
		apiKey: secretField(formData, 'apiKey'),
		dailyLimit: numberField(formData, 'dailyLimit'),
		kind,
		name,
		perMinute: numberField(formData, 'perMinute') ?? Number.NaN,
		webhookSecret: secretField(formData, 'webhookSecret'),
	};
}

/**
 * The message at the field a refusal belongs to.
 *
 * @param failure The refusal.
 * @param kind The kind of the form, which names the secret field.
 * @returns The message per field; empty for a refusal that belongs to no field.
 */
function fieldErrors(
	failure: SendingFailure,
	kind: ConnectionKind,
): Readonly<Partial<Record<FormField, MessageKey>>> {
	if (failure.failure === 'nameTaken') return { name: 'sending.nameTaken' };
	if (failure.failure !== 'invalid') return {};
	const secretName: FormField = kind === 'graph' ? 'clientSecret' : 'apiKey';
	const byField: Readonly<Record<string, readonly [FormField, MessageKey]>> = {
		clientId: ['clientId', 'sending.valueRequired'],
		dailyLimit: ['dailyLimit', 'sending.limitInvalid'],
		name: ['name', 'sending.nameInvalid'],
		perMinute: ['perMinute', 'sending.limitInvalid'],
		secret: [secretName, 'sending.secretRequired'],
		secretExpiresOn: ['secretExpiresOn', 'sending.dateInvalid'],
		tenantId: ['tenantId', 'sending.valueRequired'],
	};
	const entry = byField[failure.field];
	return entry === undefined ? {} : { [entry[0]]: entry[1] };
}

/**
 * A text field of the form. A secret field is a password field that is empty; a stored secret is
 * said in its description.
 *
 * @param props The props.
 * @param props.name The field name.
 * @param props.label The label.
 * @param props.defaultValue The stored value, or an empty string.
 * @param props.isRequired Whether the browser asks for a value.
 * @param props.isSecret Whether it is a secret.
 * @param props.help A description, or null.
 * @param props.maxLength The longest value.
 * @returns The field.
 */
function ConnectionTextField({
	defaultValue = '',
	help = null,
	isRequired = false,
	isSecret = false,
	label,
	maxLength = MAX_CREDENTIAL_LENGTH,
	name,
}: Readonly<{
	name: FormField;
	label: string;
	defaultValue?: string;
	isRequired?: boolean;
	isSecret?: boolean;
	help?: string | null;
	maxLength?: number;
}>): ReactNode {
	return (
		<TextField
			autoComplete="off"
			className={fieldClass}
			defaultValue={defaultValue}
			isRequired={isRequired}
			maxLength={maxLength}
			name={name}
			type={isSecret ? 'password' : 'text'}
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

/** What saving a connection gave: the state of the form, its submit handler and whether it runs. */
type Save = readonly [FormState, ReturnType<typeof useFormSubmit>, boolean];

/**
 * The action of the form: creates the connection (and goes to the overview) or saves it, and
 * turns a refusal into the messages at the fields.
 *
 * @param connection The connection to change, or null for a new one.
 * @param kind The chosen kind.
 * @param announce Announces results in the page's live region.
 * @returns The state of the form, its submit handler and whether a save runs.
 */
function useConnectionSave(
	connection: ConnectionDetail | null,
	kind: ConnectionKind,
	announce: Announce,
): Save {
	const t = useT();
	const router = useRouter();
	const create = useServerFn(submitCreateConnection);
	const update = useServerFn(submitUpdateConnection);
	// The version a save gives, so the next save of the same page is not refused as changed.
	const [version, setVersion] = useState(connection?.version ?? 1);
	const [state, submitForm, isPending] = useActionState(
		async (_previous: FormState, formData: FormData): Promise<FormState> => {
			const input = inputOf(kind, formData);
			const call: Promise<CreatedResult | SavedResult> =
				connection === null
					? create({ data: { input } })
					: update({ data: { id: connection.id, input, version } });
			const result = await settle(call);
			if (result === undefined) return null;
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
				return null;
			}
			if (!result.ok) {
				if (result.failure === 'changed') announce(t('sending.changed'), 'alert');
				else if (result.failure === 'gone') announce(t('sending.connectionGone'), 'alert');
				return { fields: fieldErrors(result, kind) };
			}
			if ('id' in result) {
				startTransition(async () => {
					await router.navigate({
						state: { sendingNotice: { kind: 'connectionCreated', name: input.name.trim() } },
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
 * The choice of the provider of a new connection; a stored connection names its provider.
 *
 * @param props The props.
 * @param props.kind The chosen kind.
 * @param props.isNew Whether the connection is new, so the kind can be chosen.
 * @param props.onChange Called with the new kind.
 * @returns The select, or the name of the kind.
 */
function KindField({
	isNew,
	kind,
	onChange,
}: Readonly<{
	kind: ConnectionKind;
	isNew: boolean;
	onChange: (kind: ConnectionKind) => void;
}>): ReactNode {
	const t = useT();
	const change = useCallback(
		(key: Key | null) => {
			if (key === 'graph' || key === 'resend') onChange(key);
		},
		[onChange],
	);
	if (!isNew) {
		return (
			<p>
				<span className="font-semibold">{`${t('sending.kindLabel')}: `}</span>
				{t(kind === 'graph' ? 'sending.kindGraph' : 'sending.kindResend')}
			</p>
		);
	}
	return (
		<Select className={fieldClass} onChange={change} value={kind}>
			<Label className="font-semibold">{t('sending.kindLabel')}</Label>
			<Button className={selectButtonClass}>
				<SelectValue />
				<ChevronIcon />
			</Button>
			<Popover className={popoverClass}>
				<ListBox className="outline-none">
					{KINDS.map((item) => (
						<ListBoxItem className={optionClass} id={item.id} key={item.id}>
							{t(item.label)}
						</ListBoxItem>
					))}
				</ListBox>
			</Popover>
		</Select>
	);
}

/**
 * The fields of a Graph connection: tenant, client, secret and the day the secret expires.
 *
 * @param props The props.
 * @param props.connection The connection to change, or null for a new one.
 * @returns The fields.
 */
function GraphFields({ connection }: Readonly<{ connection: ConnectionDetail | null }>): ReactNode {
	const t = useT();
	const expiresOn = connection?.secretExpiresOn ?? null;
	return (
		<>
			<ConnectionTextField
				defaultValue={connection?.tenantId ?? ''}
				isRequired
				label={t('sending.tenantLabel')}
				name="tenantId"
			/>
			<ConnectionTextField
				defaultValue={connection?.clientId ?? ''}
				isRequired
				label={t('sending.clientIdLabel')}
				name="clientId"
			/>
			<ConnectionTextField
				help={connection === null ? null : t('sending.secretSaved')}
				isRequired={connection === null}
				isSecret
				label={t('sending.clientSecretLabel')}
				name="clientSecret"
			/>
			<DateField
				className={fieldClass}
				defaultValue={expiresOn === null ? null : parseDate(expiresOn)}
				isRequired
				name="secretExpiresOn"
			>
				<Label className="font-semibold">{t('sending.secretExpiresLabel')}</Label>
				<DateInput className={dateInputClass}>
					{(segment) => <DateSegment className={segmentClass} segment={segment} />}
				</DateInput>
				<Text className="text-sm" slot="description">
					{t('sending.graphHelp')}
				</Text>
				<FieldError className={errorClass} />
			</DateField>
		</>
	);
}

/**
 * The fields of a Resend connection: API key, webhook secret and the limits of the account.
 *
 * @param props The props.
 * @param props.connection The connection to change, or null for a new one.
 * @returns The fields.
 */
function ResendFields({
	connection,
}: Readonly<{ connection: ConnectionDetail | null }>): ReactNode {
	const t = useT();
	const dailyLimit = connection?.dailyLimit ?? null;
	const savedHint = t('sending.secretSaved');
	return (
		<>
			<ConnectionTextField
				help={connection === null ? null : savedHint}
				isRequired={connection === null}
				isSecret
				label={t('sending.apiKeyLabel')}
				name="apiKey"
			/>
			<ConnectionTextField
				help={connection?.hasWebhookSecret === true ? savedHint : t('sending.webhookSecretHelp')}
				isSecret
				label={t('sending.webhookSecretLabel')}
				name="webhookSecret"
			/>
			<p className="text-sm">{t('sending.resendLimitsHelp')}</p>
			<ConnectionTextField
				defaultValue={String(connection?.perMinute ?? DEFAULT_RESEND_PER_MINUTE)}
				isRequired
				label={t('sending.perMinuteLabel')}
				maxLength={6}
				name="perMinute"
			/>
			<ConnectionTextField
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
 * The form of a connection, to create one (with the choice of the provider) or to change one
 * (the provider stays). Secrets are empty fields that say „Gespeichert“ when one is stored; an
 * empty field keeps the stored secret. A refused value shows its message at its field.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.connection The connection to change, or null for a new one.
 * @returns The form.
 */
export function ConnectionForm({
	announce,
	connection,
}: Readonly<{ announce: Announce; connection: ConnectionDetail | null }>): ReactNode {
	const t = useT();
	const formRef = useRef<HTMLFormElement>(null);
	const [kind, setKind] = useState<ConnectionKind>(connection?.kind ?? 'graph');
	const [state, onSubmit, isPending] = useConnectionSave(connection, kind, announce);
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
			<KindField isNew={connection === null} kind={kind} onChange={setKind} />
			<ConnectionTextField
				defaultValue={connection?.name}
				isRequired
				label={t('sending.nameLabel')}
				maxLength={MAX_NAME_LENGTH}
				name="name"
			/>
			{kind === 'graph' ? (
				<GraphFields connection={connection} />
			) : (
				<ResendFields connection={connection} />
			)}
			<div>
				<SubmitButton isPending={isPending}>
					{t(connection === null ? 'sending.create' : 'sending.save')}
				</SubmitButton>
			</div>
		</PostForm>
	);
}
