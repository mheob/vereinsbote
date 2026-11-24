import { describe, expect, it } from 'vite-plus/test';

import { migratesOnVercel } from './vercel-migrations';

describe(migratesOnVercel, () => {
	it('migrates in a production build', () => {
		expect(migratesOnVercel({ VERCEL_ENV: 'production' })).toBe(true);
	});

	it('skips preview and development builds', () => {
		expect(migratesOnVercel({ VERCEL_ENV: 'preview' })).toBe(false);
		expect(migratesOnVercel({ VERCEL_ENV: 'development' })).toBe(false);
		expect(migratesOnVercel({})).toBe(false);
		expect(migratesOnVercel({ MIGRATE_ON_PREVIEW: 'true', VERCEL_ENV: 'preview' })).toBe(false);
	});

	it('migrates a preview build when MIGRATE_ON_PREVIEW=1', () => {
		expect(migratesOnVercel({ MIGRATE_ON_PREVIEW: '1', VERCEL_ENV: 'preview' })).toBe(true);
	});
});
