import { createFileRoute, useLoaderData } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { ImportPage } from '@/components/contacts/import/import-wizard';
import { loadImportPage } from '@/functions/contact-import';
import { contactsPageHead } from '@/i18n/page-title';
import type { ContactsTitleContext } from '@/i18n/page-title';

/**
 * The import of the members (design 7 and 8). The server function checks the right itself and
 * answers 403 without it; the page then says „Kein Zugriff“.
 */
export const Route = createFileRoute('/contacts/import/members')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function MembersImportPage(): ReactNode {
		const page = useLoaderData({ from: '/contacts/import/members' });
		return <ImportPage kind="member" page={page} />;
	},
	head: (context: ContactsTitleContext) =>
		contactsPageHead(context, 'import.membersTitle', 'member'),
	loader: async () => loadImportPage({ data: { kind: 'member' } }),
});
