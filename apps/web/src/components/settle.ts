/** A server function call that failed (network, server error); the page says so. */
const FAILED = 'failed';

/**
 * Waits for a server function. The result is undefined when the server redirected (the session
 * ended; the redirect takes over then), although its type does not say so.
 *
 * @param call The call.
 * @returns The result, undefined after a redirect, or `failed` when the call failed.
 */
async function settle<T>(call: Promise<T>): Promise<T | typeof FAILED | undefined> {
	try {
		return await call;
	} catch {
		return FAILED;
	}
}

export { FAILED, settle };
