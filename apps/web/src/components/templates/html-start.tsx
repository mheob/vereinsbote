import { useServerFn } from '@tanstack/react-start';
import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';

import { problemMessage } from '@/components/editor/problems';
import { HtmlImportForm } from '@/components/html-import/html-import-form';
import { FAILED, settle } from '@/components/settle';
import { submitCreateHtmlTemplate } from '@/functions/templates';
import { useT } from '@/i18n/use-t';
import type { Brand } from '@/mail/brand/brand-schema';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import type { MailSource } from '@/mail/render/compile';
import { placeholderLabel } from '@/server/templates/editor-placeholders';

import type { TemplateNames } from './start-defaults';

const NO_MEDIA: MailSource['media'] = new Map();

/**
 * The form the imported HTML goes to the server in: never a URL.
 *
 * @param fields The area, the name, the subject and the cleaned HTML.
 * @param fields.areaId The area.
 * @param fields.names The name and the subject.
 * @param fields.html The HTML.
 * @returns The form data.
 */
function htmlForm(
	fields: Readonly<{ areaId: string; names: TemplateNames; html: string }>,
): FormData {
	const form = new FormData();
	form.set('areaId', fields.areaId);
	form.set('name', fields.names.name.trim());
	form.set('subject', fields.names.subject.trim());
	form.set('html', fields.html);
	return form;
}

/**
 * The start „HTML importieren“ of the form „Neue Vorlage“: the import of the HTML with the name
 * and the subject the form holds. „Übernehmen“ creates the template with the same checks as a
 * save and opens it; a taken name is shown at the name field.
 *
 * @param props The props.
 * @param props.areaId The area of the new template.
 * @param props.names The name and the subject of the form.
 * @param props.brand The brand, for the preview.
 * @param props.appOrigin The origin of the app, for the preview's image addresses.
 * @param props.onCreated Called with the id of the new template.
 * @param props.onGone Called when the area is gone, so the page loads it anew.
 * @param props.onNameTaken Called when another template of the area has the name.
 * @returns The import.
 */
export function HtmlStart({
	appOrigin,
	areaId,
	brand,
	names,
	onCreated,
	onGone,
	onNameTaken,
}: Readonly<{
	areaId: string;
	names: TemplateNames;
	brand: Brand;
	appOrigin: string;
	onCreated: (id: string) => void;
	onGone: () => void;
	onNameTaken: () => void;
}>): ReactNode {
	const t = useT();
	const createHtml = useServerFn(submitCreateHtmlTemplate);
	const buildSource = useCallback(
		(html: string): MailSource => ({
			body: { html, kind: 'html' },
			media: NO_MEDIA,
			preheader: '',
			subject: names.subject,
		}),
		[names.subject],
	);
	const spec = useMemo(() => ({ areaId, target: 'template' }) as const, [areaId]);
	const accept = useCallback(
		async (html: string): Promise<readonly string[]> => {
			if (names.name.trim() === '' || names.subject.trim() === '') {
				return [t('htmlImport.needNameAndSubject')];
			}
			const result = await settle(createHtml({ data: htmlForm({ areaId, html, names }) }));
			if (result === undefined) return [];
			if (result === FAILED) return [t('auth.requestFailed')];
			if (result.ok) {
				onCreated(result.id);
				return [];
			}
			if (result.failure === 'invalid') {
				return result.problems.map((problem) =>
					problemMessage(problem, (key) => placeholderLabel(key, [], t), t),
				);
			}
			if (result.failure === 'gone') {
				onGone();
				return [t('templates.createGone')];
			}
			onNameTaken();
			return [t('templates.nameTaken')];
		},
		[areaId, createHtml, names, onCreated, onGone, onNameTaken, t],
	);
	return (
		<HtmlImportForm
			appOrigin={appOrigin}
			brand={brand}
			buildSource={buildSource}
			heading={t('htmlImport.heading')}
			onAccept={accept}
			salutationTexts={DEFAULT_SALUTATIONS.du}
			spec={spec}
		/>
	);
}
