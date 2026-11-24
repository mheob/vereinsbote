import { isNotFound, isRedirect } from '@tanstack/react-router';

import { errorLabelWithCause } from '@/server/error-label';

/** What the client gets for any unexpected failure of a server function. */
class ServerFunctionError extends Error {
	public constructor() {
		super('The server could not complete the request.');
		this.name = 'ServerFunctionError';
	}
}

/**
 * What a failed server function sends to the client. Redirects and not-found results pass, they
 * are answers. Any other error is logged by code and replaced with `ServerFunctionError`: TanStack
 * Start would send the error with its message, which may carry a query, its parameters or other
 * internals. The domain refusals the pages show (a taken address, the last admin) are results, not
 * errors, so nothing the UI needs is lost.
 *
 * @param error What the server function threw.
 * @returns What to throw to the client instead.
 */
function publicError(error: unknown): unknown {
	if (isRedirect(error) || isNotFound(error)) return error;
	// oxlint-disable-next-line no-console -- code or name only, see above
	console.error('server function failed', errorLabelWithCause(error));
	return new ServerFunctionError();
}

export { ServerFunctionError, publicError };
