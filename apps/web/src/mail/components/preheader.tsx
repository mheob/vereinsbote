import type { ReactNode } from 'react';

const FILLER_REPEATS = 100;
/**
 * Invisible characters after the preview text (no-break space, zero-width non-joiner), so inboxes
 * do not show the mail's first lines.
 */
const FILLER = '\u00A0\u200C'.repeat(FILLER_REPEATS);

/**
 * The preview text inboxes show next to the subject. Hidden in the mail and left out of the
 * plain text.
 *
 * @param props The preheader props.
 * @param props.text The preview text.
 * @returns The hidden element.
 */
export function Preheader({ text }: { readonly text: string }): ReactNode {
	return (
		<div
			data-skip-in-text="true"
			style={{
				display: 'none',
				fontSize: 1,
				lineHeight: '1px',
				maxHeight: 0,
				maxWidth: 0,
				msoHide: 'all',
				opacity: 0,
				overflow: 'hidden',
			}}
		>
			{`${text}${FILLER}`}
		</div>
	);
}
