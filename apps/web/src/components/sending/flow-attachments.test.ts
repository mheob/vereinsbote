import { describe, expect, it, vi } from 'vite-plus/test';

import { renderHook } from '@/components/hook-harness';

import { useFlowAttachments, withAttachment } from './flow-attachments';

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
	size: 100,
	type: 'application/pdf',
	waveId: null,
} as const;
const PLAN = { ...FLYER, id: 'plan', name: 'plan.png', type: 'image/png' } as const;

describe(withAttachment, () => {
	it('adds a file last, once', () => {
		expect(withAttachment([FLYER], PLAN)).toStrictEqual([FLYER, PLAN]);
		expect(withAttachment([FLYER, PLAN], FLYER)).toStrictEqual([PLAN, FLYER]);
	});
});

describe(useFlowAttachments, () => {
	it('starts with the loaded files, adds and removes', () => {
		const loaded = [FLYER];
		const { result } = renderHook(() => useFlowAttachments(loaded));
		expect(result.current.attachments).toStrictEqual([FLYER]);
		result.current.add(PLAN);
		expect(result.current.attachments).toStrictEqual([FLYER, PLAN]);
		result.current.remove('flyer');
		expect(result.current.attachments).toStrictEqual([PLAN]);
	});

	it('starts again from a new load', () => {
		let loaded: readonly (typeof FLYER | typeof PLAN)[] = [FLYER];
		const { rerender, result } = renderHook(() => useFlowAttachments(loaded));
		result.current.add(PLAN);
		loaded = [PLAN];
		rerender();
		expect(result.current.attachments).toStrictEqual([PLAN]);
	});
});
