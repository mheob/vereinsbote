import { describe, expect, it, vi } from 'vite-plus/test';

import { runVercelMigrationStep, vercelMigrationStep } from './vercel-migrations';

describe(vercelMigrationStep, () => {
	it('migrates in a production build', () => {
		expect(vercelMigrationStep({ VERCEL: '1', VERCEL_ENV: 'production' })).toBe('migrate');
	});

	it('skips preview and development builds on Vercel', () => {
		expect(vercelMigrationStep({ VERCEL: '1', VERCEL_ENV: 'preview' })).toBe('skip');
		expect(vercelMigrationStep({ VERCEL: '1', VERCEL_ENV: 'development' })).toBe('skip');
		expect(
			vercelMigrationStep({ MIGRATE_ON_PREVIEW: 'true', VERCEL: '1', VERCEL_ENV: 'preview' }),
		).toBe('skip');
	});

	it('migrates a preview build when MIGRATE_ON_PREVIEW=1', () => {
		expect(
			vercelMigrationStep({ MIGRATE_ON_PREVIEW: '1', VERCEL: '1', VERCEL_ENV: 'preview' }),
		).toBe('migrate');
	});

	it('refuses a Vercel build without a known VERCEL_ENV', () => {
		expect(vercelMigrationStep({ VERCEL: '1' })).toBe('refuse');
		expect(vercelMigrationStep({ VERCEL: '1', VERCEL_ENV: '' })).toBe('refuse');
		expect(vercelMigrationStep({ VERCEL: '1', VERCEL_ENV: 'staging' })).toBe('refuse');
		expect(vercelMigrationStep({ MIGRATE_ON_PREVIEW: '1', VERCEL: '1' })).toBe('refuse');
	});

	it('keeps the old rules outside Vercel', () => {
		expect(vercelMigrationStep({})).toBe('skip');
		expect(vercelMigrationStep({ VERCEL_ENV: 'development' })).toBe('skip');
		expect(vercelMigrationStep({ VERCEL_ENV: 'staging' })).toBe('skip');
		expect(vercelMigrationStep({ VERCEL_ENV: 'production' })).toBe('migrate');
		expect(vercelMigrationStep({ MIGRATE_ON_PREVIEW: '1' })).toBe('migrate');
	});
});

interface StepDeps {
	error: ReturnType<typeof vi.fn<(message: string) => void>>;
	log: ReturnType<typeof vi.fn<(message: string) => void>>;
	migrate: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

function stepDeps(): StepDeps {
	return {
		error: vi.fn<(message: string) => void>(),
		log: vi.fn<(message: string) => void>(),
		migrate: vi.fn<() => Promise<void>>().mockResolvedValue(),
	};
}

/** A Vercel build with an unknown `VERCEL_ENV` and a secret elsewhere in the environment. */
const UNKNOWN_ENV_BUILD = {
	DATABASE_URL: 'postgres://u:secret@db/x',
	VERCEL: '1',
	VERCEL_ENV: 'stage-x7',
};

describe(runVercelMigrationStep, () => {
	it('migrates a production build and exits with 0', async () => {
		const step = stepDeps();
		await expect(
			runVercelMigrationStep({ VERCEL: '1', VERCEL_ENV: 'production' }, step),
		).resolves.toBe(0);
		expect(step.migrate).toHaveBeenCalledOnce();
		expect(step.error).not.toHaveBeenCalled();
	});

	it('skips a preview build with a message and exits with 0', async () => {
		const step = stepDeps();
		await expect(
			runVercelMigrationStep({ VERCEL: '1', VERCEL_ENV: 'preview' }, step),
		).resolves.toBe(0);
		expect(step.migrate).not.toHaveBeenCalled();
		expect(step.log).toHaveBeenCalledWith(expect.stringContaining('Migrations skipped'));
	});

	it('fails a Vercel build without a known VERCEL_ENV with exit code 1', async () => {
		const step = stepDeps();
		await expect(runVercelMigrationStep(UNKNOWN_ENV_BUILD, step)).resolves.toBe(1);
		expect(step.migrate).not.toHaveBeenCalled();
		expect(step.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('VERCEL_ENV'));
	});

	it('names the variable but no value when it fails', async () => {
		const step = stepDeps();
		await runVercelMigrationStep(UNKNOWN_ENV_BUILD, step);
		const output = [...step.error.mock.calls, ...step.log.mock.calls].flat().join('\n');
		expect(output).not.toContain('stage-x7');
		expect(output).not.toContain('secret');
	});
});
