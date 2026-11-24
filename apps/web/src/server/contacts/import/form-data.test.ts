import { describe, expect, it } from 'vite-plus/test';

import { MAX_DELETE_IDS, parseImportFormData, toImportFormData } from './form-data';
import type { ImportFormRequest } from './form-data';

const PARTNER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const CONFIRM: ImportFormRequest = {
	confirmedDeletions: 9,
	deleteIds: [PARTNER_ID, OTHER_ID],
	kind: 'partner',
	payload: new Blob([Uint8Array.from([31, 139, 8, 0])]),
	stockVersion: 12,
};

/**
 * A form as the browser sends it, with one field replaced.
 *
 * @param name The field.
 * @param value The new value; null removes the field.
 * @returns The form.
 */
function formWith(name: string, value: string | null): FormData {
	const form = toImportFormData(CONFIRM);
	if (value === null) form.delete(name);
	else form.set(name, value);
	return form;
}

describe(toImportFormData, () => {
	it('writes the five fields, the ids as JSON', () => {
		const form = toImportFormData(CONFIRM);
		expect([...form.keys()].toSorted()).toStrictEqual([
			'confirmedDeletions',
			'deleteIds',
			'kind',
			'payload',
			'stockVersion',
		]);
		expect(form.get('kind')).toBe('partner');
		expect(form.get('stockVersion')).toBe('12');
		expect(form.get('deleteIds')).toBe(JSON.stringify([PARTNER_ID, OTHER_ID]));
		expect(form.get('payload')).toBeInstanceOf(Blob);
	});
});

describe(parseImportFormData, () => {
	it('round-trips a confirm request', async () => {
		const parsed = parseImportFormData(toImportFormData(CONFIRM));
		expect(parsed).toMatchObject({
			confirmedDeletions: 9,
			deleteIds: [PARTNER_ID, OTHER_ID],
			kind: 'partner',
			stockVersion: 12,
		});
		expect(parsed.payload).toBeInstanceOf(Blob);
		expect(new Uint8Array(await parsed.payload.arrayBuffer())).toStrictEqual(
			Uint8Array.from([31, 139, 8, 0]),
		);
	});

	it('round-trips a preview request without version, deletions and ids', () => {
		const preview: ImportFormRequest = {
			confirmedDeletions: null,
			deleteIds: [],
			kind: 'member',
			payload: new Blob(['x']),
			stockVersion: null,
		};
		expect(parseImportFormData(toImportFormData(preview))).toMatchObject({
			confirmedDeletions: null,
			deleteIds: [],
			kind: 'member',
			stockVersion: null,
		});
	});

	it.each([
		['no form', () => ({ kind: 'member' })],
		['text', () => 'kind=member'],
		['an unknown kind', () => formWith('kind', 'x')],
		['no kind', () => formWith('kind', null)],
		['a version that is no number', () => formWith('stockVersion', 'abc')],
		['a negative version', () => formWith('stockVersion', '-1')],
		['a fraction', () => formWith('stockVersion', '1.5')],
		['an exponent', () => formWith('confirmedDeletions', '1e3')],
		['ids that are no JSON', () => formWith('deleteIds', 'not json')],
		['ids that are no list', () => formWith('deleteIds', '{"id":1}')],
		['ids that are no UUIDs', () => formWith('deleteIds', '["no uuid"]')],
		['a payload that is text', () => formWith('payload', 'text, no file')],
		['no payload', () => formWith('payload', null)],
	])('refuses %s', (_case, data) => {
		expect(() => parseImportFormData(data())).toThrow(Error);
	});

	it('refuses more ids than a confirm may delete', () => {
		const ids = Array.from({ length: MAX_DELETE_IDS + 1 }, () => PARTNER_ID);
		const tooMany = formWith('deleteIds', JSON.stringify(ids));
		const most = formWith('deleteIds', JSON.stringify(ids.slice(1)));
		expect(() => parseImportFormData(tooMany)).toThrow(Error);
		expect(parseImportFormData(most).deleteIds).toHaveLength(MAX_DELETE_IDS);
	});
});
