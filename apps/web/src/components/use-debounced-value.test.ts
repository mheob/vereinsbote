import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { renderHook } from './hook-harness';
import { useDebouncedValue } from './use-debounced-value';

vi.mock(import('react'), async (importOriginal) => {
	const harness = await import('./hook-harness');
	return { ...(await importOriginal()), useEffect: harness.useEffect, useState: harness.useState };
});

describe(useDebouncedValue, () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('starts with the first value', () => {
		const { result } = renderHook(() => useDebouncedValue('a', 300));
		expect(result.current).toBe('a');
	});

	it('follows a changed value only after the delay', () => {
		let value = 'a';
		const { rerender, result } = renderHook(() => useDebouncedValue(value, 300));
		value = 'b';
		rerender();
		expect(result.current).toBe('a');
		vi.advanceTimersByTime(299);
		expect(result.current).toBe('a');
		vi.advanceTimersByTime(1);
		expect(result.current).toBe('b');
	});

	it('restarts the delay when the value changes again', () => {
		let value = 'a';
		const { rerender, result } = renderHook(() => useDebouncedValue(value, 300));
		value = 'b';
		rerender();
		vi.advanceTimersByTime(200);
		value = 'c';
		rerender();
		vi.advanceTimersByTime(200);
		expect(result.current).toBe('a');
		vi.advanceTimersByTime(100);
		expect(result.current).toBe('c');
	});

	it('does not set a value after the unmount', () => {
		let value = 'a';
		const { rerender, result, unmount } = renderHook(() => useDebouncedValue(value, 300));
		value = 'b';
		rerender();
		unmount();
		vi.advanceTimersByTime(1000);
		expect(result.current).toBe('a');
	});
});
