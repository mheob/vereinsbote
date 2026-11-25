const NONCE_BYTES = 16;

const nonces = new WeakMap<object, string>();

/**
 * The Content Security Policy nonce of a request: 16 random bytes, base64. It is made once per
 * request object, so the response header (`start.ts`) and the router's script tags (`router.tsx`)
 * carry the same value, and it differs between requests.
 *
 * @param request The request the nonce belongs to (any object that lives as long as the request).
 * @returns The nonce.
 */
function cspNonceFor(request: object): string {
	const known = nonces.get(request);
	if (known !== undefined) return known;
	const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
	const nonce = btoa(String.fromCodePoint(...bytes));
	nonces.set(request, nonce);
	return nonce;
}

export { cspNonceFor };
