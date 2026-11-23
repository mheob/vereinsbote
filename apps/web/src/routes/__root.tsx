import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { t } from '@/i18n/t';

import appCss from '@/styles.css?url';

export const Route = createRootRoute({
	head: () => ({
		links: [{ href: appCss, rel: 'stylesheet' }],
		meta: [
			// oxlint-disable-next-line unicorn/text-encoding-identifier-case -- HTML only allows the label "utf-8".
			{ charSet: 'utf-8' },
			{ content: 'width=device-width, initial-scale=1', name: 'viewport' },
			{ title: t('app.name') },
		],
	}),
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- ReactNode cannot be made deeply readonly.
	shellComponent: ({ children }: Readonly<{ children: ReactNode }>) => (
		<html lang="de">
			<head>
				<HeadContent />
			</head>
			<body>
				<a
					className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-white focus:p-2"
					href="#inhalt"
				>
					{t('a11y.skipLink')}
				</a>
				<main id="inhalt">{children}</main>
				<Scripts />
			</body>
		</html>
	),
});
