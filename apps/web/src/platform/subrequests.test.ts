import { describe, expect, it, vi } from 'vite-plus/test';

import {
	CLOUDFLARE_PROVIDER_REQUESTS,
	SubrequestLimitError,
	budgetedFetch,
	createSubrequestBudget,
	invocationBudget,
	isSubrequestLimit,
} from './subrequests';

describe(createSubrequestBudget, () => {
	it('hands out as many requests as it allows', () => {
		const budget = createSubrequestBudget(2);
		expect([budget.take(), budget.take(), budget.take(), budget.left()]).toStrictEqual([
			true,
			true,
			false,
			0,
		]);
	});
});

describe(invocationBudget, () => {
	it('bounds the provider requests on cloudflare only, well below the 10,000 of workers paid', () => {
		expect(invocationBudget('cloudflare')?.left()).toBe(CLOUDFLARE_PROVIDER_REQUESTS);
		expect(CLOUDFLARE_PROVIDER_REQUESTS).toBeLessThanOrEqual(1000);
		expect([invocationBudget('node'), invocationBudget('vercel')]).toStrictEqual([null, null]);
	});
});

describe(budgetedFetch, () => {
	it('refuses a request once the budget is spent, without making it', async () => {
		const made = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
		const limited = budgetedFetch(made, createSubrequestBudget(1));
		await expect(limited('https://example.org/a')).resolves.toHaveProperty('status', 204);
		await expect(limited('https://example.org/b')).rejects.toBeInstanceOf(SubrequestLimitError);
		expect(made).toHaveBeenCalledOnce();
	});

	it('leaves fetch alone without a budget', () => {
		const made = vi.fn<typeof fetch>();
		expect(budgetedFetch(made, null)).toBe(made);
	});
});

describe(isSubrequestLimit, () => {
	it.each([
		[new SubrequestLimitError(), true],
		// What workerd throws at the limit of an invocation.
		[new Error('Too many subrequests.'), true],
		[new Error('Subrequest count exceeded limit of 1000'), true],
		[new TypeError('fetch failed'), false],
		[new DOMException('The operation timed out.', 'TimeoutError'), false],
		['Too many subrequests.', false],
	])('tells whether %o kept the request from leaving', (thrown, expected) => {
		expect(isSubrequestLimit(thrown)).toBe(expected);
	});
});
