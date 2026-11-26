import { describe, expect, it } from 'vite-plus/test';

import { addChosen, INITIAL_DRAFT, removeChosen, selectionOf, selectionRequest } from './selection';
import type { SelectionDraft } from './selection';

const ANNA = { email: 'anna@example.org', id: 'a', kind: 'member', name: 'Anna' } as const;
const FIRMA = { email: null, id: 'f', kind: 'partner', name: 'Firma' } as const;

describe(selectionOf, () => {
	it('selects every contact the search and filters of the kind find', () => {
		const draft: SelectionDraft = {
			...INITIAL_DRAFT,
			group: 'Jugend',
			kind: 'member',
			query: 'muster',
			tag: 'Sponsor',
		};
		expect(selectionOf(draft)).toStrictEqual({
			contactIds: null,
			filters: { group: 'Jugend' },
			kind: 'member',
			query: 'muster',
		});
		expect(selectionOf({ ...draft, kind: 'partner' })).toStrictEqual({
			contactIds: null,
			filters: { tag: 'Sponsor' },
			kind: 'partner',
			query: 'muster',
		});
		expect(selectionOf({ ...draft, group: null, kind: 'both', tag: null })).toStrictEqual({
			contactIds: null,
			filters: {},
			kind: 'both',
			query: 'muster',
		});
	});

	it('selects the chosen contacts of both kinds one by one, whatever the filters say', () => {
		const draft: SelectionDraft = {
			...INITIAL_DRAFT,
			chosen: [ANNA, FIRMA],
			group: 'Jugend',
			mode: 'single',
			query: 'muster',
		};
		expect(selectionOf(draft)).toStrictEqual({
			contactIds: ['a', 'f'],
			filters: {},
			kind: 'both',
			query: '',
		});
	});

	it('starts with every member', () => {
		expect(selectionOf(INITIAL_DRAFT)).toStrictEqual({
			contactIds: null,
			filters: {},
			kind: 'member',
			query: '',
		});
	});
});

describe(addChosen, () => {
	it('adds a contact once', () => {
		const once = addChosen([ANNA], FIRMA);
		expect(once).toStrictEqual([ANNA, FIRMA]);
		expect(addChosen(once, ANNA)).toBe(once);
	});
});

describe(removeChosen, () => {
	it('removes a contact by id', () => {
		expect(removeChosen([ANNA, FIRMA], 'a')).toStrictEqual([FIRMA]);
	});
});

describe(selectionRequest, () => {
	it('copies a selection into the shape a server function takes', () => {
		const ids = ['a', 'f'] as const;
		const selection = {
			contactIds: ids,
			filters: { group: 'Jugend' },
			kind: 'both',
			query: '',
		} as const;
		const request = selectionRequest(selection);
		expect(request).toStrictEqual({
			contactIds: ['a', 'f'],
			filters: { group: 'Jugend' },
			kind: 'both',
			query: '',
		});
		expect(request.contactIds).not.toBe(ids);
		expect(selectionRequest(selectionOf(INITIAL_DRAFT)).contactIds).toBeNull();
	});
});
