import { de } from './de';
import { en } from './en';
import type { Locale } from './locale';

type MessageKey = keyof typeof de;

type MessageParams = Readonly<Record<string, string | number>>;

/** A translation function of one language, as `useT()` gives it. */
type Translate = (key: MessageKey, params?: MessageParams) => string;

const MESSAGES: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { de, en };

const PARAMETER = /\{(?<name>\w+)\}/gu;

/**
 * Returns the text of a key in a language and replaces each `{name}` with its parameter.
 *
 * @param locale The language.
 * @param key The key of the text in `de` and `en`.
 * @param params The values for the parameters in the text; only own properties count.
 * @returns The text with all parameters replaced.
 * @throws {Error} When the text needs a parameter that is missing.
 */
function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
	return MESSAGES[locale][key].replaceAll(PARAMETER, (_match: string, name: string) => {
		const value = Object.hasOwn(params, name) ? params[name] : undefined;
		if (value === undefined) {
			throw new Error(`Message "${key}" needs the parameter "${name}".`);
		}
		return String(value);
	});
}

export { translate };
export type { MessageKey, MessageParams, Translate };
