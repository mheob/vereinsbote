import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useId, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { submitClearBounce } from '@/functions/contacts';
import { useLocale, useT } from '@/i18n/use-t';
import { formatClubDate } from '@/server/contacts/calendar';
import type { ContactDetail } from '@/server/contacts/contacts';

/**
 * The mark „E-Mail ungültig“ of the contact's address (a hard bounce): since when it holds and,
 * for who has `edit` in its area, the button „Markierung aufheben“. The section goes once the mark
 * is cleared; the focus then moves to the page's heading (`onCleared`) and the page announces it.
 * Without a mark there is no section.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.contact The contact.
 * @param props.onCleared Called once the mark is cleared and the page is loaded anew.
 * @returns The section, or nothing.
 */
export function BounceSection({
	announce,
	contact,
	onCleared,
}: Readonly<{ announce: Announce; contact: ContactDetail; onCleared: () => void }>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const router = useRouter();
	const hydrated = useHydrated();
	const headingId = useId();
	const clear = useServerFn(submitClearBounce);
	const [isPending, startPending] = useTransition();
	const onPress = useCallback(() => {
		startPending(async () => {
			const result = await settle(clear({ data: { contactId: contact.id } }));
			if (result === undefined) return;
			if (result === FAILED || !result.ok) {
				announce(t(result === FAILED ? 'auth.requestFailed' : 'contact.gone'), 'alert');
				return;
			}
			await router.invalidate();
			onCleared();
			announce(t('contact.bounceCleared'), 'status');
		});
	}, [announce, clear, contact.id, onCleared, router, t]);
	if (contact.bounce === null) return null;
	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-3">
			<h2 className="text-xl font-bold" id={headingId}>
				{t('contact.bounceTitle')}
			</h2>
			<p>
				{t('contact.bounceText', { date: formatClubDate(new Date(contact.bounce.at), locale) })}
			</p>
			{contact.bounce.canClear ? (
				<Button
					className={`self-start ${secondaryButtonClass}`}
					// Pending until hydrated: focusable, but a press does nothing yet.
					isPending={!hydrated || isPending}
					onPress={onPress}
				>
					{t('contact.clearBounce')}
				</Button>
			) : null}
		</section>
	);
}
