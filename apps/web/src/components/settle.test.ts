import { describe, expect, it } from 'vite-plus/test';

import { FAILED, settle } from './settle';

describe(settle, () => {
	it('gives the result of a call', async () => {
		await expect(settle(Promise.resolve({ ok: true }))).resolves.toStrictEqual({ ok: true });
	});

	it('gives undefined when the server redirected', async () => {
		// The type of a server function says nothing of it; Start resolves the call without a value.
		await expect(settle(Promise.resolve())).resolves.toBeUndefined();
	});

	it('gives `failed` for a call that failed', async () => {
		const failed = Promise.reject(new Error('Network down.'));
		await expect(settle(failed)).resolves.toBe(FAILED);
	});
});
