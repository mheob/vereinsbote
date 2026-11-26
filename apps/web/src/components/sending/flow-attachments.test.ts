import { describe, expect, it, vi } from 'vite-plus/test';

import { renderHook } from '@/components/hook-harness';

import { chosenAtFirst, chosenIdsOf, useFlowAttachments, withAttachment } from './flow-attachments';

vi.mock(import('react'), async (importOriginal) => {
	const harness = await import('@/components/hook-harness');
	return {
		...(await importOriginal()),
		useCallback: harness.useCallback,
		useState: harness.useState,
	};
});

const FLYER = {
	areaId: 'area',
	id: 'flyer',
	name: 'flyer.pdf',
	own: true,
	size: 100,
	type: 'application/pdf',
	waveId: null,
} as const;
const PLAN = { ...FLYER, id: 'plan', name: 'plan.png', type: 'image/png' } as const;
/** A file of a colleague's flow, or of a flow left unconfirmed by someone else. */
const THEIRS = { ...FLYER, id: 'theirs', name: 'alt.pdf', own: false } as const;

describe(withAttachment, () => {
	it('adds a file last, once', () => {
		expect(withAttachment([FLYER], PLAN)).toStrictEqual([FLYER, PLAN]);
		expect(withAttachment([FLYER, PLAN], FLYER)).toStrictEqual([PLAN, FLYER]);
	});
});

describe(chosenAtFirst, () => {
	it('chooses the own files only', () => {
		expect([...chosenAtFirst([THEIRS, FLYER, PLAN])]).toStrictEqual(['flyer', 'plan']);
		expect([...chosenAtFirst([THEIRS])]).toStrictEqual([]);
	});
});

describe(chosenIdsOf, () => {
	it('gives the chosen files in the order of the list', () => {
		expect(chosenIdsOf([PLAN, THEIRS, FLYER], new Set(['flyer', 'plan']))).toStrictEqual([
			'plan',
			'flyer',
		]);
	});
});

describe(useFlowAttachments, () => {
	it('starts with the loaded files, adds and removes', () => {
		const loaded = [FLYER];
		const { result } = renderHook(() => useFlowAttachments(loaded));
		expect(result.current.attachments).toStrictEqual([FLYER]);
		result.current.add(PLAN);
		expect(result.current.attachments).toStrictEqual([FLYER, PLAN]);
		expect([...result.current.chosen]).toStrictEqual(['flyer', 'plan']);
		result.current.remove('flyer');
		expect(result.current.attachments).toStrictEqual([PLAN]);
		expect([...result.current.chosen]).toStrictEqual(['plan']);
	});

	it('lists the files of others without choosing them, until they are ticked', () => {
		const loaded = [THEIRS, FLYER];
		const { result } = renderHook(() => useFlowAttachments(loaded));
		expect(result.current.attachments).toStrictEqual([THEIRS, FLYER]);
		expect([...result.current.chosen]).toStrictEqual(['flyer']);
		result.current.choose('theirs', true);
		expect([...result.current.chosen].toSorted()).toStrictEqual(['flyer', 'theirs']);
		result.current.choose('flyer', false);
		expect([...result.current.chosen]).toStrictEqual(['theirs']);
	});

	it('marks an upload as own and chooses it', () => {
		const loaded = [THEIRS];
		const { result } = renderHook(() => useFlowAttachments(loaded));
		const { own: _own, ...uploaded } = PLAN;
		result.current.add(uploaded);
		expect(result.current.attachments).toStrictEqual([THEIRS, PLAN]);
		expect([...result.current.chosen]).toStrictEqual(['plan']);
	});

	it('starts again from a new load', () => {
		let loaded: readonly (typeof FLYER | typeof PLAN | typeof THEIRS)[] = [FLYER];
		const { rerender, result } = renderHook(() => useFlowAttachments(loaded));
		result.current.add(PLAN);
		loaded = [PLAN, THEIRS];
		rerender();
		expect(result.current.attachments).toStrictEqual([PLAN, THEIRS]);
		expect([...result.current.chosen]).toStrictEqual(['plan']);
	});
});
