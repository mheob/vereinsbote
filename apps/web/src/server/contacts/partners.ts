/* oxlint-disable max-classes-per-file -- the plan's interface defines both errors in this module */
/*
 * Partner upkeep in the app: create, edit and delete partners and their tags. Members are
 * read-only; their source is the export of the member administration.
 */
import { and, eq, ne, sql } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { Db } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { contacts } from '@/server/db/schema';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { assertCanManage, loadContactAccess } from './access';
import type { ContactAccess } from './access';
import { CONTACT_GONE, ContactNotFoundError } from './errors';
import type { ContactGone } from './errors';
import { customFieldKey, protectedFieldOf } from './fields';
import type { Gender } from './fields';
import { bumpStockVersion, lockImportState } from './import-state';
import { checkPartnerInput, normalizeTags } from './partner-form';
import type { PartnerFieldErrors, PartnerInput, PartnerValues } from './partner-form';
import { listCustomFields } from './settings';
import type { CustomFieldRecord } from './settings';
import { auditTarget, copyContactKey, rekeyContactKey } from './suppressions';

/** The form has fields the server refuses; `fields` names them, never their values. */
class PartnerInputInvalidError extends Error {
	public readonly fields: Readonly<PartnerFieldErrors>;

	public constructor(fields: Readonly<PartnerFieldErrors>) {
		super('The partner input is invalid.');
		this.name = 'PartnerInputInvalidError';
		this.fields = fields;
	}
}

/** Another partner has the customer number. The message does not name it. */
class CustomerNumberTakenError extends Error {
	public constructor() {
		super('Another partner has this customer number.');
		this.name = 'CustomerNumberTakenError';
	}
}

/** The protected built-in fields the form can carry, in form order. */
const PROTECTED_INPUT_FIELDS = ['birthDate', 'street', 'postalCode', 'city'] as const;

/** A protected built-in field of the partner form. */
type PartnerProtectedField = (typeof PROTECTED_INPUT_FIELDS)[number];

/** The result of saving the partner form; refused fields come back with their reason. */
type PartnerSaveResult =
	| Readonly<{ ok: true; contactId: string }>
	| Readonly<{ ok: false; fields: PartnerFieldErrors }>
	| ContactGone;

/** What the partner form shows; only fields and values the user sees. */
interface PartnerForm {
	/** The stored partner as the form shows it, empty values as `''`; null for a new partner. */
	readonly values: PartnerInput | null;
	/** The tags of the partners, for suggestions. */
	readonly tagSuggestions: readonly string[];
	/** The protected built-in fields the user sees, in form order. */
	readonly protectedFields: readonly PartnerProtectedField[];
	/** The custom fields of the partners the user sees, oldest first. */
	readonly customFields: readonly Readonly<CustomFieldRecord>[];
}

/** The columns partner upkeep writes. */
interface PartnerColumns {
	readonly customerNumber: string | null;
	readonly organization: string | null;
	readonly firstName: string | null;
	readonly lastName: string | null;
	readonly email: string | null;
	readonly gender: Gender;
	readonly birthDate: string | null;
	readonly street: string | null;
	readonly postalCode: string | null;
	readonly city: string | null;
	readonly tags: readonly string[];
	readonly customValues: Readonly<Record<string, string>>;
}

/** The columns with one value each, in form order; the audit names them when they change. */
const VALUE_COLUMNS = [
	'customerNumber',
	'organization',
	'firstName',
	'lastName',
	'email',
	'gender',
	'birthDate',
	'street',
	'postalCode',
	'city',
] as const satisfies readonly (keyof PartnerColumns)[];

/** A stored partner. */
interface StoredPartner {
	readonly id: string;
	/** The key of its suppression and opt-outs. */
	readonly key: string;
	readonly columns: PartnerColumns;
}

/**
 * Refuses protected and custom fields the user may not see. A field the form does not carry
 * stays as it is, so the form leaves such fields out.
 *
 * @param access The user's access.
 * @param input The form.
 * @throws {ForbiddenError} For a protected field or a custom field the user does not see,
 *   including custom fields of members and unknown ones.
 */
function assertMayWrite(access: ContactAccess, input: Readonly<PartnerInput>): void {
	const visible = access.visible.partner;
	const hiddenField = PROTECTED_INPUT_FIELDS.some((field) => {
		const key = protectedFieldOf(field);
		return input[field] !== undefined && key !== null && !visible.has(key);
	});
	const hiddenCustom = Object.keys(input.custom ?? {}).some(
		(id) => !visible.has(customFieldKey(id)),
	);
	if (hiddenField || hiddenCustom) throw new ForbiddenError('Forbidden');
}

/**
 * Checks the right and the form. Runs before the transaction: the access check runs queries in
 * parallel, which the single connection of a transaction would have to queue.
 *
 * @param db The database.
 * @param principal Who acts.
 * @param input The form.
 * @returns The values to store.
 * @throws {ForbiddenError} Without `edit` in the partners area or for a field the user does not see.
 * @throws {PartnerInputInvalidError} For refused fields.
 */
async function authorizedValues(
	db: Db,
	principal: Principal,
	input: Readonly<PartnerInput>,
): Promise<PartnerValues> {
	const access = await loadContactAccess(db, principal);
	assertCanManage(access, 'partner');
	assertMayWrite(access, input);
	const checked = checkPartnerInput(input, await listCustomFields(db, 'partner'));
	if (!checked.ok) throw new PartnerInputInvalidError(checked.errors);
	return checked.values;
}

/**
 * The tags of the partners, one per tag ignoring case, spelled as the oldest partner carrying
 * it spells it (a tie by byte order).
 *
 * @param db The database or a transaction.
 * @param exceptContactId A partner whose tags do not count, or null.
 * @returns The tags, by name.
 */
async function tagSpellings(db: Db, exceptContactId: string | null): Promise<string[]> {
	const all = db
		.select({
			createdAt: contacts.createdAt,
			value: sql<string>`unnest(${contacts.tags})`.as('value'),
		})
		.from(contacts)
		.where(
			and(
				eq(contacts.kind, 'partner'),
				exceptContactId === null ? undefined : ne(contacts.id, exceptContactId),
			),
		)
		.as('all_tags');
	const rows = await db
		.selectDistinctOn([sql`lower(${all.value})`], { value: all.value })
		.from(all)
		.orderBy(sql`lower(${all.value})`, all.createdAt, sql`${all.value} collate "C"`);
	return rows.map((row) => row.value);
}

/**
 * Lists the tags of the partners for suggestions and the filter: each tag once ignoring case,
 * spelled as the oldest partner carrying it spells it. Members have no tags.
 *
 * @param db The database.
 * @returns The tags, by name.
 */
async function listTags(db: Db): Promise<string[]> {
	return tagSpellings(db, null);
}

/**
 * The columns after an edit: a protected field the form does not carry keeps its value, custom
 * values are merged (null removes one), tags take the spelling of existing ones.
 *
 * @param values The checked form.
 * @param stored The stored columns, or null for a new partner.
 * @param existingTags The tags of the other partners, in the spelling that counts.
 * @returns The columns.
 */
function columnsOf(
	values: PartnerValues,
	stored: PartnerColumns | null,
	existingTags: readonly string[],
): PartnerColumns {
	const kept = (field: (typeof PROTECTED_INPUT_FIELDS)[number]): string | null => {
		const value = values[field];
		return value === undefined ? (stored?.[field] ?? null) : value;
	};
	const customValues = new Map(Object.entries(stored?.customValues ?? {}));
	for (const [id, value] of Object.entries(values.custom)) {
		if (value === null) customValues.delete(id);
		else customValues.set(id, value);
	}
	return {
		birthDate: kept('birthDate'),
		city: kept('city'),
		customValues: Object.fromEntries(customValues),
		customerNumber: values.customerNumber,
		email: values.email,
		firstName: values.firstName,
		gender: values.gender,
		lastName: values.lastName,
		organization: values.organization,
		postalCode: kept('postalCode'),
		street: kept('street'),
		tags: normalizeTags(values.tags, existingTags),
	};
}

/**
 * Reads a custom value.
 *
 * @param values The custom values.
 * @param id The custom field.
 * @returns The value, or undefined without one.
 */
function ownValue(values: Readonly<Record<string, string>>, id: string): string | undefined {
	return Object.hasOwn(values, id) ? values[id] : undefined;
}

/**
 * The columns an edit changes: values in form order, then the tags, then the custom fields
 * (`custom:<id>`, sorted). Names only, never values.
 *
 * @param before The stored columns.
 * @param after The columns after the edit.
 * @returns The changed columns; empty when the partner stays as it is.
 */
function changedColumns(before: PartnerColumns, after: PartnerColumns): string[] {
	const changed: string[] = VALUE_COLUMNS.filter((column) => before[column] !== after[column]);
	const sameTags =
		before.tags.length === after.tags.length &&
		before.tags.every((tag, index) => tag === after.tags[index]);
	if (!sameTags) changed.push('tags');
	const ids = new Set([...Object.keys(before.customValues), ...Object.keys(after.customValues)]);
	const custom = [...ids]
		.filter((id) => ownValue(before.customValues, id) !== ownValue(after.customValues, id))
		.map((id) => `custom:${id}`)
		.toSorted();
	return [...changed, ...custom];
}

/**
 * The row to write; arrays and objects are copies.
 *
 * @param columns The columns.
 * @returns The row of a partner.
 */
function partnerRow(columns: PartnerColumns): typeof contacts.$inferInsert {
	return {
		...columns,
		customValues: { ...columns.customValues },
		kind: 'partner',
		tags: [...columns.tags],
	};
}

/**
 * How the audit log names a partner: by customer number, else by id.
 *
 * @param id The partner.
 * @param columns Its columns.
 * @returns The target.
 */
function partnerTarget(id: string, columns: PartnerColumns): string {
	return auditTarget({
		customerNumber: columns.customerNumber,
		id,
		kind: 'partner',
		memberNumber: null,
	});
}

/**
 * Loads a partner.
 *
 * @param tx The transaction, which holds the import state of the partners.
 * @param contactId The contact.
 * @returns The partner.
 * @throws {ForbiddenError} For a member: members are read-only.
 * @throws {ContactNotFoundError} For an unknown contact.
 */
async function loadPartner(tx: Db, contactId: string): Promise<StoredPartner> {
	const [row] = await tx
		.select({
			birthDate: contacts.birthDate,
			city: contacts.city,
			contactKey: contacts.contactKey,
			customValues: contacts.customValues,
			customerNumber: contacts.customerNumber,
			email: contacts.email,
			firstName: contacts.firstName,
			gender: contacts.gender,
			id: contacts.id,
			kind: contacts.kind,
			lastName: contacts.lastName,
			organization: contacts.organization,
			postalCode: contacts.postalCode,
			street: contacts.street,
			tags: contacts.tags,
		})
		.from(contacts)
		.where(eq(contacts.id, contactId));
	if (row === undefined) throw new ContactNotFoundError();
	const { contactKey: key, id, kind, ...columns } = row;
	if (kind !== 'partner') throw new ForbiddenError('Forbidden');
	return { columns, id, key };
}

/**
 * Lets the suppression and the opt-outs follow a partner whose key changed. When another partner
 * still has the old key (the same address), it keeps them and the partner gets copies.
 *
 * @param tx The transaction; the partner already has its new key.
 * @param from The old key.
 * @param to The new key.
 */
async function followKey(tx: Db, from: string, to: string): Promise<void> {
	const [other] = await tx
		.select({ id: contacts.id })
		.from(contacts)
		.where(and(eq(contacts.kind, 'partner'), eq(contacts.contactKey, from)))
		.limit(1);
	await (other === undefined
		? rekeyContactKey(tx, 'partner', from, to)
		: copyContactKey(tx, 'partner', from, to));
}

/**
 * Runs a write that may hit the unique index on the customer number.
 *
 * @param write The write.
 * @returns The result of the write.
 * @throws {CustomerNumberTakenError} When another partner has the customer number.
 */
async function withUniqueCustomerNumber<T>(write: () => Promise<T>): Promise<T> {
	try {
		return await write();
	} catch (error) {
		if (isUniqueViolation(error)) throw new CustomerNumberTakenError();
		throw error;
	}
}

/**
 * Creates a partner. Tags take the spelling of existing ones.
 *
 * @param db The database.
 * @param principal Who acts; needs `edit` in the partners area.
 * @param input The form.
 * @returns The id of the new partner.
 * @throws {ForbiddenError} Without the right or for a field the user does not see.
 * @throws {PartnerInputInvalidError} For refused fields.
 * @throws {CustomerNumberTakenError} When another partner has the customer number.
 */
async function createPartner(
	db: Db,
	principal: Principal,
	input: Readonly<PartnerInput>,
): Promise<{ contactId: string }> {
	const values = await authorizedValues(db, principal, input);
	return withUniqueCustomerNumber(async () =>
		db.transaction(async (tx) => {
			// First the lock: a running partner import holds it, so upkeep waits for it.
			await lockImportState(tx, 'partner');
			const columns = columnsOf(values, null, await tagSpellings(tx, null));
			const [row] = await tx
				.insert(contacts)
				.values(partnerRow(columns))
				.returning({ id: contacts.id });
			if (row === undefined) throw new Error('Inserting the partner returned no row.');
			await bumpStockVersion(tx, 'partner');
			await writeAudit(tx, {
				action: 'partner.created',
				actorUserId: principal.userId,
				target: partnerTarget(row.id, columns),
			});
			return { contactId: row.id };
		}),
	);
}

/**
 * Edits a partner. Protected and custom fields the form does not carry stay as they are; when
 * the key changes (customer number, else address), the suppression and the opt-outs follow. An
 * edit that changes nothing writes nothing.
 *
 * @param db The database.
 * @param principal Who acts; needs `edit` in the partners area.
 * @param contactId The partner.
 * @param input The form.
 * @throws {ForbiddenError} Without the right, for a field the user does not see, or for a member.
 * @throws {PartnerInputInvalidError} For refused fields.
 * @throws {CustomerNumberTakenError} When another partner has the customer number.
 * @throws {ContactNotFoundError} For an unknown contact.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function updatePartner(
	db: Db,
	principal: Principal,
	contactId: string,
	input: Readonly<PartnerInput>,
): Promise<void> {
	const values = await authorizedValues(db, principal, input);
	await withUniqueCustomerNumber(async () =>
		db.transaction(async (tx) => {
			await lockImportState(tx, 'partner');
			const stored = await loadPartner(tx, contactId);
			// The partner's own tags do not count: it may change their spelling.
			const columns = columnsOf(values, stored.columns, await tagSpellings(tx, contactId));
			const fields = changedColumns(stored.columns, columns);
			if (fields.length === 0) return;
			const [updated] = await tx
				.update(contacts)
				.set(partnerRow(columns))
				.where(eq(contacts.id, contactId))
				.returning({ key: contacts.contactKey });
			if (updated === undefined) throw new Error('Updating the partner returned no row.');
			if (updated.key !== stored.key) await followKey(tx, stored.key, updated.key);
			await bumpStockVersion(tx, 'partner');
			await writeAudit(tx, {
				action: 'partner.updated',
				actorUserId: principal.userId,
				details: { fields },
				target: partnerTarget(contactId, columns),
			});
		}),
	);
}

/**
 * Deletes a partner. Its suppression and opt-outs stay: they hang on its key and apply again
 * when a partner with the key comes back.
 *
 * @param db The database.
 * @param principal Who acts; needs `edit` in the partners area.
 * @param contactId The partner.
 * @throws {ForbiddenError} Without the right or for a member.
 * @throws {ContactNotFoundError} For an unknown contact.
 */
async function deletePartner(db: Db, principal: Principal, contactId: string): Promise<void> {
	const access = await loadContactAccess(db, principal);
	assertCanManage(access, 'partner');
	await db.transaction(async (tx) => {
		await lockImportState(tx, 'partner');
		const stored = await loadPartner(tx, contactId);
		await tx.delete(contacts).where(eq(contacts.id, contactId));
		await bumpStockVersion(tx, 'partner');
		await writeAudit(tx, {
			action: 'partner.deleted',
			actorUserId: principal.userId,
			target: partnerTarget(contactId, stored.columns),
		});
	});
}

/**
 * Saves the partner form: creates a partner, or edits the one `contactId` names. Refused fields,
 * a customer number another partner has (`taken`) and an unknown partner are results, so the
 * page can show them.
 *
 * @param db The database.
 * @param principal Who acts; needs `edit` in the partners area.
 * @param request The form and, to edit a partner, its id.
 * @returns The partner's id, or the refusal.
 * @throws {ForbiddenError} Without the right, for a field the user does not see, or for a member.
 */
async function savePartner(
	db: Db,
	principal: Principal,
	request: Readonly<PartnerInput & { contactId?: string }>,
): Promise<PartnerSaveResult> {
	const { contactId, ...input } = request;
	try {
		if (contactId === undefined)
			return { ...(await createPartner(db, principal, input)), ok: true };
		await updatePartner(db, principal, contactId, input);
		return { contactId, ok: true };
	} catch (error) {
		if (error instanceof PartnerInputInvalidError) return { fields: error.fields, ok: false };
		if (error instanceof CustomerNumberTakenError) {
			return { fields: { customerNumber: 'taken' }, ok: false };
		}
		if (error instanceof ContactNotFoundError) return CONTACT_GONE;
		throw error;
	}
}

/**
 * The stored values of a partner as the form shows them: `''` for an empty value, only the
 * protected and custom fields the user sees.
 *
 * @param tx The database.
 * @param contactId The partner.
 * @param fields The protected and custom fields the user sees.
 * @returns The values.
 * @throws {ContactNotFoundError} For an unknown contact.
 * @throws {ForbiddenError} For a member: members are read-only.
 */
async function storedPartnerInput(
	tx: Db,
	contactId: string,
	fields: Readonly<Pick<PartnerForm, 'customFields' | 'protectedFields'>>,
): Promise<PartnerInput> {
	const { columns } = await loadPartner(tx, contactId);
	const custom = Object.fromEntries(
		fields.customFields.map((field) => [field.id, ownValue(columns.customValues, field.id) ?? '']),
	);
	const shown: Partial<Record<PartnerProtectedField, string>> = {};
	for (const field of fields.protectedFields) shown[field] = columns[field] ?? '';
	return {
		...shown,
		custom,
		customerNumber: columns.customerNumber ?? '',
		email: columns.email ?? '',
		firstName: columns.firstName ?? '',
		gender: columns.gender,
		lastName: columns.lastName ?? '',
		organization: columns.organization ?? '',
		tags: [...columns.tags],
	};
}

/**
 * What the partner form needs: the fields the user sees, the tag suggestions and, to edit a
 * partner, its values. Values of fields the user does not see never leave the server.
 *
 * @param db The database.
 * @param principal Who asks; needs `edit` in the partners area.
 * @param contactId The partner to edit, or null for a new one.
 * @returns The form.
 * @throws {ForbiddenError} Without the right, or for a member: members are read-only.
 * @throws {ContactNotFoundError} For an unknown contact.
 */
async function getPartnerForm(
	db: Db,
	principal: Principal,
	contactId: string | null,
): Promise<PartnerForm> {
	const access = await loadContactAccess(db, principal);
	assertCanManage(access, 'partner');
	const visible = access.visible.partner;
	const protectedFields = PROTECTED_INPUT_FIELDS.filter((field) => {
		const key = protectedFieldOf(field);
		return key !== null && visible.has(key);
	});
	const allCustomFields = await listCustomFields(db, 'partner');
	const customFields = allCustomFields.filter((field) => visible.has(customFieldKey(field.id)));
	const fields = { customFields, protectedFields };
	return {
		...fields,
		tagSuggestions: await listTags(db),
		values: contactId === null ? null : await storedPartnerInput(db, contactId, fields),
	};
}

export {
	createPartner,
	CustomerNumberTakenError,
	deletePartner,
	getPartnerForm,
	listTags,
	PartnerInputInvalidError,
	savePartner,
	updatePartner,
};
export type { PartnerForm, PartnerProtectedField, PartnerSaveResult };
