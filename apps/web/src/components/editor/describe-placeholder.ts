import type { Translate } from '@/i18n/translate';
import type { PlaceholderRef } from '@/mail/placeholders/syntax';

/**
 * A placeholder and what happens when its value is missing, in words.
 *
 * @param ref The placeholder.
 * @param name Its name.
 * @param t The translation function.
 * @returns E.g. „Vorname, Pflicht“ or „Vorname, sonst leer“.
 */
function describePlaceholder(ref: Readonly<PlaceholderRef>, name: string, t: Translate): string {
	if (ref.fallback === null) return t('editor.placeholderRequired', { name });
	if (ref.fallback === '') return t('editor.placeholderOptional', { name });
	return t('editor.placeholderWithFallback', { fallback: ref.fallback, name });
}

export { describePlaceholder };
