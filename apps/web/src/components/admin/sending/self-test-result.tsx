import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { startTransition, useCallback, useId, useMemo, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { FieldError, Input, Label, Text, TextField } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import { inputClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import type { SubmitHandler } from '@/components/use-form-submit';
import { submitSelfTest } from '@/functions/sending';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import { MAX_ADDRESS_LENGTH } from '@/server/sending/limits';
import type { SelfTestResult } from '@/server/sending/open-transport';

const TOKEN_TEXT = {
	failed: 'sending.testTokenFailed',
	ok: 'sending.testTokenOk',
	unchecked: 'sending.testTokenUnchecked',
} as const satisfies Record<SelfTestResult['token'], MessageKey>;

const RESTRICTION_TEXT = {
	readable: 'sending.testReadable',
	restricted: 'sending.testRestricted',
	unknown: 'sending.testUnknown',
} as const satisfies Record<NonNullable<SelfTestResult['restriction']>, MessageKey>;

/**
 * The outcome of a self test as a list of what each step found. The restriction result of Graph
 * is a warning when the mailboxes of others are readable.
 *
 * @param props The props.
 * @param props.result The outcome.
 * @returns The list.
 */
export function SelfTestOutcome({ result }: Readonly<{ result: SelfTestResult }>): ReactNode {
	const t = useT();
	const headingId = useId();
	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-1">
			<h3 className="font-semibold" id={headingId}>
				{t('sending.selfTestResult')}
			</h3>
			<ul className="list-disc pl-6">
				<li>{t(TOKEN_TEXT[result.token])}</li>
				<li>{t(result.testMail === 'sent' ? 'sending.testMailSent' : 'sending.testMailFailed')}</li>
				{result.restriction === null ? null : (
					<li
						className={result.restriction === 'readable' ? 'font-semibold text-red-700' : undefined}
					>
						{t(RESTRICTION_TEXT[result.restriction])}
					</li>
				)}
			</ul>
		</section>
	);
}

/**
 * What the check of the credentials after a save found, in the same place as the self test. A
 * check that could not run says so.
 *
 * @param props The props.
 * @param props.check The result, or null when the check itself failed.
 * @returns The line.
 */
export function ConnectionCheckOutcome({
	check,
}: Readonly<{ check: SelfTestResult['token'] | null }>): ReactNode {
	const t = useT();
	return (
		<p aria-live="polite" className={check === 'failed' ? 'font-semibold text-red-700' : undefined}>
			{check === null ? t('sending.checkNotRun') : t(TOKEN_TEXT[check])}
		</p>
	);
}

/**
 * „Selbsttest“ of a sender: for Graph the mailbox of the restriction test (the admin's own
 * address until changed), then the button. The result is listed below; the stored restriction on
 * the connection is shown by the pages after they load anew.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.senderId The sender.
 * @param props.isGraph Whether the sender is on a Graph connection (the restriction test applies).
 * @param props.defaultProbe The admin's own address.
 * @param props.result The last outcome (also one the save of the sender gave), or null.
 * @param props.onResult Called with the outcome of a test run here.
 * @returns The section.
 */
export function SelfTest({
	announce,
	defaultProbe,
	isGraph,
	onResult,
	result,
	senderId,
}: Readonly<{
	announce: Announce;
	senderId: string;
	isGraph: boolean;
	defaultProbe: string;
	result: SelfTestResult | null;
	onResult: (result: SelfTestResult) => void;
}>): ReactNode {
	const t = useT();
	const router = useRouter();
	const headingId = useId();
	const run = useServerFn(submitSelfTest);
	const [probe, setProbe] = useState(defaultProbe);
	const [probeError, setProbeError] = useState<string | null>(null);
	const [isPending, startPending] = useTransition();
	const validationErrors = useMemo(
		(): Readonly<Record<string, string>> =>
			probeError === null ? {} : { probeMailbox: probeError },
		[probeError],
	);
	const changeProbe = useCallback((value: string) => {
		setProbe(value);
		setProbeError(null);
	}, []);
	const onSubmit = useCallback<SubmitHandler>(
		(event) => {
			event.preventDefault();
			startPending(async () => {
				const outcome = await settle(
					run({ data: { probeMailbox: isGraph ? probe : null, senderId } }),
				);
				if (outcome === undefined) return;
				if (outcome === FAILED) {
					announce(t('auth.requestFailed'), 'alert');
					return;
				}
				if (outcome.ok) {
					onResult(outcome.result);
					startTransition(async () => router.invalidate());
				} else if (outcome.failure === 'invalid') {
					setProbeError(t('sending.probeInvalid'));
				} else {
					announce(t('sending.senderGone'), 'alert');
				}
			});
		},
		[announce, isGraph, onResult, probe, router, run, senderId, t],
	);
	return (
		<section aria-labelledby={headingId} className="flex max-w-xl flex-col gap-3">
			<h2 className="text-xl font-bold" id={headingId}>
				{t('sending.selfTestHeading')}
			</h2>
			<p>{t('sending.selfTestHelp')}</p>
			<PostForm
				className="flex flex-col gap-3"
				onSubmit={onSubmit}
				validationErrors={validationErrors}
			>
				{isGraph ? (
					<TextField
						className="flex flex-col gap-1"
						maxLength={MAX_ADDRESS_LENGTH}
						name="probeMailbox"
						onChange={changeProbe}
						type="email"
						value={probe}
					>
						<Label className="font-semibold">{t('sending.probeLabel')}</Label>
						<Input className={inputClass} />
						<Text className="text-sm" slot="description">
							{t('sending.probeHelp')}
						</Text>
						<FieldError className="text-sm text-red-700" />
					</TextField>
				) : null}
				<div>
					<SubmitButton isPending={isPending}>{t('sending.selfTestRun')}</SubmitButton>
				</div>
			</PostForm>
			<div aria-live="polite">{result === null ? null : <SelfTestOutcome result={result} />}</div>
		</section>
	);
}
