import { errorLabelWithCause } from '@/server/error-label';

import type { Platform, PlatformName } from './platform';

type WaitUntil = Platform['waitUntil'];

/**
 * Logs work after the response that failed. Code or name only, the message may carry details.
 *
 * @param error What the work threw.
 */
function logBackgroundFailure(error: unknown): void {
	// oxlint-disable-next-line no-console -- nothing else awaits the work, see above
	console.error('background work failed', errorLabelWithCause(error));
}

/**
 * Builds a platform's `waitUntil`: it hands the work to the runtime's own `waitUntil` (Vercel's
 * function context, Workers' `cloudflare:workers`), which keeps the instance alive until the work
 * is done. The work never reaches the runtime as a rejection: a failure is logged by code. Without
 * a runtime `waitUntil` the work simply runs on, which a Node process allows; on Vercel and
 * Cloudflare the instance may then stop before it is done, so the first time is logged as a
 * warning.
 *
 * @param platform The platform of the build.
 * @param runtimeWaitUntil Returns the runtime's `waitUntil` for the current request, or null.
 * @returns The `waitUntil` of the platform.
 */
function createBackgroundRunner(
	platform: PlatformName,
	runtimeWaitUntil: () => WaitUntil | null,
): WaitUntil {
	let warned = false;
	return (promise) => {
		// oxlint-disable-next-line promise/prefer-await-to-then -- the work is handed on, nothing here awaits it
		const settled = promise.catch(logBackgroundFailure);
		const waitUntil = runtimeWaitUntil();
		if (waitUntil !== null) {
			waitUntil(settled);
			return;
		}
		if (platform === 'node' || warned) return;
		warned = true;
		// oxlint-disable-next-line no-console -- an operator must learn that work may be cut short
		console.warn('no waitUntil, work after the response may be cut short', platform);
	};
}

export { createBackgroundRunner };
