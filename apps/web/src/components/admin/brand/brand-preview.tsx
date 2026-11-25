import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { MailPreview } from '@/components/preview/mail-preview';
import { useCompiledPreview } from '@/components/preview/use-compiled-preview';
import { useT } from '@/i18n/use-t';
import type { Brand } from '@/mail/brand/brand-schema';
import { contactPlaceholderValues } from '@/mail/placeholders/contact-values';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import type { MailSource } from '@/mail/render/compile';
import { SAMPLE_BLOCKS, SAMPLE_CONTACTS } from '@/mail/sample';

import { brandFromDraft } from './brand-draft';
import type { BrandDraft } from './brand-draft';

/** The contact the preview greets: a member who has every value the sample blocks use. */
const PREVIEW_VALUES = contactPlaceholderValues(
	SAMPLE_CONTACTS.female,
	new Set(),
	[],
	DEFAULT_SALUTATIONS.du,
);

/**
 * The preview of the draft: the standard layout with the sample mail. A draft that is not valid
 * keeps the last valid brand on screen.
 *
 * @param props The props.
 * @param props.draft The form state.
 * @param props.initial The brand the page was loaded with.
 * @param props.appOrigin The origin of the app, for the images' addresses.
 * @returns The preview.
 */
export function BrandPreview({
	appOrigin,
	draft,
	initial,
}: Readonly<{ draft: BrandDraft; initial: Brand; appOrigin: string }>): ReactNode {
	const t = useT();
	const headingId = useId();
	const result = useMemo(() => brandFromDraft(draft), [draft]);
	const [lastValid, setLastValid] = useState(initial);
	// Derived state, set while rendering: a valid draft replaces the brand the preview shows.
	if (result.ok && result.brand !== lastValid) setLastValid(result.brand);
	const source = useMemo(
		(): MailSource => ({
			body: { blocks: SAMPLE_BLOCKS, kind: 'blocks', layout: { kind: 'standard' } },
			media: new Map(),
			preheader: t('brand.previewPreheader'),
			subject: t('brand.previewSubject'),
		}),
		[t],
	);
	const state = useCompiledPreview(source, lastValid, appOrigin, PREVIEW_VALUES);
	return (
		<section
			aria-labelledby={headingId}
			className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start"
		>
			<h2 className="text-xl font-bold" id={headingId}>
				{t('brand.previewTitle')}
			</h2>
			<MailPreview state={state} title={t('brand.previewFrame')} />
		</section>
	);
}
