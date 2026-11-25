import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import type { LibraryImage, UsingTemplate } from '@/server/media/library';

/*
 * The server functions of the image library. Server modules are imported inside the handlers, so
 * they stay out of the client bundle. Each handler authorizes itself from the session principal:
 * server functions are reachable without their page.
 */

/** An area whose library the user may see. */
interface LibraryArea {
	readonly id: string;
	readonly name: string;
	readonly canEdit: boolean;
}

interface LibraryPage {
	readonly areas: readonly LibraryArea[];
	/** The area the images belong to: the asked one, else the first; null without any area. */
	readonly areaId: string | null;
	readonly images: readonly Readonly<LibraryImage>[];
	/** False without object storage: uploads (and so images) are impossible then. */
	readonly storageReady: boolean;
}

type ImageNameResult = Readonly<{ ok: true } | { ok: false; failure: 'gone' | 'invalid' }>;

type ImageDeleteResult = Readonly<
	| { ok: true }
	| { ok: false; failure: 'gone' | 'storageMissing' }
	| { ok: false; failure: 'inUse'; templates: readonly UsingTemplate[] }
>;

/** The longest id of an image (22 characters) with room to spare, and the longest name accepted before the server's own check. */
const MAX_ID_LENGTH = 64;
const MAX_NAME_INPUT = 10_000;

const loadRequest = z.object({ areaId: z.uuid().optional() });
const nameRequest = z.object({
	id: z.string().min(1).max(MAX_ID_LENGTH),
	name: z.string().max(MAX_NAME_INPUT),
});
const deleteRequest = z.object({ id: z.string().min(1).max(MAX_ID_LENGTH) });

/**
 * The areas the user may read and the images of one of them. An area the user cannot read (or
 * that is gone) falls back to the first readable one.
 */
const loadImages = createServerFn({ method: 'GET' })
	.validator(loadRequest)
	.handler(async ({ data }): Promise<LibraryPage> => {
		const [{ requireRequestPrincipal }, { listAreas }, { listLibrary }, { levelAtLeast }] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/areas/areas'),
				import('@/server/media/library'),
				import('@/server/permissions/levels'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		const listed = await listAreas(context.db, principal);
		const areas = listed
			.filter(({ level }) => level !== null)
			.map(({ id, level, name }) => ({ canEdit: levelAtLeast(level, 'edit'), id, name }));
		const chosen = areas.find(({ id }) => id === data.areaId) ?? areas[0];
		const storageReady = context.storage !== null;
		if (chosen === undefined) return { areaId: null, areas, images: [], storageReady };
		const images = await listLibrary(context.db, principal, chosen.id);
		return { areaId: chosen.id, areas, images, storageReady };
	});

/** Renames an image; a refused name or a deleted image comes back as a result. */
const submitImageName = createServerFn({ method: 'POST' })
	.validator(nameRequest)
	.handler(async ({ data }): Promise<ImageNameResult> => {
		const [{ requireRequestPrincipal }, library] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/media/library'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await library.renameImage(context.db, principal, data.id, data.name);
			return { ok: true };
		} catch (error) {
			if (error instanceof library.ImageNotFoundError) return { failure: 'gone', ok: false };
			if (error instanceof library.ImageNameInvalidError) return { failure: 'invalid', ok: false };
			throw error;
		}
	});

/** Deletes an image unless a template shows it; then the result names those templates. */
const submitImageDelete = createServerFn({ method: 'POST' })
	.validator(deleteRequest)
	.handler(async ({ data }): Promise<ImageDeleteResult> => {
		const [{ requireRequestPrincipal }, library] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/media/library'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		if (context.storage === null) return { failure: 'storageMissing', ok: false };
		try {
			await library.deleteImage(context.db, context.storage, principal, data.id);
			return { ok: true };
		} catch (error) {
			if (error instanceof library.ImageNotFoundError) return { failure: 'gone', ok: false };
			if (error instanceof library.ImageInUseError) {
				return { failure: 'inUse', ok: false, templates: error.templates };
			}
			throw error;
		}
	});

export { loadImages, submitImageDelete, submitImageName };
export type { ImageDeleteResult, ImageNameResult, LibraryArea, LibraryPage };
