/* oxlint-disable typescript/no-unsafe-type-assertion -- a stand-in for React's ref of the heading */
import type { useRef } from 'react';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { Announce } from '@/components/announcements';
import { renderHook } from '@/components/hook-harness';
import { translate } from '@/i18n/translate';
import type { Translate } from '@/i18n/translate';

import { stepBeside, stepHeading, useSteps } from './flow-steps';

const t: Translate = (key, params) => translate('de', key, params);
const { focus } = vi.hoisted(() => ({ focus: vi.fn<() => void>() }));

vi.mock(import('react'), async (importOriginal) => {
	const harness = await import('@/components/hook-harness');
	return {
		...(await importOriginal()),
		useCallback: harness.useCallback,
		useEffect: harness.useEffect,
		// One heading for every render: the test sees whether it got the focus.
		useRef: (() => ({ current: { focus } })) as unknown as typeof useRef,
		useState: harness.useState,
	};
});
vi.mock(import('@/i18n/use-t'), async (importOriginal) => ({
	...(await importOriginal()),
	useT: () => t,
}));

describe(stepBeside, () => {
	it('moves between the three steps and stays at either end', () => {
		expect(stepBeside('recipients', 'forward')).toBe('attachments');
		expect(stepBeside('attachments', 'forward')).toBe('preview');
		expect(stepBeside('preview', 'forward')).toBe('preview');
		expect(stepBeside('attachments', 'back')).toBe('recipients');
		expect(stepBeside('recipients', 'back')).toBe('recipients');
	});
});

describe(stepHeading, () => {
	it('numbers the step', () => {
		expect(stepHeading(t, 'attachments')).toBe('Schritt 2 von 3: Anhänge');
	});
});

describe(useSteps, () => {
	it('moves to the next step, focuses its heading and announces it', () => {
		const announce = vi.fn<Announce>();
		const { result } = renderHook(() => useSteps(announce));
		expect(result.current.step).toBe('recipients');
		expect(focus).not.toHaveBeenCalled();
		result.current.move('forward');
		expect(result.current.step).toBe('attachments');
		expect(focus).toHaveBeenCalledOnce();
		expect(announce).toHaveBeenCalledWith('Schritt 2 von 3: Anhänge', 'status');
	});
});
