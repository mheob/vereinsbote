import { ErrorPage, NotFoundPage } from '@/components/error-pages';

/**
 * The router options of the app besides its routes: a failed route shows the generic error page
 * and an unknown address the not-found page, both translated and without internals.
 */
export const routerDefaults = {
	defaultErrorComponent: ErrorPage,
	defaultNotFoundComponent: NotFoundPage,
	scrollRestoration: true,
} as const;
