import { createFileRoute } from '@tanstack/react-router';

/*
 * The page of the mail preview's sandboxed iframe. Its headers (a policy of its own with the
 * request's nonce, `SAMEORIGIN` framing) come from the request middleware in `start.ts`; the nonce
 * in the script is the one that middleware put in the header (`cspNonceFor` of the same request).
 */

async function serve(request: Request): Promise<Response> {
	const [{ getAppEnv }, { cspNonceFor }, { previewFramePage }] = await Promise.all([
		import('@/platform/context'),
		import('@/platform/csp-nonce'),
		import('@/server/preview/frame-page'),
	]);
	const { appUrl } = await getAppEnv();
	return new Response(previewFramePage(cspNonceFor(request), appUrl.origin), {
		headers: { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' },
	});
}

export const Route = createFileRoute('/preview-frame')({
	server: { handlers: { GET: async ({ request }) => serve(request) } },
});
