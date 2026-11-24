import { describe, expect, it } from 'vite-plus/test';

import { variablesOf } from './bindings';

describe(variablesOf, () => {
	it('keeps the strings and drops object bindings such as an R2 bucket', () => {
		expect(
			variablesOf({ APP_URL: 'https://bote.example.org', MEDIA_BUCKET: { bound: true }, N: 1 }),
		).toStrictEqual({ APP_URL: 'https://bote.example.org' });
	});
});
