import { useCallback } from 'react';
import type { ReactNode } from 'react';

import { useT } from '@/i18n/use-t';
import type { Brand } from '@/mail/brand/brand-schema';

import { COLOR_KEYS, updateColor, weakRatios } from './brand-draft';
import type { ColorKey, DraftUpdate } from './brand-draft';
import { BrandColorField } from './color-field';

/**
 * One colour with its label, hint and, when its pair is weak, the contrast warning.
 *
 * @param props The props.
 * @param props.colorKey The colour.
 * @param props.value The colour as `#rrggbb`.
 * @param props.ratio The ratio of a weak pair, else null.
 * @param props.onChange Applies an update to the draft.
 * @returns The field.
 */
function ColorRow({
	colorKey,
	onChange,
	ratio,
	value,
}: Readonly<{
	colorKey: ColorKey;
	value: string;
	ratio: number | null;
	onChange: (update: DraftUpdate) => void;
}>): ReactNode {
	const t = useT();
	const change = useCallback(
		(next: string) => {
			onChange(updateColor(colorKey, next));
		},
		[colorKey, onChange],
	);
	return (
		<BrandColorField
			help={t(`brand.colorHelp.${colorKey}`)}
			label={t(`brand.color.${colorKey}`)}
			name={`${colorKey}Color`}
			onChange={change}
			ratio={ratio}
			value={value}
		/>
	);
}

/**
 * The five colours of the brand with their contrast warnings.
 *
 * @param props The props.
 * @param props.colors The colours of the draft.
 * @param props.onChange Applies an update to the draft.
 * @returns The section.
 */
export function ColorsSection({
	colors,
	onChange,
}: Readonly<{ colors: Brand['colors']; onChange: (update: DraftUpdate) => void }>): ReactNode {
	const t = useT();
	const ratios = weakRatios(colors);
	return (
		<section className="flex flex-col gap-4">
			<h2 className="text-xl font-bold">{t('brand.colorsTitle')}</h2>
			{COLOR_KEYS.map((key) => (
				<ColorRow
					colorKey={key}
					key={key}
					onChange={onChange}
					ratio={ratios[key] ?? null}
					value={colors[key]}
				/>
			))}
		</section>
	);
}
