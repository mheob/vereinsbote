import { createFileRoute, useLoaderData, useRouter, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import { z } from 'zod';

import { Announcements, useAnnouncer } from '@/components/announcements';
import { ContactList } from '@/components/contacts/contact-list';
import { searchContacts } from '@/functions/contacts';
import { contactsPageHead } from '@/i18n/page-title';
import type { ContactsTitleContext } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';
import { CONTACT_KINDS } from '@/server/contacts/fields';
import type { ContactKind } from '@/server/contacts/fields';

/** The kind of `/contacts` without `kind`. */
const DEFAULT_KIND: ContactKind = 'member';

/**
 * Only the kind goes into the URL, and only for partners: `/contacts` lists the members. Search
 * and filters never go into the URL (design 13). An unknown kind shows the members.
 */
const contactsSearch = z.object({
	// oxlint-disable-next-line promise/prefer-await-to-then -- zod's fallback, not a promise
	kind: z.enum(CONTACT_KINDS).catch(DEFAULT_KIND).optional(),
});

const tabClass =
	'cursor-default border-b-4 border-transparent px-4 py-2 font-semibold text-gray-700 outline-none data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-hovered:bg-gray-100 data-selected:border-blue-700 data-selected:text-gray-900';

export const Route = createFileRoute('/contacts/')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function ContactsPage(): ReactNode {
		const t = useT();
		const router = useRouter();
		const kind = useSearch({ from: '/contacts/', select: (search) => search.kind ?? DEFAULT_KIND });
		const data = useLoaderData({ from: '/contacts/' });
		const [announcement, announce] = useAnnouncer();
		const [announcedKind, setAnnouncedKind] = useState(kind);
		if (announcedKind !== kind) {
			// The last message was about the list of the other kind; it is out of date now.
			setAnnouncedKind(kind);
			announce('', 'status');
		}
		// Without access the layout shows "no access" instead of this page.
		if (data === null) return null;
		return (
			<>
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-bold">{t('contacts.title')}</h1>
					<Announcements announcement={announcement} />
				</div>
				{/* The tabs are links: the kind is the page's address, the router keeps the frame. */}
				<Tabs selectedKey={kind}>
					<TabList aria-label={t('contacts.kindLabel')} className="flex border-b border-gray-600">
						{CONTACT_KINDS.map((tab) => (
							<Tab
								className={tabClass}
								href={
									router.buildLocation({
										search: { kind: tab === DEFAULT_KIND ? undefined : tab },
										to: '/contacts',
									}).href
								}
								id={tab}
								key={tab}
							>
								{t(`contacts.kind.${tab}`)}
							</Tab>
						))}
					</TabList>
					{/* One panel per tab; only the selected one renders, with a list that starts empty. */}
					{CONTACT_KINDS.map((panel) => (
						<TabPanel className="flex flex-col gap-6 pt-6 outline-none" id={panel} key={panel}>
							{panel === kind ? (
								<ContactList announce={announce} initial={data} kind={kind} />
							) : null}
						</TabPanel>
					))}
				</Tabs>
			</>
		);
	},
	head: (context: ContactsTitleContext) => contactsPageHead(context, 'contacts.title'),
	validateSearch: contactsSearch,

	// The loader depends on the kind. TypeScript infers the deps only from a property written
	// before the loader, so the two stand apart from the sorted keys above.
	loaderDeps: ({ search }) => ({ kind: search.kind ?? DEFAULT_KIND }),

	// The layout has decided already; for anybody without access there is nothing to load.
	loader: async ({ context, deps }) =>
		context.access.canList
			? searchContacts({ data: { filters: {}, kind: deps.kind, page: 1, query: '' } })
			: null,
});
