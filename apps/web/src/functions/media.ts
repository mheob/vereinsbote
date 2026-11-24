import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import type { UploadImageResult } from '@/server/media/media';

/*
 * Uploads an image: a brand logo (admin) or an image of an area's library (`edit` in the area).
 * The browser sends the file as form data. Server modules are imported inside the handler, so
 * they stay out of the client bundle.
 */

interface UploadImageRequest {
	readonly file: File;
	readonly target: Readonly<{ purpose: 'brand' } | { purpose: 'library'; areaId: string }>;
}

const targetSchema = z.discriminatedUnion('purpose', [
	z.object({ purpose: z.literal('brand') }),
	z.object({ areaId: z.uuid(), purpose: z.literal('library') }),
]);

/**
 * Reads the upload form: a file, the purpose and, for the library, the area.
 *
 * @param data What the server function received.
 * @returns The request.
 * @throws {Error} For anything but such a form.
 */
function parseUploadFormData(data: unknown): UploadImageRequest {
	if (!(data instanceof FormData)) throw new TypeError('An upload is form data.');
	const file = data.get('file');
	if (!(file instanceof File)) throw new TypeError('An upload has a file.');
	const areaId = data.get('areaId');
	const target = targetSchema.parse({
		purpose: data.get('purpose'),
		...(areaId === null ? {} : { areaId }),
	});
	return { file, target };
}

/**
 * Stores an image. Refusals (`invalidImage`, `storageMissing`, `gone`) are results; without the
 * right for the target it throws `ForbiddenError`.
 */
const uploadImage = createServerFn({ method: 'POST' })
	.validator(parseUploadFormData)
	.handler(async ({ data }): Promise<UploadImageResult> => {
		const [{ requireRequestPrincipal }, { MAX_IMAGE_BYTES, uploadImageResult }] = await Promise.all(
			[import('@/platform/request-principal'), import('@/server/media/media')],
		);
		const { context, principal } = await requireRequestPrincipal();
		// Refuse by the declared size before the bytes are read; `storeImage` checks the real ones.
		if (data.file.size > MAX_IMAGE_BYTES) return { failure: 'invalidImage', ok: false };
		const bytes = new Uint8Array(await data.file.arrayBuffer());
		return uploadImageResult(context.db, context.storage, principal, data.target, {
			bytes,
			name: data.file.name,
		});
	});

export { uploadImage };
