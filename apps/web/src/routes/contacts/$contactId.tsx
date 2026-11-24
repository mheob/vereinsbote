import { createFileRoute, useLoaderData } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useAnnouncer } from '@/components/announcements';
import { ContactDetails } from '@/components/contacts/contact-details';
import { loadContact, loadPartnerForm } from '@/functions/contacts';
import { contactsPageHead } from '@/i18n/page-title';
import type { ContactsTitleContext } from '@/i18n/page-title';

/**
 * One contact (design 12): the fields the user sees, the suppression and the opt-outs; a partner
 * can be edited and deleted by who manages partners. An unknown contact is "not found". After a
 * partner was created here, the page announces „Gespeichert.“ once and focuses its heading.
 */
export const Route = createFileRoute('/contacts/$contactId')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function ContactPage(): ReactNode {
		const data = useLoaderData({ from: '/contacts/$contactId' });
		const [announcement, announce] = useAnnouncer();
		// Without access the layout shows "no access" instead of this page.
		if (data === null) return null;
		return (
			<ContactDetails
				announce={announce}
				announcement={announcement}
				contact={data.contact}
				form={data.form}
				// Another contact is another page: no edit state of the one before.
				key={data.contact.id}
			/>
		);
	},
	head: (context: ContactsTitleContext) => contactsPageHead(context, 'contact.title'),
	// The layout has decided already; for anybody without access there is nothing to load.
	loader: async ({ context, params }) => {
		if (!context.access.canList) return null;
		const contact = await loadContact({ data: { contactId: params.contactId } });
		const form =
			contact.kind === 'partner' && contact.canManage
				? await loadPartnerForm({ data: { contactId: contact.id } })
				: null;
		return { contact, form };
	},
});
