/** Better Auth's endpoint that ends the session of the request and clears its cookie. */
const SIGN_OUT_ENDPOINT = '/api/auth/sign-out';

/**
 * Ends the current session through Better Auth's HTTP endpoint.
 *
 * @param fetchFn The fetch to use; the browser's by default.
 * @returns True when the session is ended.
 */
async function requestSignOut(fetchFn: typeof fetch = fetch): Promise<boolean> {
	try {
		const response = await fetchFn(SIGN_OUT_ENDPOINT, {
			body: '{}',
			headers: { 'content-type': 'application/json' },
			method: 'POST',
		});
		return response.ok;
	} catch {
		return false;
	}
}

export { requestSignOut };
