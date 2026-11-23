import { describe, expect, it } from 'vite-plus/test';

import { createRequestScope } from './request-scope';
import type { RequestScope } from './request-scope';

interface Setup {
	opened: object[];
	ended: object[];
	waited: Promise<unknown>[];
	scope: RequestScope<object>;
}

function setup(): Setup {
	const opened: object[] = [];
	const ended: object[] = [];
	const waited: Promise<unknown>[] = [];
	const scope = createRequestScope<object>({
		// oxlint-disable-next-line typescript/require-await -- the fake resolves immediately
		async create() {
			const value = {};
			opened.push(value);
			return {
				// oxlint-disable-next-line typescript/require-await -- the fake resolves immediately
				async end() {
					ended.push(value);
				},
				value,
			};
		},
		// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a promise cannot be made readonly
		waitUntil(promise) {
			waited.push(promise);
		},
	});
	return { ended, opened, scope, waited };
}

describe('request scope', () => {
	it('shares one resource within a request', async () => {
		const { opened, scope } = setup();
		const request = {};
		const [first, second] = await Promise.all([scope.get(request), scope.get(request)]);
		expect(first).toBe(second);
		expect(opened).toHaveLength(1);
	});

	it('opens one resource per request', async () => {
		const { opened, scope } = setup();
		const first = await scope.get({});
		const second = await scope.get({});
		expect(first).not.toBe(second);
		expect(opened).toHaveLength(2);
	});

	it('ends each resource through waitUntil', async () => {
		const { ended, opened, scope, waited } = setup();
		const [a, b] = [{}, {}];
		await scope.get(a);
		await scope.get(b);
		await scope.release(a);
		await scope.release(b);
		await Promise.all(waited);
		expect(waited).toHaveLength(2);
		expect(ended).toStrictEqual(opened);
	});

	it('ignores a release without a resource', async () => {
		const { scope, waited } = setup();
		await scope.release({});
		expect(waited).toHaveLength(0);
	});

	it('opens a new resource after the release', async () => {
		const { opened, scope } = setup();
		const request = {};
		await scope.get(request);
		await scope.release(request);
		await scope.get(request);
		expect(opened).toHaveLength(2);
	});
});
