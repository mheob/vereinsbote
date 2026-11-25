/*
 * Where the editor shows the problems of the save checks (Design 13): at the field or block they
 * concern, with a message in the user's language. The first problem in the checks' order gets
 * the focus; the editor finds its field by `data-problem-focus`.
 */
import type { Translate } from '@/i18n/translate';
import type { Block } from '@/mail/blocks/block-schema';
import type { SaveProblem } from '@/server/templates/save-checks';

import { locateBlock } from './editor-state';

/** Where a problem shows and where the focus goes. */
interface ProblemPlace {
	/** The `data-problem-focus` of the field. */
	readonly focusKey: string;
	/** The block whose form holds the field, or null. */
	readonly blockId: string | null;
	/** Whether the field is in the settings. */
	readonly inSettings: boolean;
}

/** The problems of a save, by place. */
interface ProblemIndex {
	/** The message of each field, by `data-problem-focus`. */
	readonly byField: ReadonlyMap<string, string>;
	/** The blocks with a problem, and the columns blocks that hold one. */
	readonly blockIds: ReadonlySet<string>;
	/** Messages without a field (a template that is too big). */
	readonly general: readonly string[];
	/** The place of the first problem, or null. */
	readonly first: ProblemPlace | null;
}

const BLOCK_PREFIX = 'block.';

/**
 * A field of the settings.
 *
 * @param focusKey The field.
 * @returns The place.
 */
const setting = (focusKey: string): ProblemPlace => ({ blockId: null, focusKey, inSettings: true });

/**
 * A field of a block's form.
 *
 * @param field The field: `content`, `alt`, `href` or `media`.
 * @param blockId The block.
 * @returns The place.
 */
const blockField = (field: string, blockId: string): ProblemPlace => ({
	blockId,
	focusKey: `${field}.${blockId}`,
	inSettings: false,
});

/**
 * The place of a placeholder or syntax problem.
 *
 * @param where `subject`, `preheader`, `salutation.<case>`, `block.<id>`, `layout` or `html`.
 * @returns The place, or null for the HTML of an import, which has no field of its own.
 */
function placeOfWhere(where: string): ProblemPlace | null {
	if (where === 'html') return null;
	return where.startsWith(BLOCK_PREFIX)
		? blockField('content', where.slice(BLOCK_PREFIX.length))
		: setting(where);
}

/**
 * The first image block that shows an image.
 *
 * @param blocks The blocks.
 * @param mediaId The image.
 * @returns The id of the block, or null.
 */
function imageBlockOf(blocks: readonly Block[], mediaId: string): string | null {
	const all = blocks.flatMap((block) =>
		block.type === 'columns' ? [...block.left, ...block.right] : [block],
	);
	return all.find((block) => block.type === 'image' && block.mediaId === mediaId)?.id ?? null;
}

/**
 * Where a problem of the name, the subject or the preview text shows.
 *
 * @param problem The problem.
 * @returns The place.
 */
function fieldPlace(
	problem: Extract<SaveProblem, { kind: 'nameEmpty' | 'subjectEmpty' | 'tooLong' }>,
): ProblemPlace {
	if (problem.kind === 'subjectEmpty') return setting('subject');
	if (problem.kind === 'tooLong' && problem.field !== 'name') return setting(problem.field);
	return { blockId: null, focusKey: 'name', inSettings: false };
}

/**
 * Where a problem shows.
 *
 * @param problem The problem.
 * @param blocks The blocks of the template.
 * @returns The place, or null for a problem of the whole template.
 */
function problemPlace(problem: SaveProblem, blocks: readonly Block[]): ProblemPlace | null {
	if (problem.kind === 'tooBig' || problem.kind === 'tooDeep') return null;
	switch (problem.kind) {
		case 'nameEmpty':
		case 'subjectEmpty':
		case 'tooLong': {
			return fieldPlace(problem);
		}
		case 'contentMissing':
		case 'contentRepeated': {
			return setting('layout');
		}
		case 'altMissing': {
			return blockField('alt', problem.blockId);
		}
		case 'linkMissing': {
			return blockField('href', problem.blockId);
		}
		case 'fallbackNotAllowed':
		case 'placeholderForbidden':
		case 'placeholderInAttribute':
		case 'placeholderInComment':
		case 'placeholderUnknown':
		case 'syntax': {
			return placeOfWhere(problem.where);
		}
		case 'mediaForeign': {
			const blockId = imageBlockOf(blocks, problem.mediaId);
			return blockId === null ? null : blockField('media', blockId);
		}
		default: {
			return null;
		}
	}
}

/**
 * The message of a problem.
 *
 * @param problem The problem.
 * @param label The name of a placeholder key.
 * @param t The translation function.
 * @returns The message.
 */
function problemMessage(
	problem: SaveProblem,
	label: (key: string) => string,
	t: Translate,
): string {
	if (problem.kind === 'tooLong') return t(`editor.problem.${problem.field}TooLong`);
	if (problem.kind === 'placeholderForbidden' || problem.kind === 'placeholderUnknown') {
		return t(`editor.problem.${problem.kind}`, { name: label(problem.key) });
	}
	if (problem.kind === 'placeholderInComment') {
		return t('editor.problem.placeholderInComment', { name: label(problem.key) });
	}
	if (problem.kind === 'placeholderInAttribute' || problem.kind === 'fallbackNotAllowed') {
		return t(`editor.problem.${problem.kind}`, {
			attribute: problem.attribute,
			name: label(problem.key),
		});
	}
	return t(`editor.problem.${problem.kind}`);
}

/**
 * The block ids a problem marks in the lists: its block and the columns block that holds it.
 *
 * @param blockId The block.
 * @param blocks The blocks of the template.
 * @returns The ids.
 */
function markedBlocks(blockId: string, blocks: readonly Block[]): string[] {
	const column = locateBlock(blocks, blockId)?.column;
	return column === null || column === undefined ? [blockId] : [blockId, column.parentId];
}

/**
 * Gives a problem's message to the field it concerns and marks its blocks.
 *
 * @param found What was found so far; this adds to it.
 * @param found.byField The messages by field.
 * @param found.blockIds The marked blocks.
 * @param found.blocks The blocks of the template.
 * @param place The place of the problem.
 * @param message The message of the problem.
 */
function record(
	found: Readonly<{
		byField: Map<string, string>;
		blockIds: Set<string>;
		blocks: readonly Block[];
	}>,
	place: ProblemPlace,
	message: string,
): void {
	const known = found.byField.get(place.focusKey);
	found.byField.set(place.focusKey, known === undefined ? message : `${known} ${message}`);
	if (place.blockId === null) return;
	for (const id of markedBlocks(place.blockId, found.blocks)) found.blockIds.add(id);
}

/**
 * The function that gives the message of a problem.
 *
 * @param label The name of a placeholder key.
 * @param t The translation function.
 * @returns The function.
 */
function problemDescriber(
	label: (key: string) => string,
	t: Translate,
): (problem: SaveProblem) => string {
	return (problem) => problemMessage(problem, label, t);
}

/**
 * Sorts the problems of a save by place.
 *
 * @param problems The problems, in the order of the save checks.
 * @param blocks The blocks of the template.
 * @param describe Gives the message of a problem.
 * @returns The messages by field, the marked blocks, the general messages and the first place.
 */
function indexProblems(
	problems: readonly SaveProblem[],
	blocks: readonly Block[],
	describe: (problem: SaveProblem) => string,
): ProblemIndex {
	const found = { blockIds: new Set<string>(), blocks, byField: new Map<string, string>() };
	const general: string[] = [];
	let first: ProblemPlace | null = null;
	for (const problem of problems) {
		const place = problemPlace(problem, blocks);
		if (place === null) {
			general.push(describe(problem));
		} else {
			record(found, place, describe(problem));
			first ??= place;
		}
	}
	return { blockIds: found.blockIds, byField: found.byField, first, general };
}

export { indexProblems, problemDescriber, problemMessage, problemPlace };
export type { ProblemIndex, ProblemPlace };
