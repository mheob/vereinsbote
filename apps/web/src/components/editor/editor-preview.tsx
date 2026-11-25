import type { ReactNode } from 'react';

import { MailPreview } from '@/components/preview/mail-preview';
import { useCompiledPreview } from '@/components/preview/use-compiled-preview';
import type { TemplateEditorPage } from '@/functions/templates';
import { useT } from '@/i18n/use-t';

import type { previewSource } from './preview-source';

/**
 * The preview of the template for the sample contact.
 *
 * @param props The props.
 * @param props.page What the editor loaded.
 * @param props.source The template as the preview compiles it.
 * @param props.values The values of the sample contact.
 * @returns The preview.
 */
export function PreviewPane({
	page,
	source,
	values,
}: Readonly<{
	page: TemplateEditorPage;
	source: ReturnType<typeof previewSource>;
	values: ReadonlyMap<string, string>;
}>): ReactNode {
	const t = useT();
	const state = useCompiledPreview(source, page.brand, page.appOrigin, values);
	return (
		<section
			aria-labelledby="editor-preview"
			className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start"
		>
			<h2 className="text-xl font-bold" id="editor-preview">
				{t('editor.preview')}
			</h2>
			<p className="text-sm text-gray-700">{t('editor.previewContact')}</p>
			<MailPreview state={state} title={t('editor.previewFrame')} />
		</section>
	);
}
