import {
	createFileRoute,
	Link,
	useLoaderData,
	useLocation,
	useRouter,
} from '@tanstack/react-router';
import { startTransition, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { useAnnouncer } from '@/components/announcements';
import { clearHistoryNotice } from '@/components/contacts/history-notice';
import { TemplateEditor } from '@/components/editor/template-editor';
import { linkClass } from '@/components/styles';
import type { RemovedTemplate } from '@/components/templates/delete-template-dialog';
import { loadTemplateEditor } from '@/functions/templates';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * One template in its block editor (design 9 and 13). A template that does not exist, or that
 * the user may not read, is "not found". After a copy was made, the page announces it once; the
 * history state carries that, not the URL.
 */
export const Route = createFileRoute('/templates/$templateId')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function TemplatePage(): ReactNode {
		const t = useT();
		const router = useRouter();
		const page = useLoaderData({ from: '/templates/$templateId' });
		const notice = useLocation({ select: (location) => location.state.templateNotice });
		const headingRef = useRef<HTMLHeadingElement>(null);
		const [announcement, announce] = useAnnouncer();
		useEffect(() => {
			if (notice?.kind !== 'copied') return;
			headingRef.current?.focus();
			announce(t('templates.copied', { name: notice.name }), 'status');
			clearHistoryNotice(globalThis.history, 'templateNotice');
		}, [announce, notice, t]);
		const { name } = page.template;
		const onRemoved = useCallback(
			(result: RemovedTemplate) => {
				startTransition(async () => {
					await router.navigate({
						state: result === 'deleted' ? { templateNotice: { kind: 'deleted', name } } : {},
						to: '/templates',
					});
				});
			},
			[name, router],
		);
		return (
			<>
				<Link className={`self-start ${linkClass}`} to="/templates">
					{t('templates.back')}
				</Link>
				<TemplateEditor
					announce={announce}
					announcement={announcement}
					headingRef={headingRef}
					onRemoved={onRemoved}
					page={page}
				/>
			</>
		);
	},
	// The context is annotated: the loader reads `params`, and an unannotated `head` would keep
	// TypeScript from inferring the loader's data (like the admin and contacts pages).
	head: (context: Parameters<typeof pageHead>[0]) => pageHead(context, 'templates.pageTitle'),
	loader: async ({ params }) => loadTemplateEditor({ data: { id: params.templateId } }),
});
