import { createFileRoute, useLoaderData } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Announcements, useAnnouncer } from '@/components/announcements';
import { AreaOverviewView } from '@/components/sending/area-overview';
import { loadSendingOverview } from '@/functions/waves';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * The sending overview (Design 16): per area the user reads its waves with their state and counts,
 * and its bounce marks. Without `read` in any area the page says so; the navigation shows no
 * „Versand“ then.
 */
export const Route = createFileRoute('/sending/')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function SendingOverviewPage(): ReactNode {
		const t = useT();
		const data = useLoaderData({ from: '/sending/' });
		const [announcement, announce] = useAnnouncer();
		return (
			<>
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-bold">{t('overview.title')}</h1>
					<Announcements announcement={announcement} />
				</div>
				{data.overview === null ? (
					<p>{t('overview.noArea')}</p>
				) : (
					<AreaOverviewView announce={announce} areas={data.areas} initial={data.overview} />
				)}
			</>
		);
	},
	// A fresh overview on every visit.
	gcTime: 0,
	head: (context) => pageHead(context, 'overview.title'),
	loader: async () => loadSendingOverview(),
});
