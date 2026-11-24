type StorageOperation = 'delete' | 'get' | 'put';

/**
 * A request to the storage failed. The message names the operation only, never the key, a value
 * or a credential; the library's own error stays in `cause` for `errorLabelWithCause`.
 */
class StorageError extends Error {
	public readonly operation: StorageOperation;

	public constructor(operation: StorageOperation, cause: unknown) {
		super(`Object storage request failed (${operation}).`, { cause });
		this.name = 'StorageError';
		this.operation = operation;
	}
}

/**
 * Runs a request of an adapter and turns whatever it throws into a `StorageError`, so no message
 * of a library (which may name keys, URLs or credentials) leaves the adapter.
 *
 * @param operation The operation, for the error.
 * @param run The request.
 * @returns What the request returns.
 */
async function guardStorage<T>(operation: StorageOperation, run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		throw new StorageError(operation, error);
	}
}

export { StorageError, guardStorage };
