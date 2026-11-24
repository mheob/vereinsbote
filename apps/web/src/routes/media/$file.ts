import { createFileRoute } from '@tanstack/react-router';

/*
 * Serves the stored images under `/media/<id>.<ext>`. The URL is the only protection (an
 * unguessable id), because the images end up in e-mails: no session is asked for.
 */

type Method = 'GET' | 'HEAD';

async function serve(method: Method, file: string): Promise<Response> {
	const [{ getAppContext }, { mediaResponse, openMedia }] = await Promise.all([
		import('@/platform/context'),
		import('@/server/media/media'),
	]);
	const { db, platform, storage } = await getAppContext();
	const found = storage === null ? null : await openMedia(db, storage, file);
	return mediaResponse(found, method, platform.name);
}

export const Route = createFileRoute('/media/$file')({
	server: {
		handlers: {
			GET: async ({ params }) => serve('GET', params.file),
			HEAD: async ({ params }) => serve('HEAD', params.file),
		},
	},
});
