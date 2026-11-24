import { describe, expect, it, vi } from 'vite-plus/test';

import { changeLocale } from './change-locale';

/**
 * The form data of a pressed language button.
 *
 * @param locale The value of the button.
 * @returns The form data.
 */
function pressed(locale: string): FormData {
	const formData = new FormData();
	formData.set('locale', locale);
	return formData;
}

describe(changeLocale, () => {
	it('saves the language, then reloads the page', async () => {
		const save = vi.fn<(locale: 'de' | 'en') => Promise<void>>().mockResolvedValue();
		const reload = vi.fn<() => void>();
		await expect(changeLocale(pressed('en'), { reload, save })).resolves.toBeNull();
		expect(save).toHaveBeenCalledWith('en');
		expect(reload).toHaveBeenCalledOnce();
	});

	it('reports a failed save instead of throwing, and stays on the page', async () => {
		const save = vi
			.fn<(locale: 'de' | 'en') => Promise<void>>()
			.mockRejectedValue(new Error('offline'));
		const reload = vi.fn<() => void>();
		await expect(changeLocale(pressed('de'), { reload, save })).resolves.toBe('failed');
		expect(reload).not.toHaveBeenCalled();
	});

	it('ignores a value that is no language', async () => {
		const save = vi.fn<(locale: 'de' | 'en') => Promise<void>>();
		const reload = vi.fn<() => void>();
		await expect(changeLocale(pressed('fr'), { reload, save })).resolves.toBeNull();
		expect(save).not.toHaveBeenCalled();
		expect(reload).not.toHaveBeenCalled();
	});
});
