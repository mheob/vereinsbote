/*
 * What an import changes, shared by the member and the partner import: the values a row gives a
 * contact, the changed fields, the change list of the preview (filtered by what the user may
 * see), the batched writes and the confirm skeleton (authorize, lock, compare the stock version,
 * create new custom fields, save the mapping, write the audit entry).
 */
import { inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { AuditAction } from '@/server/audit/audit';
import { assertCanManage, loadContactAccess } from '@/server/contacts/access';
import type { ContactAccess } from '@/server/contacts/access';
import { displayName } from '@/server/contacts/display-name';
import type { DisplayName } from '@/server/contacts/display-name';
import { CONTACT_FIELDS, GENDERS, protectedFieldOf } from '@/server/contacts/fields';
import type { ContactField, ContactKind, FieldKey, Gender } from '@/server/contacts/fields';
import { lockImportState, recordConfirmedImport } from '@/server/contacts/import-state';
import { listCustomFields } from '@/server/contacts/settings';
import type { Db } from '@/server/db/client';
import { contacts, customFields } from '@/server/db/schema';
import type { ContactRecord } from '@/server/db/schema';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import type { ColumnTarget, SavedMapping } from './mapping';
import { toSavedMapping } from './payload';
import type { ImportPayload } from './payload';
import { transformRows } from './rows';
import type { ImportedRow, TransformResult } from './rows';
import { cleanText } from './values';

/** At most this many changes in a preview (decision 9 of the plan); the rest is counted. */
const MAX_LISTED_CHANGES = 1000;
/** At most this many field issues in a preview (decision 9 of the plan); the rest is counted. */
const MAX_LISTED_ISSUES = 1000;
/** Rows per insert, update or delete statement. */
const WRITE_BATCH_SIZE = 500;
/** Member and customer numbers sort as numbers where they are numbers: 2 before 10. */
const NUMBER_ORDER = new Intl.Collator('de', { numeric: true });

/**
 * A field whose value an import changes: a contact field, the groups, or a custom field
 * (`custom:<id>`; a field the import creates is `custom:new:<name>`).
 */
type ChangedField = ContactField | 'groups' | `custom:${string}`;

/** One entry of the change list of a preview. */
interface ImportChange {
	type: 'created' | 'changed' | 'removed';
	/** The member number of a member, the customer number of a partner. */
	number: string | null;
	name: DisplayName;
	/** For `changed`: only the fields the user may see. */
	fields: ChangedField[];
	/** Further fields, which the user may not see, changed as well. */
	hiddenFields: boolean;
	/** For `removed`: the exit date is reached (false for users who may not see it). */
	exited: boolean;
}

/** Why a confirm wrote nothing. */
type ConfirmFailure = 'blocked' | 'confirmationRequired' | 'stockChanged';

type ConfirmImportResult =
	| { ok: true; counts: { created: number; changed: number; removed: number; warnings: number } }
	| { ok: false; failure: ConfirmFailure };

/** The audit actions of the imports. */
type ImportAuditAction = Extract<AuditAction, `import.${string}`>;

/** The text columns of a contact: every contact field but the gender. */
type TextField = Exclude<ContactField, 'gender'>;

/**
 * The columns of a contact an import writes. Custom values are keyed by field id, or by
 * `new:<name>` for a field the confirm creates. The partner tags are never written.
 */
interface ContactValues extends Readonly<Record<TextField, string | null>> {
	readonly kind: ContactKind;
	readonly gender: Gender;
	readonly groups: readonly string[];
	readonly customValues: Readonly<Record<string, string>>;
}

/** A stored contact, deeply readonly; a `ContactRecord` is one. */
type StoredContact = Readonly<Omit<ContactRecord, 'customValues' | 'groups' | 'tags'>> & {
	readonly customValues: Readonly<Record<string, string>>;
	readonly groups: readonly string[];
	readonly tags: readonly string[];
};

/** One change before it is filtered for a user. */
interface ChangeInput {
	readonly type: ImportChange['type'];
	/** The contact after the import (`removed`: the stored one), for its number and name. */
	readonly values: ContactValues;
	readonly fields?: readonly ChangedField[];
	readonly exited?: boolean;
}

/** What the write step of a confirm reports. */
interface WrittenCounts {
	readonly counts: { readonly created: number; readonly changed: number; readonly removed: number };
	/** The audit details of the kind: numbers only, never names. */
	readonly details: Readonly<Record<string, number>>;
}

/** Gives the custom values of a contact their field ids once the new fields exist. */
type WithFieldIds = (values: ContactValues) => ContactValues;

/** The kind-specific steps of a confirm, run under the lock of the import state. */
interface ConfirmSteps<TPlan> {
	/** Compares the checked rows, free of blocking issues, with the locked stock. */
	readonly plan: (tx: Db, rows: TransformResult) => Promise<TPlan>;
	/** A refusal of the kind before anything is written; null to go on. */
	readonly refuse: (plan: TPlan) => Exclude<ConfirmFailure, 'blocked'> | null;
	/** Writes the plan. */
	readonly write: (tx: Db, plan: TPlan, withFieldIds: WithFieldIds) => Promise<WrittenCounts>;
}

/** What a confirm is asked to do. */
interface ConfirmRequest {
	readonly kind: ContactKind;
	readonly principal: Principal;
	readonly payload: ImportPayload;
	/** The stock version of the preview the user confirms. */
	readonly stockVersion: number;
	readonly now: Date;
	readonly auditAction: ImportAuditAction;
}

/** A confirm that passed its checks: the write of its plan. */
interface ReadyToWrite {
	/** The number of field issues of the rows. */
	readonly warnings: number;
	readonly write: (withFieldIds: WithFieldIds) => Promise<WrittenCounts>;
}

/**
 * Reads the text columns of a contact.
 *
 * @param read The value of one column.
 * @returns The text columns.
 */
function textColumns(read: (field: TextField) => string | null): Record<TextField, string | null> {
	return {
		birthDate: read('birthDate'),
		city: read('city'),
		customerNumber: read('customerNumber'),
		email: read('email'),
		entryDate: read('entryDate'),
		exitDate: read('exitDate'),
		firstName: read('firstName'),
		lastName: read('lastName'),
		memberNumber: read('memberNumber'),
		organization: read('organization'),
		postalCode: read('postalCode'),
		street: read('street'),
	};
}

/**
 * A text value as it is stored: an empty or missing value is NULL, never `''`, so the list sort
 * and the display name agree.
 *
 * @param value The value.
 * @returns The value, or null.
 */
function storedText(value: string | null | undefined): string | null {
	return value === undefined || value === '' ? null : value;
}

/**
 * Narrows a gender value of a row; a missing or unknown one is `unspecified`.
 *
 * @param value The value.
 * @returns The gender.
 */
function toGender(value: string | null | undefined): Gender {
	return GENDERS.find((gender) => gender === value) ?? 'unspecified';
}

/**
 * The values of a stored contact.
 *
 * @param stored The contact.
 * @returns Its values, as copies.
 */
function storedValues(stored: StoredContact): ContactValues {
	return {
		...textColumns((field) => stored[field]),
		customValues: { ...stored.customValues },
		gender: stored.gender,
		groups: [...stored.groups],
		kind: stored.kind,
	};
}

/**
 * The values of a contact a row replaces completely: fields the row does not carry are NULL, the
 * groups empty and the gender `unspecified`.
 *
 * @param kind The contact kind.
 * @param row The row.
 * @returns The values.
 */
function replacedValues(kind: ContactKind, row: ImportedRow): ContactValues {
	const own: readonly ContactField[] = CONTACT_FIELDS[kind];
	return {
		...textColumns((field) => (own.includes(field) ? storedText(row.values[field]) : null)),
		customValues: { ...row.custom },
		gender: toGender(row.values.gender),
		groups: [...(row.groups ?? [])],
		kind,
	};
}

/**
 * The values of a contact after a row is merged in: only values the row carries are written; a
 * NULL (organization rule) clears the field. Empty cells and field issues keep the value.
 *
 * @param base The values before: a stored contact, or the values earlier rows gave it.
 * @param row The row.
 * @returns The values.
 */
function mergedValues(base: ContactValues, row: ImportedRow): ContactValues {
	const { values } = row;
	return {
		...textColumns((field) =>
			values[field] === undefined ? base[field] : storedText(values[field]),
		),
		customValues: { ...base.customValues, ...row.custom },
		gender: values.gender === undefined ? base.gender : toGender(values.gender),
		groups: [...(row.groups ?? base.groups)],
		kind: base.kind,
	};
}

/**
 * Reads a custom value.
 *
 * @param values The custom values.
 * @param key The key.
 * @returns The value, or undefined without one.
 */
function customValue(values: Readonly<Record<string, string>>, key: string): string | undefined {
	return Object.hasOwn(values, key) ? values[key] : undefined;
}

/**
 * Tells whether two lists hold the same values in the same order.
 *
 * @param a One list.
 * @param b The other list.
 * @returns True when they are equal.
 */
function sameList(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * The fields whose values differ, in field order, then the groups, then the custom fields.
 *
 * @param before The values before.
 * @param after The values after.
 * @returns The changed fields.
 */
function diffValues(before: ContactValues, after: ContactValues): ChangedField[] {
	const fields: ChangedField[] = CONTACT_FIELDS[before.kind].filter(
		(field) => before[field] !== after[field],
	);
	if (!sameList(before.groups, after.groups)) fields.push('groups');
	const keys = new Set([...Object.keys(after.customValues), ...Object.keys(before.customValues)]);
	for (const key of keys) {
		if (customValue(before.customValues, key) !== customValue(after.customValues, key)) {
			fields.push(`custom:${key}`);
		}
	}
	return fields;
}

/**
 * The fields of a stored contact a row changes.
 *
 * @param stored The stored contact.
 * @param row The row.
 * @param mode `replace` (members): the row replaces every value; `merge` (partners): only the
 *   values the row carries count.
 * @returns The changed fields; empty when the contact stays as it is.
 */
function changedFields(
	stored: StoredContact,
	row: ImportedRow,
	mode: 'merge' | 'replace',
): ChangedField[] {
	const after = mode === 'replace' ? replacedValues(stored.kind, row) : mergedValues(stored, row);
	return diffValues(storedValues(stored), after);
}

/**
 * Tells whether a changed field is a custom field.
 *
 * @param field The field.
 * @returns True for `custom:…`.
 */
function isCustomChange(field: ChangedField): field is `custom:${string}` {
	return field.startsWith('custom:');
}

/**
 * Tells whether a user may see that a field changed.
 *
 * @param field The field.
 * @param visible The protected and base custom fields of the kind the user sees.
 * @returns True for base fields, groups, new custom fields and visible protected fields.
 */
function isVisibleChange(field: ChangedField, visible: ReadonlySet<FieldKey>): boolean {
	if (field === 'groups') return true;
	// A new custom field follows the area of its kind, in which the importer has `edit`.
	if (isCustomChange(field)) return field.startsWith('custom:new:') || visible.has(field);
	const key = protectedFieldOf(field);
	return key === null || visible.has(key);
}

/**
 * One entry of the change list, filtered by what the user may see.
 *
 * @param change The change.
 * @param visible The protected and base custom fields of the kind the user sees.
 * @returns The entry.
 */
function toImportChange(change: ChangeInput, visible: ReadonlySet<FieldKey>): ImportChange {
	const fields = change.fields ?? [];
	const shown = fields.filter((field) => isVisibleChange(field, visible));
	const { values } = change;
	return {
		exited: change.exited ?? false,
		fields: shown,
		hiddenFields: shown.length < fields.length,
		name: displayName(values),
		number: values.kind === 'member' ? values.memberNumber : values.customerNumber,
		type: change.type,
	};
}

/**
 * The first entries of a list and how many more there are.
 *
 * @param items The list.
 * @param max How many to keep.
 * @returns The kept entries and the count of the rest.
 */
function firstOf<T>(items: readonly T[], max: number): { listed: T[]; more: number } {
	return { listed: items.slice(0, max), more: Math.max(0, items.length - max) };
}

/**
 * Requires a payload of the import's kind and `edit` in the area of the kind.
 *
 * @param db The database or a transaction.
 * @param principal Who imports.
 * @param input The kind of the import and the payload.
 * @returns The user's access to contacts.
 * @throws {ForbiddenError} For a payload of another kind or without the right.
 */
async function authorizeImport(
	db: Db,
	principal: Principal,
	input: Readonly<{ kind: ContactKind; payload: ImportPayload }>,
): Promise<ContactAccess> {
	if (input.payload.kind !== input.kind) throw new ForbiddenError('Forbidden');
	const access = await loadContactAccess(db, principal);
	assertCanManage(access, input.kind);
	return access;
}

/**
 * Checks the rows of a payload against the custom fields of its kind.
 *
 * @param db The database or a transaction.
 * @param payload The payload.
 * @returns The rows, the field issues and the blocking issues.
 */
async function readImportRows(db: Db, payload: ImportPayload): Promise<TransformResult> {
	return transformRows(payload, await listCustomFields(db, payload.kind));
}

/**
 * Splits a list into the batches of one statement each.
 *
 * @param items The list.
 * @returns The batches.
 */
function batches<T>(items: readonly T[]): T[][] {
	const result: T[][] = [];
	for (let start = 0; start < items.length; start += WRITE_BATCH_SIZE) {
		result.push(items.slice(start, start + WRITE_BATCH_SIZE));
	}
	return result;
}

/**
 * The columns of a contact for an insert.
 *
 * @param values The values.
 * @returns The row; arrays and objects are copies.
 */
function contactRow(values: ContactValues): typeof contacts.$inferInsert {
	return {
		...textColumns((field) => values[field]),
		customValues: { ...values.customValues },
		gender: values.gender,
		groups: [...values.groups],
		kind: values.kind,
	};
}

/**
 * The value the insert proposed for a column, in `on conflict do update`.
 *
 * @param columnName The name of the column in the database.
 * @returns `excluded.<column>`.
 */
function excluded(columnName: string): SQL {
	return sql`excluded.${sql.identifier(columnName)}`;
}

/** Every column an import writes, from the proposed row; `updated_at` follows by `$onUpdate`. */
const UPDATE_FROM_EXCLUDED = {
	birthDate: excluded(contacts.birthDate.name),
	city: excluded(contacts.city.name),
	customValues: excluded(contacts.customValues.name),
	customerNumber: excluded(contacts.customerNumber.name),
	email: excluded(contacts.email.name),
	entryDate: excluded(contacts.entryDate.name),
	exitDate: excluded(contacts.exitDate.name),
	firstName: excluded(contacts.firstName.name),
	gender: excluded(contacts.gender.name),
	groups: excluded(contacts.groups.name),
	lastName: excluded(contacts.lastName.name),
	memberNumber: excluded(contacts.memberNumber.name),
	organization: excluded(contacts.organization.name),
	postalCode: excluded(contacts.postalCode.name),
	street: excluded(contacts.street.name),
};

/**
 * Inserts contacts, `WRITE_BATCH_SIZE` per statement.
 *
 * @param tx The transaction.
 * @param rows The values of the new contacts, custom values by field id.
 */
async function insertContacts(tx: Db, rows: readonly ContactValues[]): Promise<void> {
	for (const batch of batches(rows)) {
		// oxlint-disable-next-line no-await-in-loop -- a transaction runs one statement at a time
		await tx.insert(contacts).values(batch.map((values) => contactRow(values)));
	}
}

/**
 * Overwrites the written columns of stored contacts, `WRITE_BATCH_SIZE` per statement. One
 * statement updates rows with different values: an insert that always conflicts on the id. Runs
 * under the lock of the import state, so every id exists; tags, ids and creation times stay.
 *
 * @param tx The transaction.
 * @param rows The id and the new values per contact, custom values by field id.
 */
async function updateContacts(
	tx: Db,
	rows: readonly Readonly<{ id: string; values: ContactValues }>[],
): Promise<void> {
	for (const batch of batches(rows)) {
		// oxlint-disable-next-line no-await-in-loop -- a transaction runs one statement at a time
		await tx
			.insert(contacts)
			.values(batch.map(({ id, values }) => Object.assign(contactRow(values), { id })))
			.onConflictDoUpdate({ set: UPDATE_FROM_EXCLUDED, target: contacts.id });
	}
}

/**
 * Deletes contacts, `WRITE_BATCH_SIZE` per statement. Their suppressions and opt-outs stay: they
 * hang on the contact key, not on the contact.
 *
 * @param tx The transaction.
 * @param ids The contacts.
 */
async function deleteContacts(tx: Db, ids: readonly string[]): Promise<void> {
	for (const batch of batches(ids)) {
		// oxlint-disable-next-line no-await-in-loop -- a transaction runs one statement at a time
		await tx.delete(contacts).where(inArray(contacts.id, batch));
	}
}

/**
 * The key a new custom field has in the rows: `new:<cleaned name>`, as `transformRows` writes it.
 *
 * @param name The name in the mapping.
 * @returns The key.
 */
function newFieldKey(name: string): string {
	return `new:${cleanText(name)}`;
}

/**
 * Creates the new custom fields of a payload: protected, without own areas, so they belong to the
 * area of the kind. Runs after the blocking check, so every name is free and used once.
 *
 * @param tx The transaction.
 * @param payload The payload.
 * @returns The id per row key (`new:<name>`).
 */
async function createCustomFields(tx: Db, payload: ImportPayload): Promise<Map<string, string>> {
	const fields = payload.columns.flatMap(({ target }) =>
		target.type === 'newCustomField'
			? [
					{
						kind: payload.kind,
						name: cleanText(target.name),
						protection: 'protected' as const,
						type: target.valueType,
					},
				]
			: [],
	);
	if (fields.length === 0) return new Map();
	const created = await tx
		.insert(customFields)
		.values(fields)
		.returning({ id: customFields.id, name: customFields.name });
	return new Map(created.map(({ id, name }) => [newFieldKey(name), id]));
}

/**
 * The id of a custom field by its row key.
 *
 * @param key A field id, or `new:<name>`.
 * @param createdIds The ids of the fields the confirm created.
 * @returns The field id.
 * @throws {Error} For a new field that was not created.
 */
function fieldIdOf(key: string, createdIds: ReadonlyMap<string, string>): string {
	if (!key.startsWith('new:')) return key;
	const id = createdIds.get(key);
	if (id === undefined) throw new Error('A new custom field was not created.');
	return id;
}

/**
 * The values with every custom value keyed by field id.
 *
 * @param values The values.
 * @param createdIds The ids of the fields the confirm created.
 * @returns The values; custom values are a new object.
 */
function withCreatedFieldIds(
	values: ContactValues,
	createdIds: ReadonlyMap<string, string>,
): ContactValues {
	const customValues = Object.fromEntries(
		Object.entries(values.customValues).map(([key, value]) => [fieldIdOf(key, createdIds), value]),
	);
	return { ...values, customValues };
}

/**
 * The mapping to save: new custom fields become the fields just created, so the next import
 * suggests them.
 *
 * @param payload The confirmed payload.
 * @param createdIds The ids of the fields the confirm created.
 * @returns The mapping.
 */
function savedMappingOf(
	payload: ImportPayload,
	createdIds: ReadonlyMap<string, string>,
): SavedMapping {
	const saved = toSavedMapping(payload);
	const columns = Object.entries(saved.columns).map(([header, target]): [string, ColumnTarget] => [
		header,
		target.type === 'newCustomField'
			? {
					customFieldId: fieldIdOf(newFieldKey(target.name), createdIds),
					type: 'customField',
				}
			: target,
	]);
	return { ...saved, columns: Object.fromEntries(columns) };
}

/**
 * The checks of a confirm, before anything is written: locks the import state of the kind (two
 * imports exclude each other), refuses when the stock changed since the preview, checks the rows
 * again, refuses blocking issues and what the kind refuses.
 *
 * @param tx The transaction.
 * @param request The import and the stock version of its preview.
 * @param steps The plan, the refusals and the writes of the kind.
 * @returns The write of the plan and the number of warnings, or why nothing may be written.
 */
async function checkConfirm<TPlan>(
	tx: Db,
	request: ConfirmRequest,
	steps: ConfirmSteps<TPlan>,
): Promise<ReadyToWrite | ConfirmFailure> {
	const state = await lockImportState(tx, request.kind);
	if (state.stockVersion !== request.stockVersion) return 'stockChanged';
	const rows = await readImportRows(tx, request.payload);
	if (rows.blocking.length > 0) return 'blocked';
	const plan = await steps.plan(tx, rows);
	return (
		steps.refuse(plan) ?? {
			warnings: rows.fieldIssues.length,
			write: async (withFieldIds) => steps.write(tx, plan, withFieldIds),
		}
	);
}

/**
 * The writes of a confirm: creates the new custom fields, lets the kind write its plan, saves
 * the mapping and the time of the import, and writes the audit entry.
 *
 * @param tx The transaction.
 * @param request The import.
 * @param ready The write of the plan and the number of warnings.
 * @returns The counts.
 */
async function applyConfirm(
	tx: Db,
	request: ConfirmRequest,
	ready: ReadyToWrite,
): Promise<ConfirmImportResult> {
	const createdIds = await createCustomFields(tx, request.payload);
	const { counts, details } = await ready.write((values) =>
		withCreatedFieldIds(values, createdIds),
	);
	const { warnings } = ready;
	await recordConfirmedImport(tx, request.kind, {
		at: request.now,
		mapping: savedMappingOf(request.payload, createdIds),
	});
	await writeAudit(tx, {
		action: request.auditAction,
		actorUserId: request.principal.userId,
		details: { ...details, warnings },
	});
	return { counts: { ...counts, warnings }, ok: true };
}

/**
 * Confirms an import. Checks the right, then in one transaction runs the checks of
 * `checkConfirm` and the writes of `applyConfirm`. A refusal writes nothing.
 *
 * @param db The database.
 * @param request The import and the stock version of its preview.
 * @param steps The plan, the refusals and the writes of the kind.
 * @returns The counts, or why nothing was written.
 * @throws {ForbiddenError} For a payload of another kind or without the right.
 */
async function confirmImport<TPlan>(
	db: Db,
	request: ConfirmRequest,
	steps: ConfirmSteps<TPlan>,
): Promise<ConfirmImportResult> {
	const { kind, payload, principal } = request;
	// Outside the transaction: the access check runs queries in parallel, which a transaction's
	// single connection would have to queue.
	await authorizeImport(db, principal, { kind, payload });
	return db.transaction(async (tx): Promise<ConfirmImportResult> => {
		const ready = await checkConfirm(tx, request, steps);
		if (typeof ready === 'string') return { failure: ready, ok: false };
		return applyConfirm(tx, request, ready);
	});
}

export {
	authorizeImport,
	changedFields,
	confirmImport,
	deleteContacts,
	diffValues,
	firstOf,
	insertContacts,
	isCustomChange,
	isVisibleChange,
	MAX_LISTED_CHANGES,
	MAX_LISTED_ISSUES,
	mergedValues,
	newFieldKey,
	NUMBER_ORDER,
	readImportRows,
	replacedValues,
	storedValues,
	toImportChange,
	updateContacts,
	WRITE_BATCH_SIZE,
};
export type {
	ChangedField,
	ChangeInput,
	ConfirmFailure,
	ConfirmImportResult,
	ConfirmRequest,
	ConfirmSteps,
	ContactValues,
	ImportAuditAction,
	ImportChange,
	StoredContact,
	WithFieldIds,
	WrittenCounts,
};
