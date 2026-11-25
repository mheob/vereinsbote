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

/** Replacing the HTML works on HTML templates only: a template of blocks would lose them. */
class TemplateNotHtmlError extends Error {
	public constructor() {
		super('The template is made of blocks.');
		this.name = 'TemplateNotHtmlError';
	}
}

/** A global layout cannot be deleted while templates use it; `templates` says how many. */
class LayoutInUseError extends Error {
	public readonly templates: number;

	public constructor(templates: number) {
		super('A template uses this layout.');
		this.name = 'LayoutInUseError';
		this.templates = templates;
	}
}

/** Another global layout has the name, ignoring case. */
class LayoutNameTakenError extends Error {
	public constructor() {
		super('A layout has this name.');
		this.name = 'LayoutNameTakenError';
	}
}

/** The name of a layout is empty or too long. */
class LayoutNameInvalidError extends Error {
	public constructor() {
		super('The name of a layout has one to 100 characters.');
		this.name = 'LayoutNameInvalidError';
	}
}

/** Somebody replaced or deleted the layout since it was loaded: the version does not match. */
class LayoutChangedError extends Error {
	public constructor() {
		super('The layout was changed in the meantime.');
		this.name = 'LayoutChangedError';
	}
}

export {
	LayoutChangedError,
	LayoutInUseError,
	LayoutNameInvalidError,
	LayoutNameTakenError,
	LayoutNotFoundError,
	TemplateChangedError,
	TemplateInvalidError,
	TemplateNameTakenError,
	TemplateNotFoundError,
	TemplateNotHtmlError,
};
