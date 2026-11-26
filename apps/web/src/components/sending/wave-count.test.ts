/* oxlint-disable typescript/no-unsafe-type-assertion -- stand-ins for the server function wrapper */
import type { useServerFn } from '@tanstack/react-start';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { renderHook } from '@/components/hook-harness';
import { summarizeWave } from '@/functions/waves';
import type { WaveFailure } from '@/server/waves/failures';
import type { WaveSummary } from '@/server/waves/waves';

import { useWaveCount } from './wave-count';

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
	summarizeWave: vi.fn<typeof summarizeWave>(),
}));

const summarizeMock = vi.mocked(summarizeWave);
const SUMMARY: WaveSummary = {
	attachmentsBytes: 0,
	estimatedDays: 1,
	excluded: {
		exited: 0,
		invalidEmail: 0,
		noEmail: 0,
		optedOutArea: 0,
		optedOutOccasion: 0,
		suppressed: 0,
		unavailable: 0,
	},
	graphTooLarge: false,
	mails: 2,
	merged: 0,
	problem: null,
};
const REQUEST = {
	attachmentIds: ['flyer'],
	recount: 0,
	selection: { contactIds: null, filters: {}, kind: 'member', query: 'muster' },
} as const;

describe(useWaveCount, () => {
	beforeEach(() => {
		summarizeMock.mockReset();
	});

	it('counts the request and gives the summary', async () => {
		summarizeMock.mockResolvedValue({ ok: true, summary: SUMMARY });
		const onFailure = vi.fn<(failure: WaveFailure['failure']) => void>();
		const { result } = renderHook(() => useWaveCount('o', REQUEST, onFailure));
		expect(result.current).toStrictEqual({ status: 'counting' });
		await vi.waitFor(() => {
			expect(result.current).toStrictEqual({ status: 'ready', summary: SUMMARY });
		});
		expect(summarizeMock).toHaveBeenCalledWith({
			data: { attachmentIds: ['flyer'], occasionId: 'o', selection: REQUEST.selection },
		});
	});

	it('says that the count failed and hands a failure of the flow on', async () => {
		summarizeMock.mockResolvedValue({ failure: 'attachmentsGone', ok: false });
		const onFailure = vi.fn<(failure: WaveFailure['failure']) => void>();
		const { result } = renderHook(() => useWaveCount('o', REQUEST, onFailure));
		await vi.waitFor(() => {
			expect(result.current).toStrictEqual({ status: 'failed' });
		});
		expect(onFailure).toHaveBeenCalledWith('attachmentsGone');
	});

	it('says that a failed call failed', async () => {
		summarizeMock.mockRejectedValue(new Error('offline'));
		const onFailure = vi.fn<(failure: WaveFailure['failure']) => void>();
		const { result } = renderHook(() => useWaveCount('o', REQUEST, onFailure));
		await vi.waitFor(() => {
			expect(result.current).toStrictEqual({ status: 'failed' });
		});
		expect(onFailure).not.toHaveBeenCalled();
	});
});
