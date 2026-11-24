/** An object read from the storage. */
interface StoredObject {
	body: ReadableStream<Uint8Array>;
	contentType: string;
	size: number;
}

/**
 * Private object storage for the images: R2 on Cloudflare, Vercel Blob on Vercel, an S3 bucket on
 * Node/Docker. Keys are the app's own (`media/<id>`), never a user's input.
 */
interface ObjectStorage {
	readonly put: (
		key: string,
		bytes: Uint8Array,
		options: Readonly<{ contentType: string }>,
	) => Promise<void>;
	/** @returns The object, or null when the key does not exist. */
	readonly get: (key: string) => Promise<StoredObject | null>;
	/** A missing key is no error. */
	readonly delete: (key: string) => Promise<void>;
}

/** No storage is set up for this platform. The message names no setting value. */
class StorageNotConfiguredError extends Error {
	public constructor() {
		super('No object storage is configured.');
		this.name = 'StorageNotConfiguredError';
	}
}

/**
 * A stream that yields the bytes at once.
 *
 * @param bytes The content.
 * @returns A readable stream of it.
 */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

export { StorageNotConfiguredError, streamOf };
export type { ObjectStorage, StoredObject };
