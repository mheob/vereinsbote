/* oxlint-disable typescript/no-unsafe-type-assertion -- stand-ins for the server function wrapper */
import type { useServerFn } from '@tanstack/react-start';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { renderHook } from '@/components/hook-harness';
import { FAILED } from '@/components/settle';
import { loadRecipientValues } from '@/functions/waves';
import type { WaveFailure } from '@/server/waves/failures';

import { useRecipientValues, valuesStateOf } from './recipient-values';

vi.mock(import('react'), async (importOriginal) => {
	const harness = await import('@/components/hook-harness');
	return { ...(await importOriginal()), useEffect: harness.useEffect, useState: harness.useState };
});
vi.mock(import('@tanstack/react-start'), async (importOriginal) => ({
	...(await importOriginal()),
	useServerFn: ((fn: unknown) => fn) as typeof useServerFn,
}));
vi.mock(import('@/functions/waves'), async (importOriginal) => ({
	...(await importOriginal()),
	loadRecipientValues: vi.fn<typeof loadRecipientValues>(),
}));

const loadMock = vi.mocked(loadRecipientValues);
const PREVIEW = { contactId: 'a', excluded: null, names: ['Anna'], values: {} } as const;
const ANNA = { email: null, id: 'a', kind: 'member', name: 'Anna' } as const;
const SELECTION = { contactIds: ['a'], filters: {}, kind: 'both', query: '' } as const;

describe(valuesStateOf, () => {
	it('gives the preview, a gone contact, or a failure', () => {
		expect(valuesStateOf({ ok: true, preview: PREVIEW })).toStrictEqual({
			preview: PREVIEW,
			status: 'ready',
		});
		expect(valuesStateOf({ failure: 'contactGone', ok: false })).toStrictEqual({ status: 'gone' });
		expect(valuesStateOf({ failure: 'archived', ok: false })).toStrictEqual({ status: 'failed' });
		expect(valuesStateOf(FAILED)).toStrictEqual({ status: 'failed' });
	});
});

describe(useRecipientValues, () => {
	beforeEach(() => {
		loadMock.mockReset();
	});

	it('loads nothing without a contact', () => {
		const onFailure = vi.fn<(failure: WaveFailure['failure']) => void>();
		const { result } = renderHook(() => useRecipientValues('o', null, SELECTION, onFailure));
		expect(result.current).toStrictEqual({ status: 'loading' });
		expect(loadMock).not.toHaveBeenCalled();
	});

	it('loads the picked contact with a copy of the selection', async () => {
		loadMock.mockResolvedValue({ ok: true, preview: PREVIEW });
		const onFailure = vi.fn<(failure: WaveFailure['failure']) => void>();
		const { result } = renderHook(() => useRecipientValues('o', ANNA, SELECTION, onFailure));
		await vi.waitFor(() => {
			expect(result.current).toStrictEqual({ preview: PREVIEW, status: 'ready' });
		});
		expect(loadMock).toHaveBeenCalledExactlyOnceWith({
			data: { contactId: 'a', occasionId: 'o', selection: { ...SELECTION, contactIds: ['a'] } },
		});
	});

	it('hands a failure of the flow on', async () => {
		loadMock.mockResolvedValue({ failure: 'archived', ok: false });
		const onFailure = vi.fn<(failure: WaveFailure['failure']) => void>();
		const { result } = renderHook(() => useRecipientValues('o', ANNA, SELECTION, onFailure));
		await vi.waitFor(() => {
			expect(result.current).toStrictEqual({ status: 'failed' });
		});
		expect(onFailure).toHaveBeenCalledWith('archived');
	});
});
