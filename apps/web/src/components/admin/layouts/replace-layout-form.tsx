import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { startTransition, useCallback } from 'react';
import type { ReactNode } from 'react';

import type { Announce } from '@/components/announcements';
import { HtmlImportForm } from '@/components/html-import/html-import-form';
import { layoutPreviewSource } from '@/components/html-import/layout-preview';
import { refusalMessages } from '@/components/html-import/messages';
import { FAILED, settle } from '@/components/settle';
import { submitReplaceLayout } from '@/functions/layouts';
import type { LayoutPage } from '@/functions/layouts';
import { useT } from '@/i18n/use-t';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';

const SPEC = { target: 'globalLayout' } as const;

/**
 * „HTML ersetzen“ on the page of a layout: the same import as when creating one. Accepting saves
 * the HTML with the version the page loaded, so a layout replaced meanwhile is not overwritten.
 * Every template that uses the layout shows the new frame at once.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.page The layout, the brand and the origin of the app.
 * @returns The import.
 */
export function ReplaceLayoutForm({
	announce,
	page,
}: Readonly<{ announce: Announce; page: LayoutPage }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const replace = useServerFn(submitReplaceLayout);
	const { id, version } = page.layout;
	const subject = t('htmlImport.preview');
	const buildSource = useCallback((html: string) => layoutPreviewSource(html, subject), [subject]);
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
				announce(t('layouts.replaced'), 'status');
				startTransition(async () => router.invalidate());
				return [];
			}
			if (result.failure === 'refused') {
				return refusalMessages(result.refusals, 'globalLayout', t).map(({ text }) => text);
			}
			if (result.failure === 'changed') return [t('layouts.changed')];
			return [t('layouts.gone')];
		},
		[announce, id, replace, router, t, version],
	);
	return (
		<HtmlImportForm
			appOrigin={page.appOrigin}
			brand={page.brand}
			buildSource={buildSource}
			heading={t('layouts.replaceHeading')}
			key={version}
			onAccept={accept}
			salutationTexts={DEFAULT_SALUTATIONS.du}
			spec={SPEC}
		/>
	);
}
