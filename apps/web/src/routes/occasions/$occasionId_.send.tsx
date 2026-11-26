import { createFileRoute, Link, useLoaderData, useRouter } from '@tanstack/react-router';
import { startTransition, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';

import { Announcements, useAnnouncer } from '@/components/announcements';
import type { ConfirmedWave } from '@/components/sending/confirm-dialog';
import { SendFlow } from '@/components/sending/send-flow';
import { linkClass } from '@/components/styles';
import { loadSendFlow } from '@/functions/waves';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * The manual send flow of an occasion (Design 10), for whoever may send in its area. An occasion
 * that does not exist, one the user may not send for and an archived one are "not found". After
 * the confirmation the occasion's page announces the wave once, from the history state, never
 * from the URL. The file name ends the occasion's segment with `_`, so the flow is a page of its
 * own and not a part of the occasion's page.
 */
export const Route = createFileRoute('/occasions/$occasionId_/send')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function SendFlowPage(): ReactNode {
		const t = useT();
		const router = useRouter();
		const page = useLoaderData({ from: '/occasions/$occasionId_/send' });
		const [announcement, announce] = useAnnouncer();
		const { occasion } = page;
		const params = useMemo(() => ({ occasionId: occasion.id }), [occasion.id]);
		const onConfirmed = useCallback(
			(wave: ConfirmedWave) => {
				startTransition(async () => {
					await router.navigate({
						params,
						state: {
							waveNotice: { mails: wave.mails, notBefore: wave.notBefore?.toISOString() ?? null },
						},
						to: '/occasions/$occasionId',
					});
				});
			},
			[params, router],
		);
		return (
			<>
				<Link className={`self-start ${linkClass}`} params={params} to="/occasions/$occasionId">
					{t('send.back')}
				</Link>
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-bold">{t('send.title', { name: occasion.name })}</h1>
					<p>{t('send.senderNote', { sender: page.sender.label })}</p>
					<Announcements announcement={announcement} />
				</div>
				<SendFlow announce={announce} onConfirmed={onConfirmed} page={page} />
			</>
		);
	},
	// A fresh load on every visit: the files, the template and the occasion may have changed.
	gcTime: 0,
	// The context is annotated: the loader reads `params`, and an unannotated `head` would keep
	// TypeScript from inferring the loader's data (like the occasion page).
	head: (context: Parameters<typeof pageHead>[0]) => pageHead(context, 'send.pageTitle'),
	loader: async ({ params }) => loadSendFlow({ data: { id: params.occasionId } }),
});
