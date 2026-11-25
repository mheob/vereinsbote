import {
	createFileRoute,
	Link,
	useLoaderData,
	useLocation,
	useRouter,
} from '@tanstack/react-router';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useAnnouncer } from '@/components/announcements';
import { clearHistoryNotice } from '@/components/contacts/history-notice';
import { TemplateEditor } from '@/components/editor/template-editor';
import { ReplaceHtmlSection } from '@/components/html-import/replace-html-section';
import { linkClass } from '@/components/styles';
import type { RemovedTemplate } from '@/components/templates/delete-template-dialog';
import { loadTemplateEditor } from '@/functions/templates';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';
import type { TemplateInput } from '@/mail/templates/template-schema';

/** What the editor saved since the page loaded: the template, and the version it got. */
interface SavedTemplate {
	/** The version the page was loaded with; a newer load makes this obsolete. */
	readonly loadedVersion: number;
	readonly version: number;
	readonly input: TemplateInput;
}

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
		// A save of the settings gives the replace form below the template's new version and settings,
		// or its next replacement would be refused as changed.
		const [saved, setSaved] = useState<SavedTemplate | null>(null);
		const loadedVersion = page.template.version;
		const onSaved = useCallback(
			(input: TemplateInput, version: number) => {
				setSaved({ input, loadedVersion, version });
			},
			[loadedVersion],
		);
		const replacePage = useMemo(() => {
			if (saved?.loadedVersion !== loadedVersion) return page;
			const { input } = saved;
			return {
				...page,
				template: {
					...page.template,
					name: input.name,
					preheader: input.preheader,
					salutationForm: input.salutationForm,
					salutationTexts: input.salutationTexts,
					subject: input.subject,
					version: saved.version,
				},
			};
		}, [loadedVersion, page, saved]);
		// The page loads the template anew; the editor and the import start over from its new version
		// (each with a key of its own: two siblings must not share one).
		const onReplaced = useCallback(() => {
			announce(t('htmlImport.replaced'), 'status');
			startTransition(async () => router.invalidate());
		}, [announce, router, t]);
		return (
			<>
				<Link className={`self-start ${linkClass}`} to="/templates">
					{t('templates.back')}
				</Link>
				<TemplateEditor
					key={`editor-${page.template.version}`}
					announce={announce}
					announcement={announcement}
					headingRef={headingRef}
					onRemoved={onRemoved}
					onSaved={onSaved}
					page={page}
				/>
				{page.template.body.kind === 'html' && page.canEdit ? (
					<ReplaceHtmlSection
						key={`replace-${page.template.version}`}
						onReplaced={onReplaced}
						page={replacePage}
					/>
				) : null}
			</>
		);
	},
	// The context is annotated: the loader reads `params`, and an unannotated `head` would keep
	// TypeScript from inferring the loader's data (like the admin and contacts pages).
	// A fresh load on every visit: a cached copy would show the template as it was before a save.
	gcTime: 0,
	head: (context: Parameters<typeof pageHead>[0]) => pageHead(context, 'templates.pageTitle'),
	loader: async ({ params }) => loadTemplateEditor({ data: { id: params.templateId } }),
});
