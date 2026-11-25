import {
	createFileRoute,
	Link,
	useLoaderData,
	useLocation,
	useRouter,
} from '@tanstack/react-router';
import { startTransition, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { Announcements, useAnnouncer } from '@/components/announcements';
import { clearHistoryNotice } from '@/components/contacts/history-notice';
import { linkClass } from '@/components/styles';
import { DeleteTemplateDialog } from '@/components/templates/delete-template-dialog';
import type { RemovedTemplate } from '@/components/templates/delete-template-dialog';
import { loadTemplatePage } from '@/functions/templates';
import { pageHead } from '@/i18n/page-title';
import { useLocale, useT } from '@/i18n/use-t';
import { formatClubDate } from '@/server/contacts/calendar';

/**
 * One template (design 9): its summary, and for who edits its area the deletion. The editor
 * follows with a later task. A template that does not exist, or that the user may not read, is
 * "not found". After a copy was made, the page announces it once; the history state carries that,
 * not the URL.
 */
export const Route = createFileRoute('/templates/$templateId')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function TemplatePage(): ReactNode {
		const t = useT();
		const locale = useLocale();
		const router = useRouter();
		const template = useLoaderData({ from: '/templates/$templateId' });
		const notice = useLocation({ select: (location) => location.state.templateNotice });
		const headingRef = useRef<HTMLHeadingElement>(null);
		const [announcement, announce] = useAnnouncer();
		useEffect(() => {
			if (notice?.kind !== 'copied') return;
			headingRef.current?.focus();
			announce(t('templates.copied', { name: notice.name }), 'status');
			clearHistoryNotice(globalThis.history, 'templateNotice');
		}, [announce, notice, t]);
		const { name } = template;
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
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-bold outline-none" ref={headingRef} tabIndex={-1}>
						{template.name}
					</h1>
					<Announcements announcement={announcement} />
				</div>
				<dl className="grid max-w-xl grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
					<dt className="font-semibold">{t('templates.areaLabel')}</dt>
					<dd>{template.areaName}</dd>
					<dt className="font-semibold">{t('templates.subjectLabel')}</dt>
					<dd>{template.subject}</dd>
					<dt className="font-semibold">{t('templates.kindColumn')}</dt>
					<dd>{t(`templates.kind.${template.bodyKind}`)}</dd>
					<dt className="font-semibold">{t('templates.updatedAtColumn')}</dt>
					<dd>{formatClubDate(template.updatedAt, locale)}</dd>
					{template.updatedByName === null ? null : (
						<>
							<dt className="font-semibold">{t('templates.updatedBy')}</dt>
							<dd>{template.updatedByName}</dd>
						</>
					)}
				</dl>
				{template.canEdit ? (
					<div>
						<DeleteTemplateDialog
							announce={announce}
							label={t('templates.delete')}
							onRemoved={onRemoved}
							template={template}
						/>
					</div>
				) : null}
			</>
		);
	},
	// The context is annotated: the loader reads `params`, and an unannotated `head` would keep
	// TypeScript from inferring the loader's data (like the admin and contacts pages).
	head: (context: Parameters<typeof pageHead>[0]) => pageHead(context, 'templates.pageTitle'),
	loader: async ({ params }) => loadTemplatePage({ data: { id: params.templateId } }),
});
