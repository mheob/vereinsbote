import { useCallback } from 'react';
import type { ReactNode } from 'react';

import { useLocale, useT } from '@/i18n/use-t';
import type { Brand } from '@/mail/brand/brand-schema';
import type { ContrastFinding } from '@/mail/brand/contrast';

import { COLOR_KEYS, contrastAnnouncement, contrastWarnings, updateColor } from './brand-draft';
import type { ColorKey, DraftUpdate } from './brand-draft';
import { BrandColorField } from './color-field';

/** No weak pair: one array for every colour without a warning, so no row re-renders for it. */
const NO_WARNINGS: readonly ContrastFinding[] = [];

/**
 * One colour with its label, hint and the warnings of its weak pairs.
 *
 * @param props The props.
 * @param props.colorKey The colour.
 * @param props.value The colour as `#rrggbb`.
 * @param props.warnings The weak pairs of the colour.
 * @param props.onChange Called with the colour and its new value.
 * @returns The field.
 */
function ColorRow({
	colorKey,
	onChange,
	value,
	warnings,
}: Readonly<{
	colorKey: ColorKey;
	value: string;
	warnings: readonly ContrastFinding[];
	onChange: (key: ColorKey, value: string) => void;
}>): ReactNode {
	const t = useT();
	const change = useCallback(
		(next: string) => {
			onChange(colorKey, next);
		},
		[colorKey, onChange],
	);
	return (
		<BrandColorField
			help={t(`brand.colorHelp.${colorKey}`)}
			label={t(`brand.color.${colorKey}`)}
			name={`${colorKey}Color`}
			onChange={change}
			value={value}
			warnings={warnings}
		/>
	);
}

/**
 * The five colours of the brand with their contrast warnings. A change that changes the weak
 * pairs is announced politely, naming each pair and its ratio (or that it reads well again).
 *
 * @param props The props.
 * @param props.colors The colours of the draft.
 * @param props.onChange Applies an update to the draft.
 * @param props.announce Announces a text in the page's status region.
 * @returns The section.
 */
export function ColorsSection({
	announce,
	colors,
	onChange,
}: Readonly<{
	colors: Brand['colors'];
	onChange: (update: DraftUpdate) => void;
	announce: (text: string) => void;
}>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const warnings = contrastWarnings(colors);
	const changeColor = useCallback(
		(key: ColorKey, value: string) => {
			onChange(updateColor(key, value));
			const announcement = contrastAnnouncement(locale, colors, { ...colors, [key]: value });
			if (announcement !== null) announce(announcement);
		},
		[announce, colors, locale, onChange],
	);
	return (
		<section className="flex flex-col gap-4">
			<h2 className="text-xl font-bold">{t('brand.colorsTitle')}</h2>
			{COLOR_KEYS.map((key) => (
				<ColorRow
					colorKey={key}
					key={key}
					onChange={changeColor}
					value={colors[key]}
					warnings={warnings[key] ?? NO_WARNINGS}
				/>
			))}
		</section>
	);
}
