import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vite-plus/test';

import { LocaleProvider, useLocale, useT } from './use-t';

function Probe(): ReactNode {
	const t = useT();
	return (
		<p lang={useLocale()}>
			{t('a11y.skipLink')} {t('auth.linkSent', { email: 'kim@v.de' })}
		</p>
	);
}

describe(LocaleProvider, () => {
	it('gives useT and useLocale the locale of the provider', () => {
		expect(
			renderToStaticMarkup(
				<LocaleProvider locale="en">
					<Probe />
				</LocaleProvider>,
			),
		).toBe(
			'<p lang="en">Skip to content We have sent a sign-in link to kim@v.de if the address has been invited.</p>',
		);
		expect(
			renderToStaticMarkup(
				<LocaleProvider locale="de">
					<Probe />
				</LocaleProvider>,
			),
		).toContain('<p lang="de">Zum Inhalt springen ');
	});
});
