/* oxlint-disable typescript/no-unsafe-type-assertion, eslint/max-statements, eslint/no-empty-function -- a test stand-in: React's hooks keep typed state in untyped slots */
/*
 * A minimal stand-in for React's hooks, for the unit tests of a hook (there is no DOM in the unit
 * tests). A test mocks `react` with `useState`, `useEffect` and `useCallback` from here and runs the
 * hook with `renderHook`. State is kept per call position; an effect runs after a render when its
 * dependencies changed, and its cleanup runs before it runs again and on `unmount`.
 */

import type {
	DependencyList,
	Dispatch,
	EffectCallback,
	SetStateAction,
	useCallback as ReactUseCallback,
	useEffect as ReactUseEffect,
	useState as ReactUseState,
} from 'react';

interface EffectSlot {
	deps: DependencyList | undefined;
	cleanup: (() => void) | undefined;
}

interface Harness {
	cells: unknown[];
	effects: EffectSlot[];
	queued: (() => void)[];
	position: number;
	effectPosition: number;
	rerender: () => void;
}

let current: Harness | null = null;

/**
 * The running harness.
 *
 * @returns The harness of the hook that is rendering.
 */
function running(): Harness {
	if (current === null) throw new Error('A hook ran outside renderHook.');
	return current;
}

/**
 * `useState` of the harness.
 *
 * @param initial The initial value or a function that returns it.
 * @returns The value and its setter, which renders again.
 */
const useState = (<T>(initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] => {
	const harness = running();
	const index = harness.position++;
	if (!(index in harness.cells)) {
		harness.cells[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
	}
	const set: Dispatch<SetStateAction<T>> = (value) => {
		const before = harness.cells[index] as T;
		harness.cells[index] =
			typeof value === 'function' ? (value as (previous: T) => T)(before) : value;
		harness.rerender();
	};
	return [harness.cells[index] as T, set];
}) as typeof ReactUseState;

/**
 * `useCallback` of the harness: the function itself.
 *
 * @param fn The function.
 * @returns The same function.
 */
const useCallback = ((fn: unknown) => fn) as typeof ReactUseCallback;

/**
 * `useEffect` of the harness.
 *
 * @param effect The effect; it may return a cleanup.
 * @param deps The dependencies; the effect runs again when one changed.
 */
const useEffect = ((effect: EffectCallback, deps?: DependencyList): void => {
	const harness = running();
	const index = harness.effectPosition++;
	harness.effects[index] ??= { cleanup: undefined, deps: undefined };
	const slot = harness.effects[index];
	const changed =
		deps === undefined ||
		slot.deps === undefined ||
		deps.some((dependency, at) => !Object.is(dependency, slot.deps?.[at]));
	if (!changed) return;
	harness.queued.push(() => {
		slot.cleanup?.();
		const cleanup = effect();
		slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
		slot.deps = deps;
	});
}) as typeof ReactUseEffect;

/**
 * Runs a hook like a component that renders it.
 *
 * @param hook The hook with its arguments.
 * @returns The latest result, a `rerender` and an `unmount` that runs the cleanups.
 */
function renderHook<R>(hook: () => R): {
	readonly result: { current: R };
	rerender: () => void;
	unmount: () => void;
} {
	const result = { current: undefined as R };
	const harness: Harness = {
		cells: [],
		effectPosition: 0,
		effects: [],
		position: 0,
		queued: [],
		rerender: () => {},
	};
	const render = (): void => {
		const previous = current;
		current = harness;
		harness.position = 0;
		harness.effectPosition = 0;
		harness.queued = [];
		try {
			result.current = hook();
		} finally {
			current = previous;
		}
		const queued = harness.queued;
		harness.queued = [];
		for (const run of queued) run();
	};
	harness.rerender = render;
	render();
	return {
		rerender: render,
		result,
		unmount: () => {
			for (const slot of harness.effects) slot.cleanup?.();
		},
	};
}

export { renderHook, useCallback, useEffect, useState };
