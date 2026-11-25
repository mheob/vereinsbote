/*
 * The checks a template passes before it is stored (Design 9, 10, 13). No database: the caller
 * loads the allowed placeholders of the area and its images. Every write runs them, so a stored
 * template always passes them; it can only become invalid through changes elsewhere (field
 * protection, a deleted image), which the editor reports when it opens the template.
 */
import { collectPlaceholderRefs, MAX_TEMPLATE_JSON_BYTES } from '@/mail/blocks/block-schema';
import type { Block, ColumnBlock } from '@/mail/blocks/block-schema';
import { SALUTATION_CASES } from '@/mail/placeholders/salutation';
import type { SalutationTexts } from '@/mail/placeholders/salutation';
import { parsePlaceholders } from '@/mail/placeholders/syntax';
import type { TemplateBody, TemplateInput } from '@/mail/templates/template-schema';

import type { AllowedPlaceholders } from './allowed-placeholders';

/** The longest template name, counted after trimming. */
const MAX_TEMPLATE_NAME_LENGTH = 100;
const MAX_TEMPLATE_SUBJECT_LENGTH = 200;
const MAX_TEMPLATE_PREHEADER_LENGTH = 200;

/** The only placeholders a salutation text may use (Design 10.3). */
const SALUTATION_TEXT_KEYS: ReadonlySet<string> = new Set([
	'contact.firstName',
	'contact.lastName',
	'contact.organization',
]);

/**
 * Why a template cannot be stored. `where` names the place of a placeholder: `subject`,
 * `preheader`, `salutation.<case>` or `block.<id>` (`blockWhere`).
 */
type SaveProblem =
	| { readonly kind: 'nameEmpty' }
	| { readonly kind: 'subjectEmpty' }
	| { readonly kind: 'tooLong'; readonly field: 'name' | 'subject' | 'preheader' }
	| { readonly kind: 'altMissing'; readonly blockId: string }
	| { readonly kind: 'placeholderUnknown'; readonly key: string; readonly where: string }
	| { readonly kind: 'placeholderForbidden'; readonly key: string; readonly where: string }
	| { readonly kind: 'syntax'; readonly where: string }
	| { readonly kind: 'tooBig' }
	| { readonly kind: 'mediaForeign'; readonly mediaId: string }
	| { readonly kind: 'linkMissing'; readonly blockId: string }
	| { readonly kind: 'htmlNotYetSupported' };

/** HTML (a template or an own layout) waits for the HTML import, which checks it (Task 16). */
const HTML_NOT_YET_SUPPORTED: SaveProblem = { kind: 'htmlNotYetSupported' };

const encoder = new TextEncoder();

/**
 * The place of a block's placeholder in a problem.
 *
 * @param blockId The id of the block.
 * @returns `block.<id>`.
 */
function blockWhere(blockId: string): string {
	return `block.${blockId}`;
}

/**
 * The placeholder keys of a text with placeholder syntax, each once.
 *
 * @param text The text.
 * @returns The keys in order, or null when the text does not parse.
 */
function keysOfText(text: string): string[] | null {
	const parsed = parsePlaceholders(text);
	if (!parsed.ok) return null;
	return parsed.segments.flatMap((segment) =>
		segment.kind === 'placeholder' ? [segment.ref.key] : [],
	);
}

/**
 * Judges placeholder keys against the allowed ones.
 *
 * @param keys The keys.
 * @param where The place they stand.
 * @param allowed The placeholders of the area.
 * @returns A problem per key that is not allowed: forbidden when it exists, else unknown.
 */
function judgeKeys(
	keys: readonly string[],
	where: string,
	allowed: AllowedPlaceholders,
): SaveProblem[] {
	return keys
		.filter((key) => !allowed.keys.has(key))
		.map((key): SaveProblem => ({
			key,
			kind: allowed.known.has(key) ? 'placeholderForbidden' : 'placeholderUnknown',
			where,
		}));
}

/**
 * Checks a text with placeholder syntax: the subject or the preheader.
 *
 * @param text The text.
 * @param where `subject` or `preheader`.
 * @param allowed The placeholders of the area.
 * @returns The problems.
 */
function textProblems(text: string, where: string, allowed: AllowedPlaceholders): SaveProblem[] {
	const keys = keysOfText(text);
	return keys === null ? [{ kind: 'syntax', where }] : judgeKeys(keys, where, allowed);
}

/**
 * Checks name, subject and preheader for emptiness and length.
 *
 * @param input The template.
 * @returns The problems.
 */
function fieldProblems(input: TemplateInput): SaveProblem[] {
	const problems: SaveProblem[] = [];
	const name = input.name.trim();
	if (name === '') problems.push({ kind: 'nameEmpty' });
	if (name.length > MAX_TEMPLATE_NAME_LENGTH) problems.push({ field: 'name', kind: 'tooLong' });
	if (input.subject.trim() === '') problems.push({ kind: 'subjectEmpty' });
	if (input.subject.length > MAX_TEMPLATE_SUBJECT_LENGTH) {
		problems.push({ field: 'subject', kind: 'tooLong' });
	}
	if (input.preheader.length > MAX_TEMPLATE_PREHEADER_LENGTH) {
		problems.push({ field: 'preheader', kind: 'tooLong' });
	}
	return problems;
}

/**
 * Checks the salutation texts: they must parse and may use first name, last name and
 * organization only.
 *
 * @param texts The texts per case.
 * @returns The problems.
 */
function salutationProblems(texts: SalutationTexts): SaveProblem[] {
	return SALUTATION_CASES.flatMap((salutationCase): SaveProblem[] => {
		const where = `salutation.${salutationCase}`;
		const keys = keysOfText(texts[salutationCase]);
		if (keys === null) return [{ kind: 'syntax', where }];
		return keys
			.filter((key) => !SALUTATION_TEXT_KEYS.has(key))
			.map((key): SaveProblem => ({ key, kind: 'placeholderForbidden', where }));
	});
}

/**
 * Checks one block that is no columns block: its placeholders, alt text, link and image.
 *
 * @param block The block.
 * @param allowed The placeholders of the area.
 * @param areaMediaIds The images of the area's library.
 * @returns The problems.
 */
function leafProblems(
	block: ColumnBlock,
	allowed: AllowedPlaceholders,
	areaMediaIds: ReadonlySet<string>,
): SaveProblem[] {
	const keys = collectPlaceholderRefs([block]).map(({ key }) => key);
	const problems = judgeKeys(keys, blockWhere(block.id), allowed);
	if (block.type === 'image') {
		if (!block.decorative && block.alt.trim() === '') {
			problems.push({ blockId: block.id, kind: 'altMissing' });
		}
		if (block.mediaId !== null && !areaMediaIds.has(block.mediaId)) {
			problems.push({ kind: 'mediaForeign', mediaId: block.mediaId });
		}
	}
	if (block.type === 'button' && block.href === '') {
		problems.push({ blockId: block.id, kind: 'linkMissing' });
	}
	return problems;
}

/**
 * Checks the body: every block, or the HTML that the HTML import will check.
 *
 * @param body The body.
 * @param allowed The placeholders of the area.
 * @param areaMediaIds The images of the area's library.
 * @returns The problems in document order.
 */
function bodyProblems(
	body: TemplateBody,
	allowed: AllowedPlaceholders,
	areaMediaIds: ReadonlySet<string>,
): SaveProblem[] {
	if (body.kind === 'html') return [HTML_NOT_YET_SUPPORTED];
	const leaves = body.blocks.flatMap((block: Block): ColumnBlock[] =>
		block.type === 'columns' ? [...block.left, ...block.right] : [block],
	);
	return [
		...leaves.flatMap((block) => leafProblems(block, allowed, areaMediaIds)),
		...(body.layout.kind === 'own' ? [HTML_NOT_YET_SUPPORTED] : []),
	];
}

/**
 * Keeps the first of equal problems, e.g. a placeholder used twice in one place.
 *
 * @param problems The problems.
 * @returns The problems, each once, in their order.
 */
function unique(problems: readonly SaveProblem[]): SaveProblem[] {
	return [...new Map(problems.map((problem) => [JSON.stringify(problem), problem])).values()];
}

/**
 * The problems that keep a template from being stored. A template above 256 KB as JSON is
 * refused as a whole, without looking further.
 *
 * @param input The template.
 * @param allowed The placeholders of its area (`allowedTemplatePlaceholders`).
 * @param areaMediaIds The images of its area's library.
 * @returns The problems, each once, in the order of the editor; empty when it may be stored.
 */
function checkTemplateForSave(
	input: TemplateInput,
	allowed: AllowedPlaceholders,
	areaMediaIds: ReadonlySet<string>,
): SaveProblem[] {
	if (encoder.encode(JSON.stringify(input)).byteLength > MAX_TEMPLATE_JSON_BYTES) {
		return [{ kind: 'tooBig' }];
	}
	return unique([
		...fieldProblems(input),
		...textProblems(input.subject, 'subject', allowed),
		...textProblems(input.preheader, 'preheader', allowed),
		...salutationProblems(input.salutationTexts),
		...bodyProblems(input.body, allowed, areaMediaIds),
	]);
}

export {
	blockWhere,
	checkTemplateForSave,
	MAX_TEMPLATE_NAME_LENGTH,
	MAX_TEMPLATE_PREHEADER_LENGTH,
	MAX_TEMPLATE_SUBJECT_LENGTH,
};
export type { SaveProblem };
