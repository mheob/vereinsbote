/*
 * What a refused copy tells the user: the placeholders the target area does not allow. Keys
 * only, never content.
 */
import type { SaveProblem } from './save-checks';

/**
 * The keys of the placeholders a copy may not have in the target area (not allowed there, or
 * unknown), each once, in the order they were found.
 *
 * @param problems What the save checks found.
 * @returns The keys; empty when the problems are of another kind.
 */
function refusedPlaceholderKeys(problems: readonly SaveProblem[]): string[] {
	const keys = problems.flatMap((problem) =>
		problem.kind === 'placeholderForbidden' || problem.kind === 'placeholderUnknown'
			? [problem.key]
			: [],
	);
	return [...new Set(keys)];
}

export { refusedPlaceholderKeys };
