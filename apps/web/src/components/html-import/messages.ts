/*
 * The words of an HTML import (Design 22): what the cleaning removed, what it warns about and why
 * it refuses. Refusals use the messages of the editor's save problems, so a placeholder is
 * explained alike at the import and when saving.
 */
import type { Translate } from '@/i18n/translate';
import type { ImportFinding, ImportRefusal } from '@/server/html-import/import-html';
import { placeholderLabel } from '@/server/templates/editor-placeholders';

/** What is imported: it decides the message of a foreign image. */
type ImportTarget = 'template' | 'ownLayout' | 'globalLayout';

/** A message with a key that is the same for the same finding. */
interface Message {
	readonly key: string;
	readonly text: string;
}

/** What an import tells apart: what it removed, what it warns about. */
interface FindingGroups {
	readonly removed: readonly Message[];
	readonly warnings: readonly Message[];
}

const KIBIBYTE = 1024;

/**
 * The name of a placeholder as the editor shows it; a custom field by its key.
 *
 * @param key The placeholder key.
 * @param t The translation function.
 * @returns The name.
 */
function labelOf(key: string, t: Translate): string {
	return placeholderLabel(key, [], t);
}

/**
 * The message of a refusal.
 *
 * @param refusal The refusal.
 * @param target What is imported.
 * @param t The translation function.
 * @returns The message.
 */
function refusalMessage(refusal: ImportRefusal, target: ImportTarget, t: Translate): string {
	if (refusal.kind === 'tooLarge') return t('htmlImport.refusal.tooLarge');
	if (refusal.kind === 'mediaForeign') {
		return t(
			target === 'globalLayout'
				? 'htmlImport.refusal.mediaForeignBrand'
				: 'editor.problem.mediaForeign',
		);
	}
	if (refusal.kind === 'placeholderUnknown' || refusal.kind === 'placeholderForbidden') {
		return t(`editor.problem.${refusal.kind}`, { name: labelOf(refusal.key, t) });
	}
	if (refusal.kind === 'placeholderInComment') {
		return t('editor.problem.placeholderInComment', { name: labelOf(refusal.key, t) });
	}
	if (refusal.kind === 'placeholderInAttribute' || refusal.kind === 'fallbackNotAllowed') {
		return t(`editor.problem.${refusal.kind}`, {
			attribute: refusal.attribute,
			name: labelOf(refusal.key, t),
		});
	}
	return t(`editor.problem.${refusal.kind}`);
}

/**
 * The messages of refusals, each with a key of its own.
 *
 * @param refusals The refusals.
 * @param target What is imported.
 * @param t The translation function.
 * @returns The messages in the order of the refusals.
 */
function refusalMessages(
	refusals: readonly ImportRefusal[],
	target: ImportTarget,
	t: Translate,
): Message[] {
	return refusals.map((refusal) => ({
		key: JSON.stringify(refusal),
		text: refusalMessage(refusal, target, t),
	}));
}

/** A warning that counts how often it happened. */
type CountedWarning = Extract<
	ImportFinding,
	{ kind: 'outlookCss' | 'altMissing' | 'tablePresentation' }
>;

/**
 * The message of a warning that counts.
 *
 * @param finding The finding.
 * @param t The translation function.
 * @returns The message.
 */
function countedWarning(finding: CountedWarning, t: Translate): string {
	if (finding.kind === 'outlookCss') {
		return t('htmlImport.warning.outlookCss', { count: finding.count, property: finding.property });
	}
	return t(`htmlImport.warning.${finding.kind}`, { count: finding.count });
}

/**
 * The message of a finding that is a warning.
 *
 * @param finding The finding.
 * @param t The translation function.
 * @returns The message.
 */
function warningMessage(
	finding: Exclude<ImportFinding, { kind: 'removed' }>,
	t: Translate,
): string {
	if (finding.kind === 'vagueLink')
		return t('htmlImport.warning.vagueLink', { text: finding.text });
	if (finding.kind === 'headingOrder') {
		return t('htmlImport.warning.headingOrder', { level: finding.level });
	}
	if (finding.kind === 'externalImage') {
		return t('htmlImport.warning.externalImage', { host: finding.host });
	}
	if (finding.kind === 'clipped') {
		return t('htmlImport.warning.clipped', { kb: Math.round(finding.bytes / KIBIBYTE) });
	}
	return finding.kind === 'langAdded'
		? t('htmlImport.warning.langAdded')
		: countedWarning(finding, t);
}

/**
 * Sorts the findings of an import into what was removed and what is only a warning.
 *
 * @param findings The findings.
 * @param t The translation function.
 * @returns The messages of both groups, in the order of the findings.
 */
function findingGroups(findings: readonly ImportFinding[], t: Translate): FindingGroups {
	const removed: Message[] = [];
	const warnings: Message[] = [];
	for (const finding of findings) {
		const key = JSON.stringify(finding);
		if (finding.kind === 'removed') {
			removed.push({
				key,
				text: t(`htmlImport.removed.${finding.what}`, { count: finding.count }),
			});
		} else {
			warnings.push({ key, text: warningMessage(finding, t) });
		}
	}
	return { removed, warnings };
}

export { findingGroups, refusalMessages };
export type { FindingGroups, ImportTarget, Message };
