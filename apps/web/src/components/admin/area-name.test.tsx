import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vite-plus/test';

import type { MessageKey } from '@/i18n/translate';
import { MAX_AREA_NAME_LENGTH } from '@/server/areas/form';

import { areaNameField, useAreaNameErrors, useAreaNameValidation } from './area-name';

/**
 * Translates to the key itself, so the tests see which message was chosen.
 *
 * @param key The message key.
 * @returns The key.
 */
const t = (key: MessageKey): string => key;

/**
 * Runs a hook once inside a server render.
 *
 * @param hook The hook call.
 * @returns What the hook returned.
 */
function runHook<T>(hook: () => T): T {
	const results: T[] = [];
	function Probe(): ReactNode {
		results.push(hook());
		return null;
	}
	renderToStaticMarkup(<Probe />);
	const [result] = results;
	if (result === undefined) throw new Error('The hook did not run.');
	return result;
}

describe(areaNameField, () => {
	it('returns the trimmed name', () => {
		const formData = new FormData();
		formData.set('name', '  Vorstand  ');
		expect(areaNameField(formData)).toBe('Vorstand');
	});

	it('returns an empty string without a name or with a file', () => {
		expect(areaNameField(new FormData())).toBe('');
		const formData = new FormData();
		formData.set('name', new Blob(['x']));
		expect(areaNameField(formData)).toBe('');
	});
});

describe(useAreaNameErrors, () => {
	it('shows no error before the first refusal', () => {
		expect(runHook(() => useAreaNameErrors(null, t))).toStrictEqual({});
	});

	it('shows the refusal at the name field', () => {
		expect(runHook(() => useAreaNameErrors({ failure: 'exists' }, t))).toStrictEqual({
			name: 'areas.exists',
		});
		expect(runHook(() => useAreaNameErrors({ failure: 'invalid' }, t))).toStrictEqual({
			name: 'areas.nameInvalid',
		});
	});
});

describe(useAreaNameValidation, () => {
	it('applies the rule of the server and leaves an empty field to isRequired', () => {
		const validate = runHook(() => useAreaNameValidation(t));
		expect(validate('')).toBeNull();
		expect(validate('Vorstand')).toBeNull();
		expect(validate('   ')).toBe('areas.nameInvalid');
		expect(validate('x'.repeat(MAX_AREA_NAME_LENGTH + 1))).toBe('areas.nameInvalid');
	});
});
