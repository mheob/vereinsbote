/** The text fields of the sender form, by name. */
type TextFieldName =
	| 'archiveBcc'
	| 'dailyLimit'
	| 'displayName'
	| 'email'
	| 'perMinute'
	| 'replyTo';

/**
 * Reads a text field of the submitted form.
 *
 * @param formData The submitted form.
 * @param name The field name.
 * @returns The value, or an empty string.
 */
function textValue(formData: FormData, name: TextFieldName): string {
	const value = formData.get(name);
	return typeof value === 'string' ? value : '';
}

/**
 * A number field of the submitted form: empty is null, a text that is no number is NaN (which
 * the server refuses).
 *
 * @param formData The submitted form.
 * @param name The field name.
 * @returns The number, or null.
 */
function numberValue(formData: FormData, name: TextFieldName): number | null {
	const value = textValue(formData, name).trim();
	return value === '' ? null : Number(value);
}

export { numberValue, textValue };
export type { TextFieldName };
