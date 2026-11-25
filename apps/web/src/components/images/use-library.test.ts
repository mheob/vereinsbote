/* oxlint-disable typescript/no-unsafe-type-assertion -- stand-ins for the server function wrapper and its call */
import type { useServerFn } from '@tanstack/react-start';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { renderHook } from '@/components/hook-harness';
import { loadImages } from '@/functions/images';
import type { LibraryPage } from '@/functions/images';

import { useLibrary } from './use-library';

vi.mock(import('react'), async (importOriginal) => {
	const harness = await import('@/components/hook-harness');
	return {
		...(await importOriginal()),
		useCallback: harness.useCallback,
		useState: harness.useState,
	};
});
vi.mock(import('@tanstack/react-start'), async (importOriginal) => ({
	...(await importOriginal()),
	useServerFn: ((fn: unknown) => fn) as typeof useServerFn,
}));
vi.mock(import('@/functions/images'), async (importOriginal) => ({
	...(await importOriginal()),
	loadImages: vi.fn<typeof loadImages>(),
}));

const loadMock = vi.mocked(loadImages);
const FIRST: LibraryPage = { areaId: 'a', areas: [], images: [], storageReady: true };
const SECOND: LibraryPage = { areaId: 'b', areas: [], images: [], storageReady: false };

describe(useLibrary, () => {
	beforeEach(() => {
		loadMock.mockReset();
	});

	it('starts with what the loader gave', () => {
		const { result } = renderHook(() => useLibrary(FIRST));
		expect(result.current).toMatchObject({ failed: false, loading: false, page: FIRST });
	});

	it('loads the first readable area without an id and keeps the page', async () => {
		loadMock.mockResolvedValue(SECOND);
		const { result } = renderHook(() => useLibrary(null));
		await result.current.reload();
		expect(loadMock).toHaveBeenCalledWith({ data: {} });
		expect(result.current).toMatchObject({ failed: false, loading: false, page: SECOND });
	});

	it('loads the area with an id', async () => {
		loadMock.mockResolvedValue(SECOND);
		const { result } = renderHook(() => useLibrary(FIRST));
		await result.current.reload('area-1');
		expect(loadMock).toHaveBeenCalledWith({ data: { areaId: 'area-1' } });
		expect(result.current.page).toBe(SECOND);
	});

	it('flags a failed call and keeps the page', async () => {
		loadMock.mockRejectedValue(new Error('offline'));
		const { result } = renderHook(() => useLibrary(FIRST));
		await result.current.reload();
		expect(result.current).toMatchObject({ failed: true, loading: false, page: FIRST });
	});

	it('leaves the state alone after a redirect', async () => {
		loadMock.mockResolvedValue(undefined as never);
		const { result } = renderHook(() => useLibrary(FIRST));
		await result.current.reload();
		expect(result.current).toMatchObject({ failed: false, page: FIRST });
	});
});
