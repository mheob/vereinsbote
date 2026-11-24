import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { startTransition, useCallback, useId, useOptimistic, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { submitOptOut, submitSuppression } from '@/functions/contacts';
import type { OptOutResult } from '@/functions/contacts';
import type { MessageKey } from '@/i18n/translate';
import { useLocale, useT } from '@/i18n/use-t';
import { formatClubDate } from '@/server/contacts/calendar';
import type { ContactDetail } from '@/server/contacts/contacts';

import { LabelledCheckbox } from './import/labelled-checkbox';

/** An area as the opt-out checkboxes need it. */
type OptOutArea = Readonly<{ id: string; name: string }>;

/**
 * The message of a refused or failed change.
 *
 * @param result The result of the server function, or `failed`.
 * @returns The key of the message.
 */
function failureMessage(result: Exclude<OptOutResult, { ok: true }> | typeof FAILED): MessageKey {
	if (result === FAILED) return 'auth.requestFailed';
	return result.failure === 'areaNotFound' ? 'contact.areaGone' : 'contact.gone';
}

/**
 * The suppression: since when it holds and, with the right, the button „Keine Mails mehr“ or
 * „Sperre aufheben“. The button keeps the focus and shows the new state at once; the page
 * reloads the contact afterwards.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.contact The contact.
 * @returns The section.
 */
function SuppressionSection({
	announce,
	contact,
}: Readonly<{ announce: Announce; contact: ContactDetail }>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const router = useRouter();
	const hydrated = useHydrated();
	const headingId = useId();
	const save = useServerFn(submitSuppression);
	const [isPending, startPending] = useTransition();
	const [suppressed, showSuppressed] = useOptimistic(contact.suppression !== null);
	const toggle = useCallback(() => {
		const next = !suppressed;
		startPending(async () => {
			showSuppressed(next);
			const result = await settle(save({ data: { contactId: contact.id, suppressed: next } }));
			if (result === undefined) return;
			if (result !== FAILED && result.ok) {
				await router.invalidate();
				announce(t(next ? 'contact.suppressed' : 'contact.unsuppressed'), 'status');
			} else {
				announce(t(failureMessage(result)), 'alert');
			}
		});
	}, [announce, contact.id, router, save, showSuppressed, suppressed, t]);
	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-3">
			<h2 className="text-xl font-bold" id={headingId}>
				{t('contact.suppressionTitle')}
			</h2>
			<p>
				{contact.suppression === null
					? t('contact.notSuppressed')
					: t('contact.suppressedSince', {
							date: formatClubDate(new Date(contact.suppression.at), locale),
						})}
			</p>
			{contact.canManage ? (
				<Button
					className={`self-start ${secondaryButtonClass}`}
					// Pending until hydrated: focusable, but a press does nothing yet.
					isPending={!hydrated || isPending}
					onPress={toggle}
				>
					{t(suppressed ? 'contact.unsuppress' : 'contact.suppress')}
				</Button>
			) : null}
		</section>
	);
}

/**
 * The opt-out of one area as a checkbox „Widerspruch für {area}“. A change is saved at once and
 * shown until the saved state arrives; a refused or failed save falls back to the stored state.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.area The area.
 * @param props.contactId The contact.
 * @param props.since When the stored opt-out was recorded, or null without one.
 * @returns The checkbox with the date of the opt-out.
 */
function OptOutCheckbox({
	announce,
	area,
	contactId,
	since,
}: Readonly<{
	announce: Announce;
	area: OptOutArea;
	contactId: string;
	since: string | null;
}>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const router = useRouter();
	const save = useServerFn(submitOptOut);
	const [optedOut, showOptedOut] = useOptimistic(since !== null);
	const onChange = useCallback(
		(next: boolean) => {
			startTransition(async () => {
				showOptedOut(next);
				const result = await settle(save({ data: { areaId: area.id, contactId, optedOut: next } }));
				if (result === undefined) return;
				if (result !== FAILED && result.ok) {
					await router.invalidate();
					const message = next ? 'contact.optedOut' : 'contact.optOutRemoved';
					announce(t(message, { area: area.name }), 'status');
					return;
				}
				// A deleted area leaves the list once the page is loaded anew.
				if (result !== FAILED && result.failure === 'areaNotFound') await router.invalidate();
				announce(t(failureMessage(result)), 'alert');
			});
		},
		[announce, area, contactId, router, save, showOptedOut, t],
	);
	return (
		<li className="flex flex-wrap items-center gap-x-3">
			<LabelledCheckbox
				isSelected={optedOut}
				label={t('contact.optOut', { area: area.name })}
				onChange={onChange}
			/>
			{since === null ? null : (
				<span className="text-sm text-gray-700">
					{t('contact.since', { date: formatClubDate(new Date(since), locale) })}
				</span>
			)}
		</li>
	);
}

/**
 * The opt-outs per area. Without the right a list of the opt-outs; with it a checkbox per area.
 *
 * @param props The props.
 * @param props.announce Announces the result of a change.
 * @param props.contact The contact.
 * @returns The section.
 */
function OptOutSection({
	announce,
	contact,
}: Readonly<{ announce: Announce; contact: ContactDetail }>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const headingId = useId();
	const helpId = useId();
	const since = new Map(contact.optOuts.map((optOut) => [optOut.areaId, optOut.at]));
	let content: ReactNode = <p>{t('contact.noOptOuts')}</p>;
	if (contact.canManage) {
		content = (
			<ul aria-describedby={helpId} aria-labelledby={headingId} className="flex flex-col gap-2">
				{contact.areas.map((area) => (
					<OptOutCheckbox
						announce={announce}
						area={area}
						contactId={contact.id}
						key={area.id}
						since={since.get(area.id) ?? null}
					/>
				))}
			</ul>
		);
	} else if (contact.optOuts.length > 0) {
		content = (
			<ul aria-labelledby={headingId} className="list-disc pl-6">
				{contact.optOuts.map((optOut) => (
					<li key={optOut.areaId}>
						{t('contact.optOutSince', {
							area: optOut.areaName,
							date: formatClubDate(new Date(optOut.at), locale),
						})}
					</li>
				))}
			</ul>
		);
	}
	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-3">
			<h2 className="text-xl font-bold" id={headingId}>
				{t('contact.optOutsTitle')}
			</h2>
			<p id={helpId}>{t('contact.optOutsHelp')}</p>
			{content}
		</section>
	);
}

/**
 * The suppression and the opt-outs of a contact. Who may manage the contact's kind changes them
 * here; everybody else sees them.
 *
 * @param props The props.
 * @param props.announce Announces the result of a change.
 * @param props.contact The contact.
 * @returns The two sections.
 */
export function SuppressionPanel({
	announce,
	contact,
}: Readonly<{ announce: Announce; contact: ContactDetail }>): ReactNode {
	return (
		<>
			<SuppressionSection announce={announce} contact={contact} />
			<OptOutSection announce={announce} contact={contact} />
		</>
	);
}
