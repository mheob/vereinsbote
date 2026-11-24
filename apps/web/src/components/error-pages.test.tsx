import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vite-plus/test';

import type { Locale } from '@/i18n/locale';
import { LocaleProvider } from '@/i18n/use-t';
import { routerDefaults } from '@/router-defaults';

const SECRET = 'Failed query: select * from "session" params: token-123';

/**
 * Renders a path of a small app whose home page loader fails, with the router defaults of the app.
 *
 * @param path The path to render.
 * @param locale The language of the request.
 * @returns The HTML.
 */
async function render(path: string, locale: Locale): Promise<string> {
	const rootRoute = createRootRoute({ component: Outlet });
	const homeRoute = createRoute({
		getParentRoute: () => rootRoute,
		loader: () => {
			throw new Error(SECRET);
		},
		path: '/',
	});
	const router = createRouter({
		...routerDefaults,
		history: createMemoryHistory({ initialEntries: [path] }),
		routeTree: rootRoute.addChildren([homeRoute]),
	});
	await router.load();
	return renderToString(
		<LocaleProvider locale={locale}>
			<RouterProvider router={router} />
		</LocaleProvider>,
	);
}

describe('the router defaults', () => {
	it('shows a failed loader as a generic, translated error page', async () => {
		const html = await render('/', 'de');
		expect(html).toContain('<h1');
		expect(html).toContain('Ein Fehler ist aufgetreten');
		expect(html).toContain('Zur Startseite');
		expect(html).not.toContain('Failed query');
		expect(html).not.toContain('token-123');
	});

	it('shows an unknown path as a translated not-found page', async () => {
		const html = await render('/no-such-page', 'en');
		expect(html).toContain('Page not found');
		expect(html).toContain('This page does not exist.');
		expect(html).toContain('href="/"');
	});
});
