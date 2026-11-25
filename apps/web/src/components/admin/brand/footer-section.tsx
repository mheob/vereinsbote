import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { Label, RadioGroup } from 'react-aria-components';

import { useT } from '@/i18n/use-t';
import type { IconVariant } from '@/mail/brand/brand-schema';
import { ICON_VARIANTS } from '@/mail/brand/brand-schema';

import { recommendsLegalLinks, updateFooter, updateFooterText } from './brand-draft';
import type { BrandDraft, DraftUpdate, FooterTextField, LinkDraft } from './brand-draft';
import { BrandTextField } from './brand-text-field';
import { Choice } from './choice';
import { FooterLinksField } from './footer-links-field';

const MAX_ADDRESS_LENGTH = 300;
const MAX_REGISTER_LENGTH = 200;
const MAX_FOOTER_TEXT_LENGTH = 1000;
const MAX_URL_LENGTH = 500;

const VARIANT_LABELS = {
	brand: 'brand.iconBrand',
	dark: 'brand.iconDark',
	light: 'brand.iconLight',
} as const;

function isIconVariant(value: string): value is IconVariant {
	const variants: readonly string[] = ICON_VARIANTS;
	return variants.includes(value);
}

/**
 * A text field of the footer.
 *
 * @param props The props.
 * @param props.field The footer field.
 * @param props.name The field name a refusal is reported under.
 * @param props.label The visible label.
 * @param props.value The text.
 * @param props.maxLength The most characters.
 * @param props.onChange Applies an update to the draft.
 * @param props.multiline Whether the field has several lines.
 * @param props.help A hint below the field.
 * @returns The field.
 */
function FooterText({
	field,
	help,
	label,
	maxLength,
	multiline,
	name,
	onChange,
	value,
}: Readonly<{
	field: FooterTextField;
	name: string;
	label: string;
	value: string;
	maxLength: number;
	onChange: (update: DraftUpdate) => void;
	multiline?: boolean;
	help?: string;
}>): ReactNode {
	const change = useCallback(
		(next: string) => {
			onChange(updateFooterText(field, next));
		},
		[field, onChange],
	);
	return (
		<BrandTextField
			help={help}
			label={label}
			maxLength={maxLength}
			multiline={multiline}
			name={name}
			onChange={change}
			value={value}
		/>
	);
}

/**
 * The footer: address, register, links to imprint, privacy and website, a free text, further
 * links and the colour of their icons.
 *
 * @param props The props.
 * @param props.draft The form state.
 * @param props.onChange Applies an update to the draft.
 * @param props.announce Announces an added or removed link.
 * @returns The section.
 */
export function FooterSection({
	announce,
	draft,
	onChange,
}: Readonly<{
	draft: BrandDraft;
	onChange: (update: DraftUpdate) => void;
	announce: (text: string) => void;
}>): ReactNode {
	const t = useT();
	const { footer } = draft;
	const urlHelp = t('brand.urlHelp');
	const changeLinks = useCallback(
		(links: readonly LinkDraft[]) => {
			onChange(updateFooter({ links }));
		},
		[onChange],
	);
	const changeVariant = useCallback(
		(value: string) => {
			if (isIconVariant(value)) onChange(updateFooter({ iconVariant: value }));
		},
		[onChange],
	);
	return (
		<section className="flex flex-col gap-4">
			<h2 className="text-xl font-bold">{t('brand.footerTitle')}</h2>
			<FooterText
				field="address"
				label={t('brand.address')}
				maxLength={MAX_ADDRESS_LENGTH}
				multiline
				name="address"
				onChange={onChange}
				value={footer.address}
			/>
			<FooterText
				field="register"
				label={t('brand.register')}
				maxLength={MAX_REGISTER_LENGTH}
				name="register"
				onChange={onChange}
				value={footer.register}
			/>
			<FooterText
				field="imprintUrl"
				help={urlHelp}
				label={t('brand.imprintUrl')}
				maxLength={MAX_URL_LENGTH}
				name="imprintUrl"
				onChange={onChange}
				value={footer.imprintUrl}
			/>
			<FooterText
				field="privacyUrl"
				help={urlHelp}
				label={t('brand.privacyUrl')}
				maxLength={MAX_URL_LENGTH}
				name="privacyUrl"
				onChange={onChange}
				value={footer.privacyUrl}
			/>
			{recommendsLegalLinks(draft) ? (
				<p className="text-sm font-semibold text-amber-900">{t('brand.legalRecommended')}</p>
			) : null}
			<FooterText
				field="websiteUrl"
				help={urlHelp}
				label={t('brand.websiteUrl')}
				maxLength={MAX_URL_LENGTH}
				name="websiteUrl"
				onChange={onChange}
				value={footer.websiteUrl}
			/>
			<FooterText
				field="text"
				label={t('brand.footerText')}
				maxLength={MAX_FOOTER_TEXT_LENGTH}
				multiline
				name="footerText"
				onChange={onChange}
				value={footer.text}
			/>
			<h3 className="text-lg font-bold">{t('brand.linksTitle')}</h3>
			<FooterLinksField announce={announce} links={footer.links} onChange={changeLinks} />
			<RadioGroup
				className="flex flex-col gap-1"
				name="iconVariant"
				onChange={changeVariant}
				orientation="horizontal"
				value={footer.iconVariant}
			>
				<Label className="font-semibold">{t('brand.iconVariant')}</Label>
				<div className="flex gap-6">
					{ICON_VARIANTS.map((variant) => (
						<Choice key={variant} label={t(VARIANT_LABELS[variant])} value={variant} />
					))}
				</div>
			</RadioGroup>
		</section>
	);
}
