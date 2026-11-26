/* oxlint-disable max-classes-per-file -- the typed refusals of the occasion module live together */
/*
 * The expected refusals of the occasion module. The server functions turn them into results;
 * no message names an occasion, a template or a sender.
 */

/**
 * Why an occasion is invalid: its template belongs to another area (or is gone), its sender is
 * not released to the area (or is gone), it is archived, or its name is empty or too long.
 */
type OccasionProblem = 'archived' | 'name' | 'senderNotReleased' | 'templateArea';

/** No occasion has the id, e.g. it was deleted in another tab. */
class OccasionNotFoundError extends Error {
	public constructor() {
		super('Unknown occasion.');
		this.name = 'OccasionNotFoundError';
	}
}

/** Somebody saved or removed the occasion since it was loaded: the version does not match. */
class OccasionChangedError extends Error {
	public constructor() {
		super('The occasion was changed in the meantime.');
		this.name = 'OccasionChangedError';
	}
}

/** Another occasion of the area has the name, ignoring case. */
class OccasionNameTakenError extends Error {
	public constructor() {
		super('An occasion of this area has this name.');
		this.name = 'OccasionNameTakenError';
	}
}

/** The occasion does not pass the checks; `problem` says which. */
class OccasionInvalidError extends Error {
	public readonly problem: OccasionProblem;

	public constructor(problem: OccasionProblem) {
		super('The occasion is invalid.');
		this.name = 'OccasionInvalidError';
		this.problem = problem;
	}
}

export {
	OccasionChangedError,
	OccasionInvalidError,
	OccasionNameTakenError,
	OccasionNotFoundError,
};
export type { OccasionProblem };
