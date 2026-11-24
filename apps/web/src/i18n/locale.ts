/** The languages of the UI. German is the default. */
const SUPPORTED_LOCALES = ['de', 'en'] as const;

type Locale = (typeof SUPPORTED_LOCALES)[number];

const DEFAULT_LOCALE: Locale = 'de';

/** The cookie that keeps the language a visitor chose with the language switcher. */
const LOCALE_COOKIE = 'locale';

const HIGHEST_QUALITY = 1;

interface LanguageRange {
	/** The primary subtag in lowercase: `de` for `de-AT`. */
	readonly language: string;
	/** The q-value; NaN when it cannot be read. */
	readonly quality: number;
}

/**
 * Tells whether a value is one of the supported locales, exactly as written.
 *
 * @param value Any value, e.g. a cookie or form value.
 * @returns True for `de` and `en`.
 */
function isLocale(value: unknown): value is Locale {
	return SUPPORTED_LOCALES.some((locale) => locale === value);
}

/**
 * Reads one entry of `Accept-Language`, such as `de-AT;q=0.8`.
 *
 * @param entry The entry between two commas.
 * @returns The language and its q-value.
 */
function parseLanguageRange(entry: string): LanguageRange {
	const [range = '', ...parameters] = entry.split(';').map((part) => part.trim());
	const quality = parameters.find((parameter) => parameter.toLowerCase().startsWith('q='));
	return {
		language: range.split('-')[0]?.toLowerCase() ?? '',
		quality: quality === undefined ? HIGHEST_QUALITY : Number(quality.slice('q='.length)),
	};
}

/**
 * Picks the supported locale the browser prefers most. Entries with a q-value of 0 or an
 * unreadable one are skipped; equal q-values keep the order of the header.
 *
 * @param acceptLanguage The `Accept-Language` header.
 * @returns The locale, or null when the header names none.
 */
function preferredLocale(acceptLanguage: string): Locale | null {
	const ranked = acceptLanguage
		.split(',')
		.map((entry) => parseLanguageRange(entry))
		.filter(({ quality }) => quality > 0 && quality <= HIGHEST_QUALITY)
		// `toSorted` is stable, so equal q-values stay in header order.
		.toSorted((first, second) => second.quality - first.quality);
	return ranked.map(({ language }) => language).find((language) => isLocale(language)) ?? null;
}

/**
 * Decides the language of a request: a valid `locale` cookie wins, then the first supported
 * language of `Accept-Language` by q-value (`de-AT` counts as `de`), else German.
 *
 * @param input The request's values.
 * @param input.cookie The value of the `locale` cookie, or null without one.
 * @param input.acceptLanguage The `Accept-Language` header, or null without one.
 * @returns The locale.
 */
function resolveLocale(
	input: Readonly<{ cookie: string | null; acceptLanguage: string | null }>,
): Locale {
	if (isLocale(input.cookie)) return input.cookie;
	if (input.acceptLanguage === null) return DEFAULT_LOCALE;
	return preferredLocale(input.acceptLanguage) ?? DEFAULT_LOCALE;
}

export { DEFAULT_LOCALE, LOCALE_COOKIE, SUPPORTED_LOCALES, isLocale, resolveLocale };
export type { Locale };
