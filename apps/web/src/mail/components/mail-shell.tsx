import type { ReactNode } from 'react';

import type { Locale } from '@/i18n/locale';

import { MOBILE_RULE } from './mobile-rules';

interface MailShellProps {
	readonly children: ReactNode;
	readonly lang: Locale;
	/** The subject. */
	readonly title: string;
	readonly backgroundColor: string;
}

/**
 * The document of a mail: language, character set, viewport, title and the rule for phones.
 *
 * @param props The shell props.
 * @param props.children The body.
 * @param props.lang The language of the mail.
 * @param props.title The title, the subject of the mail.
 * @param props.backgroundColor The page colour.
 * @returns The document.
 */
export function MailShell({ backgroundColor, children, lang, title }: MailShellProps): ReactNode {
	return (
		<html lang={lang} dir="ltr">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="x-apple-disable-message-reformatting" />
				<title>{title}</title>
				<style>{MOBILE_RULE}</style>
			</head>
			<body style={{ backgroundColor, margin: 0, padding: 0, width: '100%' }}>
				<div lang={lang} dir="ltr">
					{children}
				</div>
			</body>
		</html>
	);
}
