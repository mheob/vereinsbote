/*
 * Outlook's own CSS properties (classic Outlook renders with Word), used in the inline styles of
 * the mail components. Other clients ignore them.
 */
import type { CSSProperties } from 'react';

declare module 'react' {
	interface CSSProperties {
		msoHide?: 'all';
		msoLineHeightRule?: 'exactly';
		msoPaddingAlt?: string;
	}
}

/** The Outlook properties the mail components use. */
type OutlookCss = Pick<CSSProperties, 'msoHide' | 'msoLineHeightRule' | 'msoPaddingAlt'>;

export type { OutlookCss };
