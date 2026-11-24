/**
 * Tells a late answer from a current one in the import wizard. Every step change moves the guard;
 * a request starts at the current step, and its answer counts only while no step change came in
 * between (e.g. „Andere Datei wählen“ while the preview of the old file is on its way).
 */
interface StepGuard {
	/** Marks a step change: answers to requests started before it no longer count. */
	readonly move: () => void;
	/** Starts a request; the returned check tells whether its answer still counts. */
	readonly start: () => () => boolean;
}

/**
 * Creates the guard of a wizard.
 *
 * @returns The guard, at its first step.
 */
function createStepGuard(): StepGuard {
	let moves = 0;
	return {
		move: () => {
			moves += 1;
		},
		start: () => {
			const at = moves;
			return () => moves === at;
		},
	};
}

export { createStepGuard };
export type { StepGuard };
