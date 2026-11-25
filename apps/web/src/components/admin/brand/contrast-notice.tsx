import type { ReactNode } from 'react';

import { useLocale, useT } from '@/i18n/use-t';

const RATIO_DIGITS = 2;
const RATIO_SCALE = 100;

/**
 * The warning at a colour field: its pair is below 4.5:1. Saving stays possible (Design 7). The
 * ratio is cut, not rounded, so 4.496 is never shown as 4.50 next to "below 4.5".
 *
 * @param props The props.
 * @param props.id The id the field names in `aria-describedby`.
 * @param props.ratio The contrast ratio.
 * @returns The warning.
 */
export function ContrastNotice({ id, ratio }: Readonly<{ id: string; ratio: number }>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const shown = (Math.floor(ratio * RATIO_SCALE) / RATIO_SCALE).toLocaleString(locale, {
		maximumFractionDigits: RATIO_DIGITS,
		minimumFractionDigits: RATIO_DIGITS,
	});
	return (
		<p className="text-sm font-semibold text-amber-900" id={id}>
			{t('brand.contrast', { ratio: shown })}
		</p>
	);
}
