/*
 * What the form „Neue Vorlage“ prefills: a starter brings its own name and subject, an empty
 * template none. What the user typed stays when the start changes.
 */
import { STARTER_IDS, starterTemplate } from '@/mail/starters/starters';
import type { StarterId } from '@/mail/starters/starters';

/** How a new template starts: empty, from a starter or from imported HTML. */
type StartChoice = 'empty' | 'html' | StarterId;

/** The choices in the order the form offers them. */
const START_CHOICES: readonly StartChoice[] = ['empty', ...STARTER_IDS, 'html'];

/** The name and the subject of the form. */
interface TemplateNames {
	readonly name: string;
	readonly subject: string;
}

const NO_NAMES: TemplateNames = { name: '', subject: '' };

/**
 * Whether a value is one of the choices.
 *
 * @param value Any value, e.g. what a radio group reports.
 * @returns True for `empty`, `html` and the ids of the starters.
 */
function isStartChoice(value: string): value is StartChoice {
	const choices: readonly string[] = START_CHOICES;
	return choices.includes(value);
}

/**
 * The name and subject a start prefills.
 *
 * @param start The start.
 * @returns The defaults of a starter; empty texts for an empty template and imported HTML.
 */
function startDefaults(start: StartChoice): TemplateNames {
	if (start === 'empty' || start === 'html') return NO_NAMES;
	const { defaultName, defaultSubject } = starterTemplate(start);
	return { name: defaultName, subject: defaultSubject };
}

/**
 * What a field shows after the start changed.
 *
 * @param value What the field holds.
 * @param old The default of the old start.
 * @param next The default of the new start.
 * @returns The default of the new start if the user typed nothing of their own, else the value.
 */
function pick(value: string, old: string, next: string): string {
	return value === '' || value === old ? next : value;
}

/**
 * The name and subject after the start changed: each field takes the new defaults unless the user
 * typed something of their own into it, i.e. unless it is empty or still the old default.
 *
 * @param current The fields as they are.
 * @param from The start before the change.
 * @param to The start after the change.
 * @returns The fields to show.
 */
function namesAfterStartChange(
	current: TemplateNames,
	from: StartChoice,
	to: StartChoice,
): TemplateNames {
	const before = startDefaults(from);
	const after = startDefaults(to);
	return {
		name: pick(current.name, before.name, after.name),
		subject: pick(current.subject, before.subject, after.subject),
	};
}

export { isStartChoice, namesAfterStartChange, START_CHOICES, startDefaults };
export type { StartChoice, TemplateNames };
