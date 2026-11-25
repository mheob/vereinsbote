import { useServerFn } from '@tanstack/react-start';
import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';

import { problemMessage } from '@/components/editor/problems';
import { FAILED, settle } from '@/components/settle';
import { submitReplaceHtml } from '@/functions/templates';
import type { TemplateEditorPage } from '@/functions/templates';
import { useT } from '@/i18n/use-t';
import type { MailSource } from '@/mail/render/compile';
import { placeholderLabel } from '@/server/templates/editor-placeholders';

import { HtmlImportForm } from './html-import-form';

const NO_MEDIA: MailSource['media'] = new Map();

/**
 * „Neues HTML einfügen“ under an HTML template (Design 22): the same import as when creating one,
 * with the preview of the new HTML in the template's subject. Accepting saves it with the version
 * the page loaded, so a template saved meanwhile is not overwritten; name, subject and settings
 * stay. The page loads the template anew afterwards and announces it.
 *
 * @param props The props.
 * @param props.page What `loadTemplateEditor` gave: an HTML template the user may edit.
 * @param props.onReplaced Called after the HTML was replaced.
 * @returns The section.
 */
export function ReplaceHtmlSection({
	onReplaced,
	page,
}: Readonly<{
	page: TemplateEditorPage;
	onReplaced: () => void;
}>): ReactNode {
	const t = useT();
	const replace = useServerFn(submitReplaceHtml);
	const { id, preheader, salutationTexts, subject, version } = page.template;
	const spec = useMemo(() => ({ target: 'template', templateId: id }) as const, [id]);
	const buildSource = useCallback(
		(html: string): MailSource => ({
			body: { html, kind: 'html' },
			media: NO_MEDIA,
			preheader,
			subject,
		}),
		[preheader, subject],
	);
	const accept = useCallback(
		async (html: string): Promise<readonly string[]> => {
			const form = new FormData();
			form.set('id', id);
			form.set('version', String(version));
			form.set('html', html);
			const result = await settle(replace({ data: form }));
			if (result === undefined) return [];
			if (result === FAILED) return [t('auth.requestFailed')];
			if (result.ok) {
				onReplaced();
				return [];
			}
			if (result.failure === 'changed') return [t('templates.changed')];
			if (result.failure === 'gone') return [t('templates.gone')];
			if (result.failure === 'invalid' && result.problems.length > 0) {
				return result.problems.map((problem) =>
					problemMessage(problem, (key) => placeholderLabel(key, page.placeholders, t), t),
				);
			}
			return [t('htmlImport.replaceRefused')];
		},
		[id, onReplaced, page.placeholders, replace, t, version],
	);
	return (
		<div className="flex flex-col gap-2">
			<p className="max-w-3xl">{t('htmlImport.replaceHelp')}</p>
			<HtmlImportForm
				appOrigin={page.appOrigin}
				brand={page.brand}
				buildSource={buildSource}
				heading={t('htmlImport.replaceHeading')}
				onAccept={accept}
				salutationTexts={salutationTexts}
				spec={spec}
			/>
		</div>
	);
}
