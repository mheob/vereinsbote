/**
 * The security headers of every response, a baseline until the full Content Security Policy
 * comes: no page may be framed (clickjacking), no response is sniffed as another type, and other
 * sites get the origin only as referrer. The request middleware in `start.ts` sets them.
 */
export const SECURITY_HEADERS = {
	'content-security-policy': "frame-ancestors 'none'",
	'referrer-policy': 'strict-origin-when-cross-origin',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
} as const;
