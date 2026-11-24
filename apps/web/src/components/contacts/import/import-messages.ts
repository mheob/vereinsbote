/*
 * The texts of the import wizard that depend on what the server or the file reader returned:
 * every read failure, problem, blocking issue, field issue and skipped row has its message, and
 * none of them carries a value of the file (design 13).
 */
import type { MessageKey, MessageParams } from '@/i18n/translate';
import type { ContactKind } from '@/server/contacts/fields';
import { MAX_COLUMNS, MAX_HEADER_LENGTH } from '@/server/contacts/import/mapping';
import type { MemberImportPreview } from '@/server/contacts/import/members';
import type { PartnerImportPreview, PartnerRowIssue } from '@/server/contacts/import/partners';
import type { ChangedField, ImportChange } from '@/server/contacts/import/plan';
import type { BlockingIssue, FieldIssueReason } from '@/server/contacts/import/rows';
import type { CustomFieldRecord } from '@/server/contacts/settings';

import type { BuildPayloadProblem } from './build-payload';
import type { ReadSheetFailure } from './read-sheet';

/** `translate` or `useT()`, bound to a language. */
type Translate = (key: MessageKey, params?: MessageParams) => string;

/** A text with its parameters. */
type Message = Readonly<{ key: MessageKey; params: MessageParams }>;

/** Why the mapping step cannot go on: its own check, or the server refused the payload. */
type ImportProblem = BuildPayloadProblem | 'payloadInvalid' | 'payloadTooLarge';

/** A preview the user sees, with its kind. */
type KindPreview =
	| Readonly<{ kind: 'member'; preview: MemberImportPreview }>
	| Readonly<{ kind: 'partner'; preview: PartnerImportPreview }>;

/** One row of the counts table. */
interface CountRow {
	readonly label: MessageKey;
	readonly value: number;
}

/** The messages of the problems that are the same for both kinds. */
const PROBLEM_MESSAGES: Readonly<Record<Exclude<ImportProblem, 'keyNotMapped'>, MessageKey>> = {
	fieldMappedTwice: 'import.problem.fieldMappedTwice',
	noRows: 'import.problem.noRows',
	payloadInvalid: 'import.problem.payloadInvalid',
	payloadTooLarge: 'import.problem.tooLarge',
	tooManyRows: 'import.tooManyRows',
};

const CUSTOM_PREFIX = 'custom:';
const NEW_CUSTOM_PREFIX = 'custom:new:';

/**
 * The message of a file the reader refused.
 *
 * @param failure The failure of `readSheetFile`.
 * @returns The message.
 */
function readFailureMessage(failure: ReadSheetFailure): Message {
	if (failure === 'headerTooLong') {
		return { key: 'import.readFailure.headerTooLong', params: { max: MAX_HEADER_LENGTH } };
	}
	if (failure === 'tooManyColumns') {
		return { key: 'import.readFailure.tooManyColumns', params: { max: MAX_COLUMNS } };
	}
	return { key: `import.readFailure.${failure}`, params: {} };
}

/**
 * The message of a problem of the mapping step.
 *
 * @param kind The contact kind.
 * @param problem The problem.
 * @returns The key of the message, which has no parameters.
 */
function problemMessage(kind: ContactKind, problem: ImportProblem): MessageKey {
	return problem === 'keyNotMapped'
		? `import.problem.keyNotMapped.${kind}`
		: PROBLEM_MESSAGES[problem];
}

/**
 * The message of a blocking issue: what to correct in the file or the mapping.
 *
 * @param t The texts.
 * @param kind The contact kind.
 * @param issue The issue.
 * @returns The text.
 */
function blockingMessage(t: Translate, kind: ContactKind, issue: BlockingIssue): string {
	if (issue.reason === 'tooManyRows') {
		return t('import.blocking.tooManyRows', { count: issue.count });
	}
	if (issue.reason === 'keyNotMapped') return t(problemMessage(kind, 'keyNotMapped'));
	if (issue.reason === 'fieldMappedTwice') {
		return t('import.blocking.fieldMappedTwice', { field: t(`import.field.${issue.field}`) });
	}
	if (issue.reason === 'customFieldInvalid') {
		return t('import.blocking.customFieldInvalid', { column: issue.column });
	}
	if (issue.reason === 'numberDuplicate') {
		return t('import.blocking.numberDuplicate', { firstLine: issue.firstLine, line: issue.line });
	}
	return t(`import.blocking.${issue.reason}`, { line: issue.line });
}

/**
 * The reason of a field issue, for the column „Grund“.
 *
 * @param t The texts.
 * @param reason The reason.
 * @returns The text.
 */
function fieldIssueReason(t: Translate, reason: FieldIssueReason): string {
	return t(`import.issue.${reason}`);
}

/**
 * The message of a partner row the import skips.
 *
 * @param t The texts.
 * @param issue The row and why it is skipped.
 * @returns The text.
 */
function rowIssueMessage(t: Translate, issue: PartnerRowIssue): string {
	return t(`import.rowIssue.${issue.reason}`, { line: issue.line });
}

/**
 * Tells whether a changed field is a custom field.
 *
 * @param field The field.
 * @returns True for `custom:…`.
 */
function isCustomField(field: ChangedField): field is `custom:${string}` {
	return field.startsWith(CUSTOM_PREFIX);
}

/**
 * The name of a changed field: a contact field, the groups, or a custom field by its name.
 *
 * @param t The texts.
 * @param field The field.
 * @param customFields The custom fields of the kind.
 * @returns The name.
 */
function changedFieldLabel(
	t: Translate,
	field: ChangedField,
	customFields: readonly Readonly<CustomFieldRecord>[],
): string {
	if (field === 'groups') return t('import.field.groups');
	if (!isCustomField(field)) return t(`import.field.${field}`);
	if (field.startsWith(NEW_CUSTOM_PREFIX)) return field.slice(NEW_CUSTOM_PREFIX.length);
	const id = field.slice(CUSTOM_PREFIX.length);
	const known = customFields.find((customField) => customField.id === id);
	return known?.name ?? t('import.field.customField');
}

/**
 * One entry of the change list: kind of change, number and name, the changed fields and whether
 * an exit date was reached. Values of the fields are never shown.
 *
 * @param t The texts.
 * @param entry The change, the kind and the custom fields of the kind.
 * @returns The text.
 */
function changeText(
	t: Translate,
	entry: Readonly<{
		change: ImportChange;
		customFields: readonly Readonly<CustomFieldRecord>[];
		kind: ContactKind;
	}>,
): string {
	const { change, customFields, kind } = entry;
	const type: MessageKey =
		change.type === 'changed' && kind === 'partner'
			? 'import.count.updated'
			: `import.count.${change.type}`;
	const { primary, secondary } = change.name;
	const name = secondary === null ? primary : `${primary} (${secondary})`;
	const subject = [change.number, name].filter((part) => part !== null && part !== '').join(' ');
	const fields = [
		...change.fields.map((field) => changedFieldLabel(t, field, customFields)),
		...(change.hiddenFields ? [t('import.change.hiddenFields')] : []),
	];
	const details =
		fields.length === 0 ? '' : ` – ${t('import.change.fields', { fields: fields.join(', ') })}`;
	const exited = change.exited ? ` (${t('import.change.exited')})` : '';
	return `${t(type)}: ${subject}${details}${exited}`;
}

/**
 * The rows of the counts table; counts the user may not see (null) are left out.
 *
 * @param result The preview and its kind.
 * @returns The rows in the order of the design.
 */
function countRows(result: KindPreview): CountRow[] {
	if (result.kind === 'partner') {
		const { counts } = result.preview;
		return [
			{ label: 'import.count.created', value: counts.created },
			{ label: 'import.count.updated', value: counts.updated },
			{ label: 'import.count.takenOver', value: counts.takenOver },
			{ label: 'import.count.unchanged', value: counts.unchanged },
			{ label: 'import.count.skipped', value: counts.skipped },
		];
	}
	const { counts } = result.preview;
	const rows: (CountRow | null)[] = [
		{ label: 'import.count.created', value: counts.created },
		{ label: 'import.count.changed', value: counts.changed },
		{ label: 'import.count.unchanged', value: counts.unchanged },
		{ label: 'import.count.removed', value: counts.removed },
		counts.removedExited === null
			? null
			: { label: 'import.count.removedExited', value: counts.removedExited },
		{ label: 'import.count.withoutEmail', value: counts.withoutEmail },
		counts.futureExit === null
			? null
			: { label: 'import.count.futureExit', value: counts.futureExit },
	];
	return rows.filter((row) => row !== null);
}

/**
 * Keys for the entries of a list of texts: the text and how often it appeared so far, so a
 * repeated text gets a key of its own.
 *
 * @param texts The texts in list order.
 * @returns Each text with its key.
 */
function withKeys(texts: readonly string[]): { key: string; text: string }[] {
	const seen = new Map<string, number>();
	return texts.map((text) => {
		const count = (seen.get(text) ?? 0) + 1;
		seen.set(text, count);
		return { key: `${text}#${count}`, text };
	});
}

export {
	blockingMessage,
	changeText,
	countRows,
	fieldIssueReason,
	problemMessage,
	readFailureMessage,
	rowIssueMessage,
	withKeys,
};
export type { CountRow, ImportProblem, KindPreview, Message, Translate };
