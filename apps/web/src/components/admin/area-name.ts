import { useCallback, useMemo } from 'react';

import type { AreaNameFailure } from '@/functions/areas';
import type { MessageKey } from '@/i18n/translate';
import { isValidAreaName } from '@/server/areas/form';

/** The refusal of the last submission of an area form; null before the first and after a success. */
type AreaFormState = Readonly<{ failure: AreaNameFailure }> | null;

type Translate = (key: MessageKey) => string;

const FAILURE_MESSAGES: Readonly<Record<AreaNameFailure, MessageKey>> = {
	exists: 'areas.exists',
	invalid: 'areas.nameInvalid',
};

/**
 * The message of a refused name at its field, a new object per refusal, so the error shows
 * again after the field was edited.
 *
 * @param state The state of the form.
 * @param t The translation function.
 * @returns The validation errors for React Aria's `Form`.
 */
function useAreaNameErrors(state: AreaFormState, t: Translate): Readonly<Record<string, string>> {
	return useMemo(
		(): Readonly<Record<string, string>> =>
			state === null ? {} : { name: t(FAILURE_MESSAGES[state.failure]) },
		[state, t],
	);
}

/**
 * The browser's check of an area name, the rule the server applies; an empty field is left to
 * `isRequired`.
 *
 * @param t The translation function.
 * @returns The `validate` function of the name field.
 */
function useAreaNameValidation(t: Translate): (value: string) => string | null {
	return useCallback(
		(value: string) => (value === '' || isValidAreaName(value) ? null : t('areas.nameInvalid')),
		[t],
	);
}

/**
 * Reads the name field of a submitted area form.
 *
 * @param formData The submitted form.
 * @returns The trimmed value, or an empty string.
 */
function areaNameField(formData: FormData): string {
	const value = formData.get('name');
	return typeof value === 'string' ? value.trim() : '';
}

export { areaNameField, useAreaNameErrors, useAreaNameValidation };
export type { AreaFormState };
