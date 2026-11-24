import { isLocale } from '@/i18n/locale';
import type { Locale } from '@/i18n/locale';

interface ChangeLocaleDeps {
	/** Stores the language (cookie and, when signed in, the user's language). */
	readonly save: (locale: Locale) => Promise<unknown>;
	/** Loads the page again, in the new language. */
	readonly reload: () => void;
}

/**
 * The language switcher's action: saves the language of the pressed button, then reloads the
 * page in it. A failed save is reported, never thrown, so the page stays usable.
 *
 * @param formData The submitted form with the pressed button's `locale`.
 * @param deps How to save and how to reload.
 * @returns `failed` when the language could not be saved, otherwise null.
 */
async function changeLocale(formData: FormData, deps: ChangeLocaleDeps): Promise<'failed' | null> {
	const locale = formData.get('locale');
	if (!isLocale(locale)) return null;
	try {
		await deps.save(locale);
	} catch {
		return 'failed';
	}
	deps.reload();
	return null;
}

export { changeLocale };
