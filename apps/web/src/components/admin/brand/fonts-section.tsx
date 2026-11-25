import { useCallback } from 'react';
import type { ReactNode } from 'react';

import { useT } from '@/i18n/use-t';
import type { FontStackId } from '@/mail/brand/brand-schema';

import { updateFonts } from './brand-draft';
import type { BrandDraft, DraftUpdate } from './brand-draft';
import { BrandTextField } from './brand-text-field';
import { FontSelect } from './font-select';

const MAX_WISH_FONT_LENGTH = 60;

/**
 * The fonts: a stack for text and one for headings, each with an optional preferred font.
 *
 * @param props The props.
 * @param props.fonts The fonts of the draft.
 * @param props.onChange Applies an update to the draft.
 * @returns The section.
 */
export function FontsSection({
	fonts,
	onChange,
}: Readonly<{
	fonts: BrandDraft['fonts'];
	onChange: (update: DraftUpdate) => void;
}>): ReactNode {
	const t = useT();
	const help = t('brand.wishFontHelp');
	const changeText = useCallback(
		(text: FontStackId) => {
			onChange(updateFonts({ text }));
		},
		[onChange],
	);
	const changeHeading = useCallback(
		(heading: FontStackId) => {
			onChange(updateFonts({ heading }));
		},
		[onChange],
	);
	const changeTextWish = useCallback(
		(textWish: string) => {
			onChange(updateFonts({ textWish }));
		},
		[onChange],
	);
	const changeHeadingWish = useCallback(
		(headingWish: string) => {
			onChange(updateFonts({ headingWish }));
		},
		[onChange],
	);
	return (
		<section className="flex flex-col gap-4">
			<h2 className="text-xl font-bold">{t('brand.fontsTitle')}</h2>
			<FontSelect label={t('brand.textFont')} onChange={changeText} value={fonts.text} />
			<BrandTextField
				help={help}
				label={t('brand.textWish')}
				maxLength={MAX_WISH_FONT_LENGTH}
				name="textWish"
				onChange={changeTextWish}
				value={fonts.textWish}
			/>
			<FontSelect label={t('brand.headingFont')} onChange={changeHeading} value={fonts.heading} />
			<BrandTextField
				help={help}
				label={t('brand.headingWish')}
				maxLength={MAX_WISH_FONT_LENGTH}
				name="headingWish"
				onChange={changeHeadingWish}
				value={fonts.headingWish}
			/>
		</section>
	);
}
