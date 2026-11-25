import { createFileRoute } from '@tanstack/react-router';

/*
 * The page of the mail preview's sandboxed iframe, with a policy of its own (the request's nonce,
 * `SAMEORIGIN` framing): the request middleware in `start.ts` sets it, and so does
 * `handlePreviewFrameRequest` on every answer, with the same nonce (`cspNonceFor` of the same
 * request). Every method lands here (`ANY`), so other methods than GET get 405.
 */

async function appOrigin(): Promise<string> {
	const { getAppEnv } = await import('@/platform/context');
	const { appUrl } = await getAppEnv();
	return appUrl.origin;
}

async function serve(request: Request): Promise<Response> {
	const { handlePreviewFrameRequest } = await import('@/server/preview/frame-request');
	return handlePreviewFrameRequest(request, appOrigin);
}

export const Route = createFileRoute('/preview-frame')({
	server: { handlers: { ANY: async ({ request }) => serve(request) } },
});
