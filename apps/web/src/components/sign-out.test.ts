import { describe, expect, it } from 'vite-plus/test';

import { requestSignOut } from './sign-out';

type Call = readonly [input: RequestInfo | URL, init: RequestInit | undefined];

/**
 * A fetch that records its calls and answers as told.
 *
 * @param answer Returns the response, or rejects like a failed request.
 * @returns The fetch and its calls.
 */
function fakeFetch(answer: () => Promise<Response>): { calls: Call[]; fetchFn: typeof fetch } {
	const calls: Call[] = [];
	const fetchFn: typeof fetch = async (input, init) => {
		calls.push([input, init]);
		return answer();
	};
	return { calls, fetchFn };
}

// The fakes answer at once; they are async for the type of `fetch` only.
// oxlint-disable-next-line typescript/require-await -- see above
const ok = async (): Promise<Response> => Response.json({ success: true });
// oxlint-disable-next-line typescript/require-await -- see above
const refused = async (): Promise<Response> => new Response(null, { status: 500 });
// oxlint-disable-next-line typescript/require-await -- see above
const offline = async (): Promise<Response> => {
	throw new TypeError('offline');
};

describe(requestSignOut, () => {
	it("posts to Better Auth's sign-out endpoint", async () => {
		const { calls, fetchFn } = fakeFetch(ok);
		await expect(requestSignOut(fetchFn)).resolves.toBe(true);
		expect(calls).toStrictEqual([
			[
				'/api/auth/sign-out',
				{ body: '{}', headers: { 'content-type': 'application/json' }, method: 'POST' },
			],
		]);
	});

	it('reports a refused or failed request', async () => {
		await expect(requestSignOut(fakeFetch(refused).fetchFn)).resolves.toBe(false);
		await expect(requestSignOut(fakeFetch(offline).fetchFn)).resolves.toBe(false);
	});
});
