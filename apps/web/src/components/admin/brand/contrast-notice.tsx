import type { ReactNode } from 'react';

import { useLocale } from '@/i18n/use-t';
import type { ContrastFinding } from '@/mail/brand/contrast';

import { contrastWarningText } from './brand-draft';

/**
 * The warning at a colour field: a pair the colour belongs to is below 4.5:1. It names the pair,
 * so it reads right at both of its fields. Saving stays possible (Design 7).
 *
 * @param props The props.
 * @param props.id The id the field names in `aria-describedby`.
 * @param props.finding The weak pair and its ratio.
 * @returns The warning.
 */
export function ContrastNotice({
	finding,
	id,
}: Readonly<{ id: string; finding: ContrastFinding }>): ReactNode {
	const locale = useLocale();
	return (
		<p className="text-sm font-semibold text-amber-900" id={id}>
			{contrastWarningText(locale, finding)}
		</p>
	);
}
