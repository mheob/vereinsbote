/*
 * The `/media/<file>` request, apart from the route: method check, lookup and the answer when the
 * database or the storage fails. Every answer carries the security headers of the images itself,
 * so none falls back to the server's own error page (a JSON 500 without them).
 */
import type { PlatformName } from '@/platform/platform';
import { securityHeadersFor } from '@/platform/security-headers';
import type { Db } from '@/server/db/client';
import { errorLabelWithCause } from '@/server/error-label';
import type { ObjectStorage } from '@/server/storage/storage';

import { mediaResponse, openMedia } from './media';

/** What serving an image needs; opened per request, only for GET and HEAD. */
interface MediaServices {
	readonly db: Db;
	readonly storage: ObjectStorage | null;
	readonly platform: PlatformName;
}

const ALLOWED_METHODS = 'GET, HEAD';
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_UNAVAILABLE = 503;

/**
 * An empty answer with the security headers of the images.
 *
 * @param status The status.
 * @param extra Further headers.
 * @returns The response.
 */
function emptyAnswer(status: number, extra: Readonly<Record<string, string>> = {}): Response {
	const headers = { ...securityHeadersFor('media', { https: false, nonce: '' }), ...extra };
	return new Response(null, { headers: { ...headers, 'cache-control': 'no-store' }, status });
}

/**
 * Answers a request for `/media/<file>`. Other methods than GET and HEAD get 405 before anything
 * is opened; a failing database or storage gives an empty 503, logged by error code only.
 *
 * @param request The request.
 * @param file The last path segment.
 * @param services Opens the database and the storage of the request.
 * @returns The image, 404, 405 or 503.
 */
async function handleMediaRequest(
	request: Request,
	file: string,
	services: () => Promise<MediaServices>,
): Promise<Response> {
	const { method } = request;
	if (method !== 'GET' && method !== 'HEAD') {
		return emptyAnswer(HTTP_METHOD_NOT_ALLOWED, { allow: ALLOWED_METHODS });
	}
	try {
		const { db, platform, storage } = await services();
		const found = storage === null ? null : await openMedia(db, storage, file);
		return mediaResponse(found, method, platform);
	} catch (error) {
		// oxlint-disable-next-line no-console -- the code only; the next request tries again
		console.error('media request failed', errorLabelWithCause(error));
		return emptyAnswer(HTTP_UNAVAILABLE);
	}
}

export { handleMediaRequest };
export type { MediaServices };
