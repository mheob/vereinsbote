import { describe, expect, it } from 'vite-plus/test';

import { contactValuesState } from './preview-values-state';

const VALUES = new Map([['contact.firstName', 'Anna']]);

describe(contactValuesState, () => {
	it('is idle without a contact', () => {
		expect(contactValuesState(null, { contactId: 'a', values: VALUES })).toStrictEqual({
			status: 'idle',
		});
	});

	it('loads until an answer for this contact arrives', () => {
		expect(contactValuesState('a', null)).toStrictEqual({ status: 'loading' });
		expect(contactValuesState('a', { contactId: 'b', values: VALUES })).toStrictEqual({
			status: 'loading',
		});
		expect(contactValuesState('a', { contactId: 'b', failed: true })).toStrictEqual({
			status: 'loading',
		});
	});

	it('gives the values of the contact', () => {
		expect(contactValuesState('a', { contactId: 'a', values: VALUES })).toStrictEqual({
			status: 'ready',
			values: VALUES,
		});
	});

	it('keeps a failed call as a state of its own', () => {
		expect(contactValuesState('a', { contactId: 'a', failed: true })).toStrictEqual({
			status: 'failed',
		});
	});
});
