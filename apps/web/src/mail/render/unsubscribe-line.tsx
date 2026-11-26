import type { ReactNode } from 'react';

import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import { Link } from '@/mail/components/link';

import type { MailTheme } from './theme';

interface UnsubscribeLineProps {
	/** The address of the link: the marker of its slot. */
	readonly href: string;
	readonly locale: Locale;
	readonly theme: MailTheme;
}

/**
 * The line `compileMail` appends to imported HTML (a template or a layout) that does not place
 * `{{unsubscribe.url}}` itself: the link with the text of the standard footer, in the brand's font
 * and link colour.
 *
 * @param props The line props.
 * @param props.href The address of the link.
 * @param props.locale The language of the link text.
 * @param props.theme The theme of the brand.
 * @returns The paragraph.
 */
export function UnsubscribeLine({ href, locale, theme }: UnsubscribeLineProps): ReactNode {
	return (
		<p
			style={{
				color: theme.text,
				fontFamily: theme.font,
				fontSize: 13,
				lineHeight: '20px',
				margin: '16px 0',
				msoLineHeightRule: 'exactly',
				textAlign: 'center',
			}}
		>
			<Link color={theme.link} href={href}>
				{translate(locale, 'mail.layout.unsubscribe')}
			</Link>
		</p>
	);
}
