import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { Label, RadioGroup } from 'react-aria-components';

import { useT } from '@/i18n/use-t';
import type { BrandLogo } from '@/mail/brand/brand-schema';

import { updateDraft } from './brand-draft';
import type { BrandDraft, DraftUpdate } from './brand-draft';
import { Choice } from './choice';
import { LogoField } from './logo-field';

/**
 * The header logo with its alignment, and the optional footer logo.
 *
 * @param props The props.
 * @param props.draft The form state.
 * @param props.storageReady Whether images can be stored.
 * @param props.onChange Applies an update to the draft.
 * @param props.announce Announces a removed logo.
 * @returns The section.
 */
export function LogosSection({
	announce,
	draft,
	onChange,
	storageReady,
}: Readonly<{
	draft: BrandDraft;
	storageReady: boolean;
	onChange: (update: DraftUpdate) => void;
	announce: (text: string) => void;
}>): ReactNode {
	const t = useT();
	const headerLabel = t('brand.headerLogo');
	const footerLabel = t('brand.footerLogo');
	const changeHeader = useCallback(
		(headerLogo: BrandLogo | null) => {
			onChange(updateDraft({ headerLogo }));
			if (headerLogo === null) announce(t('brand.logoRemoved', { logo: headerLabel }));
		},
		[announce, headerLabel, onChange, t],
	);
	const changeFooter = useCallback(
		(footerLogo: BrandLogo | null) => {
			onChange(updateDraft({ footerLogo }));
			if (footerLogo === null) announce(t('brand.logoRemoved', { logo: footerLabel }));
		},
		[announce, footerLabel, onChange, t],
	);
	const changeAlign = useCallback(
		(value: string) => {
			onChange(updateDraft({ logoAlign: value === 'center' ? 'center' : 'left' }));
		},
		[onChange],
	);
	return (
		<section className="flex flex-col gap-4">
			<h2 className="text-xl font-bold">{t('brand.logosTitle')}</h2>
			<LogoField
				altName="headerLogoAlt"
				defaultAlt={draft.name}
				legend={headerLabel}
				logo={draft.headerLogo}
				onChange={changeHeader}
				storageReady={storageReady}
			/>
			<RadioGroup
				className="flex flex-col gap-1"
				name="logoAlign"
				onChange={changeAlign}
				orientation="horizontal"
				value={draft.logoAlign}
			>
				<Label className="font-semibold">{t('brand.logoAlign')}</Label>
				<div className="flex gap-6">
					<Choice label={t('brand.alignLeft')} value="left" />
					<Choice label={t('brand.alignCenter')} value="center" />
				</div>
			</RadioGroup>
			<LogoField
				altName="footerLogoAlt"
				defaultAlt={draft.name}
				legend={footerLabel}
				logo={draft.footerLogo}
				onChange={changeFooter}
				storageReady={storageReady}
			/>
		</section>
	);
}
