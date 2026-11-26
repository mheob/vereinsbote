import { parseDate } from '@internationalized/date';
import type { ReactNode } from 'react';
import {
	DateField,
	DateInput,
	DateSegment,
	FieldError,
	Input,
	Label,
	Text,
	TextField,
} from 'react-aria-components';

import { LimitField } from '@/components/admin/sending/limit-field';
import { inputClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import type { ConnectionDetail } from '@/server/sending/connections';
import {
	DEFAULT_RESEND_PER_MINUTE,
	MAX_CREDENTIAL_LENGTH,
	MAX_DAILY_LIMIT,
	MAX_PER_MINUTE,
} from '@/server/sending/limits';

const fieldClass = 'flex max-w-xl flex-col gap-1';
const errorClass = 'text-sm text-red-700';
const dateInputClass =
	'flex w-fit rounded-md border border-gray-600 px-3 py-2 data-focus-within:outline-2 data-focus-within:outline-offset-2 data-focus-within:outline-blue-700 data-invalid:border-red-700';
const segmentClass =
	'rounded-sm px-0.5 tabular-nums outline-none data-focused:bg-blue-700 data-focused:text-white data-placeholder:text-gray-600';

/** The form fields by their name in the form. */
type FieldName =
	| 'apiKey'
	| 'clientId'
	| 'clientSecret'
	| 'dailyLimit'
	| 'name'
	| 'perMinute'
	| 'secretExpiresOn'
	| 'tenantId'
	| 'webhookSecret';

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
export function ConnectionTextField({
	defaultValue = '',
	help = null,
	isRequired = false,
	isSecret = false,
	label,
	maxLength = MAX_CREDENTIAL_LENGTH,
	name,
}: Readonly<{
	name: FieldName;
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

/**
 * The fields of a Graph connection: tenant, client, secret and the day the secret expires.
 *
 * @param props The props.
 * @param props.connection The connection to change, or null for a new one.
 * @returns The fields.
 */
export function GraphFields({
	connection,
}: Readonly<{ connection: ConnectionDetail | null }>): ReactNode {
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
export function ResendFields({
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
			<LimitField
				defaultValue={connection?.perMinute ?? DEFAULT_RESEND_PER_MINUTE}
				isRequired
				label={t('sending.perMinuteLabel')}
				maxValue={MAX_PER_MINUTE}
				name="perMinute"
			/>
			<LimitField
				defaultValue={dailyLimit ?? undefined}
				help={t('sending.dailyLimitHelp')}
				label={t('sending.dailyLimitLabel')}
				maxValue={MAX_DAILY_LIMIT}
				name="dailyLimit"
			/>
		</>
	);
}
