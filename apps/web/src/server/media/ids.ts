/*
 * The names of stored images. No server imports: the browser builds the same paths for its
 * previews. An id is 16 random bytes as base64url (22 characters) and is the only secret of an
 * image's URL, so it must not be guessable.
 */

type ImageType = 'jpeg' | 'png';

const ID_BYTES = 16;
const FILE_PATTERN = /^(?<id>[\w-]{22})\.(?<extension>jpg|png)$/u;

const EXTENSIONS: Readonly<Record<ImageType, string>> = { jpeg: 'jpg', png: 'png' };

/**
 * A new, unguessable id.
 *
 * @returns 22 characters of base64url.
 */
function newMediaId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES));
	let binary = '';
	for (const byte of bytes) binary += String.fromCodePoint(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * The file name of an image in a URL.
 *
 * @param id The id of the image.
 * @param type The image type.
 * @returns `<id>.jpg` or `<id>.png`.
 */
function mediaFileName(id: string, type: ImageType): string {
	return `${id}.${EXTENSIONS[type]}`;
}

/**
 * The key of an image in the object storage.
 *
 * @param id The id of the image.
 * @returns `media/<id>`.
 */
function mediaStorageKey(id: string): string {
	return `media/${id}`;
}

/**
 * The path of an image on the app.
 *
 * @param id The id of the image.
 * @param type The image type.
 * @returns `/media/<file>`.
 */
function mediaPath(id: string, type: ImageType): string {
	return `/media/${mediaFileName(id, type)}`;
}

/**
 * Reads the file name of a `/media` URL.
 *
 * @param file The last path segment.
 * @returns The id and the type, or null for anything that is not a name `mediaFileName` makes.
 */
function parseMediaFileName(file: string): { id: string; type: ImageType } | null {
	const groups = FILE_PATTERN.exec(file)?.groups;
	if (groups === undefined) return null;
	const { extension, id } = groups;
	if (id === undefined) return null;
	return { id, type: extension === 'jpg' ? 'jpeg' : 'png' };
}

export { mediaFileName, mediaPath, mediaStorageKey, newMediaId, parseMediaFileName };
export type { ImageType };
