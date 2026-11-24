import { notFound, redirect } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { publicError, ServerFunctionError } from './server-fn-errors';

describe(publicError, () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('replaces an unexpected error with a generic one and logs its code only', () => {
		const logged = vi.spyOn(console, 'error').mockReturnValue();
		const cause = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
		const error = new Error('Failed query: select 1\nparams: anna@verein.de', { cause });
		const shown = publicError(error);
		expect(shown).toBeInstanceOf(ServerFunctionError);
		expect(String(shown)).not.toContain('Failed query');
		expect(logged).toHaveBeenCalledWith('server function failed', 'Error (cause: ECONNREFUSED)');
		expect(JSON.stringify(logged.mock.calls)).not.toContain('@');
	});

	it('passes redirects and not-found results on unchanged', () => {
		const logged = vi.spyOn(console, 'error').mockReturnValue();
		const toLogin = redirect({ to: '/login' });
		const missing = notFound();
		expect(publicError(toLogin)).toBe(toLogin);
		expect(publicError(missing)).toBe(missing);
		expect(logged).not.toHaveBeenCalled();
	});
});
