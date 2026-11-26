import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { AreasField, ConnectionSelect, KindFields } from '@/components/admin/sending/sender-fields';
import { SenderTextField } from '@/components/admin/sending/sender-text-field';
import { numberValue, textValue } from '@/components/admin/sending/sender-values';
import type { TextFieldName } from '@/components/admin/sending/sender-values';
import type { Announce } from '@/components/announcements';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import { SubmitButton } from '@/components/submit-button';
import { useFormSubmit } from '@/components/use-form-submit';
import { submitCreateSender, submitUpdateSender } from '@/functions/sending';
import type { SenderCreatedResult, SenderPage, SenderSavedResult } from '@/functions/sending';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import { normalizeEmail } from '@/server/auth/email';
import type { ConnectionKind } from '@/server/sending/connections';
import type { SendingFailure } from '@/server/sending/failures';
import { MAX_ADDRESS_LENGTH, MAX_NAME_LENGTH } from '@/server/sending/limits';
import type { SelfTestResult } from '@/server/sending/open-transport';

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

/** What the sender form holds besides its text fields. */
interface Choices {
	readonly connectionId: string;
	readonly kind: ConnectionKind;
	readonly areaIds: readonly string[];
}

/** What the save of a sender needs to know besides the sender. */
interface SaveContext {
	readonly choices: Choices;
	readonly announce: Announce;
	/** Called with the self test a save of a new address or connection ran. */
	readonly onSelfTest: (result: SelfTestResult) => void;
}

/** What saving a sender gave: the state of the form, its submit handler and whether it runs. */
type Save = readonly [FormState, ReturnType<typeof useFormSubmit>, boolean];

/**
 * The action of the form: creates the sender (and goes to the overview) or saves it, and turns a
 * refusal into the messages at the fields.
 *
 * @param sender The sender to change, or null for a new one.
 * @param context The chosen connection and areas, the live region and what to do with a self test.
 * @returns The state of the form, its submit handler and whether a save runs.
 */
function useSenderSave(sender: SenderPage['sender'], context: Readonly<SaveContext>): Save {
	const { announce, choices, onSelfTest } = context;
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
			const call: Promise<SenderCreatedResult | SenderSavedResult> =
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
						params: { senderId: result.id },
						state: {
							sendingNotice: { kind: 'senderCreated', name: normalizeEmail(input.email) },
							...(result.selfTest === null ? {} : { sendingSelfTest: result.selfTest }),
						},
						to: '/admin/sending/senders/$senderId',
					});
				});
				return null;
			}
			setVersion(result.version);
			if (result.selfTest !== null) onSelfTest(result.selfTest);
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
 * The form of a sender: address, display name, reply-to address, connection, the limits of a
 * Graph sender or the archive copy of a Resend sender, and the released areas. A refused value
 * shows its message at its field.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.page The sender to change (or null for a new one) with the choices.
 * @param props.onSelfTest Called with the self test a save of a new address or connection ran.
 * @returns The form.
 */
export function SenderForm({
	announce,
	onSelfTest,
	page,
}: Readonly<{
	announce: Announce;
	page: SenderPage;
	onSelfTest: (result: SelfTestResult) => void;
}>): ReactNode {
	const t = useT();
	const formRef = useRef<HTMLFormElement>(null);
	const { areas, connections, sender } = page;
	const [connectionId, setConnectionId] = useState<string>(
		sender?.connectionId ?? connections[0]?.id ?? '',
	);
	const [areaIds, setAreaIds] = useState<readonly string[]>(sender?.areaIds ?? []);
	const kind = connections.find(({ id }) => id === connectionId)?.kind ?? 'graph';
	const [state, onSubmit, isPending] = useSenderSave(sender, {
		announce,
		choices: { areaIds, connectionId, kind },
		onSelfTest,
	});
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
