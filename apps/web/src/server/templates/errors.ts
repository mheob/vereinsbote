/* oxlint-disable max-classes-per-file -- the typed refusals of the template modules live together */
/*
 * The expected refusals of the template modules. The server functions turn them into results;
 * no message names content of a template.
 */
import type { SaveProblem } from './save-checks';

/** No template has the id, e.g. it was deleted in another tab. */
class TemplateNotFoundError extends Error {
	public constructor() {
		super('Unknown template.');
		this.name = 'TemplateNotFoundError';
	}
}

/** Somebody saved or deleted the template since it was loaded: the version does not match. */
class TemplateChangedError extends Error {
	public constructor() {
		super('The template was changed in the meantime.');
		this.name = 'TemplateChangedError';
	}
}

/** The template does not pass the save checks; `problems` says why (keys and ids, no content). */
class TemplateInvalidError extends Error {
	public readonly problems: readonly SaveProblem[];

	public constructor(problems: readonly SaveProblem[]) {
		super('The template does not pass the save checks.');
		this.name = 'TemplateInvalidError';
		this.problems = problems;
	}
}

/** Another template of the area has the name, ignoring case. */
class TemplateNameTakenError extends Error {
	public constructor() {
		super('A template of this area has this name.');
		this.name = 'TemplateNameTakenError';
	}
}

/** The chosen global layout does not exist (any more), e.g. deleted in another tab. */
class LayoutNotFoundError extends Error {
	public constructor() {
		super('Unknown layout.');
		this.name = 'LayoutNotFoundError';
	}
}

/** A global layout cannot be deleted while a template uses it. */
class LayoutInUseError extends Error {
	public constructor() {
		super('A template uses this layout.');
		this.name = 'LayoutInUseError';
	}
}

export {
	LayoutInUseError,
	LayoutNotFoundError,
	TemplateChangedError,
	TemplateInvalidError,
	TemplateNameTakenError,
	TemplateNotFoundError,
};
