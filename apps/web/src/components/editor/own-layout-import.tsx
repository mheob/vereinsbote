import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Disclosure, DisclosurePanel, Heading } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { HtmlImportForm } from '@/components/html-import/html-import-form';
import { layoutPreviewSource } from '@/components/html-import/layout-preview';
import { ChevronIcon } from '@/components/icons';
import { useT } from '@/i18n/use-t';
import type { Brand } from '@/mail/brand/brand-schema';
import type { SalutationTexts } from '@/mail/placeholders/salutation';

const triggerClass =
	'flex items-center gap-2 rounded-md font-semibold data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700';

/**
 * „Eigenes Layout importieren“ in the settings of a template of blocks: the HTML frame of this
 * template alone (Design 22). It is checked against what the template's area may use; the cleaned
 * HTML becomes the template's layout in the editor, and the template keeps it when it is saved.
 *
 * @param props The props.
 * @param props.templateId The template.
 * @param props.brand The brand, for the preview.
 * @param props.appOrigin The origin of the app, for the preview's image addresses.
 * @param props.salutationTexts The salutation texts of the sample contact in the preview.
 * @param props.onImported Called with the cleaned HTML of the accepted layout.
 * @param props.announce Announces in the page's live region.
 * @returns The folded section.
 */
export function OwnLayoutImport({
	announce,
	appOrigin,
	brand,
	onImported,
	salutationTexts,
	templateId,
}: Readonly<{
	templateId: string;
	brand: Brand;
	appOrigin: string;
	salutationTexts: SalutationTexts;
	onImported: (html: string) => void;
	announce: Announce;
}>): ReactNode {
	const t = useT();
	const [isExpanded, setIsExpanded] = useState(false);
	const spec = useMemo(() => ({ target: 'ownLayout', templateId }) as const, [templateId]);
	const subject = t('htmlImport.preview');
	const buildSource = useCallback((html: string) => layoutPreviewSource(html, subject), [subject]);
	const accept = useCallback(
		(html: string): readonly string[] => {
			onImported(html);
			setIsExpanded(false);
			announce(t('editor.layoutImportDone'), 'status');
			return [];
		},
		[announce, onImported, t],
	);
	const chevronClass = useMemo(
		() => `transition-transform ${isExpanded ? '' : '-rotate-90'}`,
		[isExpanded],
	);
	return (
		<Disclosure isExpanded={isExpanded} onExpandedChange={setIsExpanded}>
			<Heading level={3}>
				<Button className={triggerClass} slot="trigger">
					<span className={chevronClass}>
						<ChevronIcon />
					</span>
					{t('editor.layoutImport')}
				</Button>
			</Heading>
			<DisclosurePanel>
				<div className="flex flex-col gap-3 pt-3">
					<p className="text-sm text-gray-700">{t('editor.layoutImportHelp')}</p>
					<HtmlImportForm
						appOrigin={appOrigin}
						brand={brand}
						buildSource={buildSource}
						heading={null}
						onAccept={accept}
						salutationTexts={salutationTexts}
						spec={spec}
					/>
				</div>
			</DisclosurePanel>
		</Disclosure>
	);
}
