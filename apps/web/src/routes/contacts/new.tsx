import { createFileRoute, useLoaderData, useRouter } from '@tanstack/react-router';
import { useCallback, useId } from 'react';
import type { ReactNode } from 'react';

import { Announcements, useAnnouncer } from '@/components/announcements';
import { PartnerForm } from '@/components/contacts/partner-form';
import { loadPartnerForm } from '@/functions/contacts';
import { contactsPageHead } from '@/i18n/page-title';
import type { ContactsTitleContext } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * Adds a partner (design 12). Without `edit` in the partners area the server function answers
 * 403 and the page says „Kein Zugriff“. After saving, the partner's page opens and announces
 * „Gespeichert.“; the history state carries that, not the URL.
 */
export const Route = createFileRoute('/contacts/new')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function NewPartnerPage(): ReactNode {
		const t = useT();
		const router = useRouter();
		const page = useLoaderData({ from: '/contacts/new' });
		const headingId = useId();
		const [announcement, announce] = useAnnouncer();
		const onSaved = useCallback(
			async (contactId: string) => {
				await router.navigate({
					params: { contactId },
					state: { partnerSaved: true },
					to: '/contacts/$contactId',
				});
			},
			[router],
		);
		// Without access the layout shows "no access" instead of this page.
		if (page === null) return null;
		if (!page.canManage) {
			return (
				<div className="flex max-w-md flex-col gap-4">
					<h1 className="text-2xl font-bold">{t('admin.forbidden')}</h1>
					<p>{t('partner.forbiddenText')}</p>
				</div>
			);
		}
		return (
			<>
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-bold" id={headingId}>
						{t('partner.newTitle')}
					</h1>
					<Announcements announcement={announcement} />
				</div>
				<PartnerForm
					announce={announce}
					contactId={null}
					form={page}
					labelledBy={headingId}
					onSaved={onSaved}
				/>
			</>
		);
	},
	head: (context: ContactsTitleContext) => contactsPageHead(context, 'partner.newTitle', 'partner'),
	// The layout has decided already; for anybody without access there is nothing to load.
	loader: async ({ context }) => (context.access.canList ? loadPartnerForm({ data: {} }) : null),
});
