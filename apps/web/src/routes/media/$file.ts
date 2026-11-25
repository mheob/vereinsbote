import { createFileRoute } from '@tanstack/react-router';

import type { MediaServices } from '@/server/media/media-request';

/*
 * Serves the stored images under `/media/<id>.<ext>`. The URL is the only protection (an
 * unguessable id), because the images end up in e-mails: no session is asked for. Every method
 * lands here (`ANY`), so other methods than GET and HEAD get 405 instead of a rendered page.
 */

async function mediaServices(): Promise<MediaServices> {
	const { getAppContext } = await import('@/platform/context');
	const { db, platform, storage } = await getAppContext();
	return { db, platform: platform.name, storage };
}

async function serve(request: Request, file: string): Promise<Response> {
	const { handleMediaRequest } = await import('@/server/media/media-request');
	return handleMediaRequest(request, file, mediaServices);
}

export const Route = createFileRoute('/media/$file')({
	server: { handlers: { ANY: async ({ params, request }) => serve(request, params.file) } },
});
