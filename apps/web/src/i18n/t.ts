import { de } from './de';

const PARAMETER = /\{(?<name>\w+)\}/gu;

export type MessageKey = keyof typeof de;

/**
 * Returns the German text for a key and replaces each `{name}` with its parameter.
 *
 * @param key The key of the text in `de`.
 * @param params The values for the parameters in the text.
 * @returns The text with all parameters replaced.
 * @throws {Error} When the text needs a parameter that is missing.
 */
export function t(key: MessageKey, params: Readonly<Record<string, string | number>> = {}): string {
	return de[key].replaceAll(PARAMETER, (_match: string, name: string) => {
		const value = params[name];
		if (value === undefined) {
			throw new Error(`Message "${key}" needs the parameter "${name}".`);
		}
		return String(value);
	});
}
