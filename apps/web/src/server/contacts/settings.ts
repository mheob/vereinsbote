/* oxlint-disable max-classes-per-file -- the plan's interface defines both errors in this module */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { writeAudit } from '@/server/audit/audit';
import type { Db } from '@/server/db/client';
import { areas, contactSettings, customFields, protectedFieldAreas } from '@/server/db/schema';
import { assertAdmin } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { NotProtectedFieldError, UnknownAreaError, UnknownCustomFieldError } from './errors';
import { BUILTIN_PROTECTED_FIELDS, customFieldKey } from './fields';
import type { ContactKind, CustomFieldType, FieldKey, Protection } from './fields';
import {
	DEFAULT_STALE_IMPORT_WEEKS,
	isValidStaleImportWeeks,
	MAX_STALE_IMPORT_WEEKS,
} from './stale-weeks';

/** The areas of the two kinds and the age after which the last import counts as old. */
interface ContactSettings {
	membersAreaId: string | null;
	partnersAreaId: string | null;
	staleImportWeeks: number;
}

/** A custom field of one kind. */
interface CustomFieldRecord {
	id: string;
	kind: ContactKind;
	name: string;
	type: CustomFieldType;
	protection: Protection;
}

/** `setFieldAreas` got no area: a protected field must stay visible to somebody. */
class FieldAreasEmptyError extends Error {
	public constructor() {
		super('A protected field needs at least one area.');
		this.name = 'FieldAreasEmptyError';
	}
}

/** The weeks are not a whole number from 1 to `MAX_STALE_IMPORT_WEEKS`. */
class StaleImportWeeksInvalidError extends Error {
	public constructor() {
		super(`The weeks are a whole number from 1 to ${MAX_STALE_IMPORT_WEEKS}.`);
		this.name = 'StaleImportWeeksInvalidError';
	}
}

/**
 * Reads the settings.
 *
 * @param db The database.
 * @returns The settings; without a row no areas are set and the weeks are the default.
 */
async function getContactSettings(db: Db): Promise<ContactSettings> {
	const [row] = await db.select().from(contactSettings);
	return {
		membersAreaId: row?.membersAreaId ?? null,
		partnersAreaId: row?.partnersAreaId ?? null,
		staleImportWeeks: row?.staleImportWeeks ?? DEFAULT_STALE_IMPORT_WEEKS,
	};
}

/**
 * The area that belongs to a kind.
 *
 * @param settings The settings.
 * @param kind The kind.
 * @returns The area id, or null while it is not set.
 */
function kindAreaId(settings: Readonly<ContactSettings>, kind: ContactKind): string | null {
	return kind === 'member' ? settings.membersAreaId : settings.partnersAreaId;
}

/**
 * Stores the members and partners area, without a permission check: the setup uses it. The
 * weeks stay as they are.
 *
 * @param db The database or a transaction.
 * @param ids The two areas.
 */
async function saveContactAreas(
	db: Db,
	ids: Readonly<{ membersAreaId: string; partnersAreaId: string }>,
): Promise<void> {
	await db
		.insert(contactSettings)
		.values({ membersAreaId: ids.membersAreaId, partnersAreaId: ids.partnersAreaId })
		.onConflictDoUpdate({
			set: { membersAreaId: ids.membersAreaId, partnersAreaId: ids.partnersAreaId },
			target: contactSettings.id,
		});
}

/**
 * Lists the custom fields of a kind, oldest first.
 *
 * @param db The database.
 * @param kind The kind.
 * @returns The custom fields.
 */
async function listCustomFields(db: Db, kind: ContactKind): Promise<CustomFieldRecord[]> {
	// Fields created in one transaction share `now()`; the name keeps their order stable.
	return db
		.select({
			id: customFields.id,
			kind: customFields.kind,
			name: customFields.name,
			protection: customFields.protection,
			type: customFields.type,
		})
		.from(customFields)
		.where(eq(customFields.kind, kind))
		.orderBy(customFields.createdAt, sql`lower(${customFields.name})`, customFields.id);
}

/**
 * Which areas see each protected field of a kind: the field's own areas, else the area of the
 * kind. Custom fields with the protection `base` are not in the result.
 *
 * @param db The database.
 * @param kind The kind.
 * @returns The effective area ids per protected field, sorted by area name.
 */
async function getFieldAreas(
	db: Db,
	kind: ContactKind,
): Promise<ReadonlyMap<FieldKey, readonly string[]>> {
	const [settings, custom, overrides] = await Promise.all([
		getContactSettings(db),
		listCustomFields(db, kind),
		db
			.select({ areaId: protectedFieldAreas.areaId, fieldKey: protectedFieldAreas.fieldKey })
			.from(protectedFieldAreas)
			.innerJoin(areas, eq(areas.id, protectedFieldAreas.areaId))
			.where(eq(protectedFieldAreas.kind, kind))
			.orderBy(sql`lower(${areas.name})`, areas.name),
	]);
	const kindArea = kindAreaId(settings, kind);
	const fallback = kindArea === null ? [] : [kindArea];
	const keys: FieldKey[] = [
		...BUILTIN_PROTECTED_FIELDS[kind],
		...custom
			.filter((field) => field.protection === 'protected')
			.map((field) => customFieldKey(field.id)),
	];
	const result = new Map<FieldKey, readonly string[]>();
	for (const key of keys) {
		const own = overrides.filter((row) => row.fieldKey === key).map((row) => row.areaId);
		result.set(key, own.length === 0 ? fallback : own);
	}
	return result;
}

/**
 * Makes sure that areas exist and keeps them until the transaction ends, as a foreign key does
 * (`FOR KEY SHARE`, so a rename does not wait): a deletion in another tab waits, and one that came
 * first is a refusal instead of a foreign key error.
 *
 * @param tx The transaction.
 * @param areaIds The areas.
 * @throws {UnknownAreaError} When one of them does not exist.
 */
async function assertAreasExist(tx: Db, areaIds: readonly string[]): Promise<void> {
	const wanted = [...new Set(areaIds)];
	const found = await tx
		.select({ id: areas.id })
		.from(areas)
		.where(inArray(areas.id, wanted))
		.for('key share');
	if (found.length !== wanted.length) throw new UnknownAreaError();
}

/**
 * Changes the members and partners area. Fields without an own assignment follow.
 *
 * @param db The database.
 * @param actor Who changes it; must be an admin.
 * @param ids The two areas.
 * @throws {ForbiddenError} When the actor is no admin.
 * @throws {UnknownAreaError} When an area does not exist (any more).
 */
async function setContactAreas(
	db: Db,
	actor: Principal,
	ids: Readonly<{ membersAreaId: string; partnersAreaId: string }>,
): Promise<void> {
	assertAdmin(actor);
	await db.transaction(async (tx) => {
		await assertAreasExist(tx, [ids.membersAreaId, ids.partnersAreaId]);
		await saveContactAreas(tx, ids);
		await writeAudit(tx, {
			action: 'contacts.settings_changed',
			actorUserId: actor.userId,
			details: { membersAreaId: ids.membersAreaId, partnersAreaId: ids.partnersAreaId },
		});
	});
}

/**
 * Tells whether a field key is a protected field of the kind: a built-in one or a custom field
 * of the kind with the protection `protected`.
 *
 * @param db The database or a transaction.
 * @param kind The kind.
 * @param fieldKey The key.
 * @returns True when the field is protected for the kind.
 */
async function isProtectedField(db: Db, kind: ContactKind, fieldKey: FieldKey): Promise<boolean> {
	if (!fieldKey.startsWith('custom:')) {
		const builtin: readonly FieldKey[] = BUILTIN_PROTECTED_FIELDS[kind];
		return builtin.includes(fieldKey);
	}
	const customFieldId = fieldKey.slice('custom:'.length);
	const found = await listCustomFields(db, kind);
	return found.some((field) => field.id === customFieldId && field.protection === 'protected');
}

/**
 * The rows of `protected_field_areas` that belong to one field of one kind.
 *
 * @param kind The kind.
 * @param fieldKey The field.
 * @returns The condition.
 */
function ownAreasOf(kind: ContactKind, fieldKey: FieldKey): SQL | undefined {
	return and(eq(protectedFieldAreas.kind, kind), eq(protectedFieldAreas.fieldKey, fieldKey));
}

/**
 * Sets the areas that see one protected field of one kind; it replaces the field's earlier
 * assignment.
 *
 * @param db The database.
 * @param actor Who changes it; must be an admin.
 * @param input The kind, the field and its areas.
 * @throws {ForbiddenError} When the actor is no admin.
 * @throws {FieldAreasEmptyError} When no area is given.
 * @throws {NotProtectedFieldError} When the field is no protected field of the kind (any more).
 * @throws {UnknownAreaError} When an area does not exist (any more).
 */
async function setFieldAreas(
	db: Db,
	actor: Principal,
	input: Readonly<{ kind: ContactKind; fieldKey: FieldKey; areaIds: readonly string[] }>,
): Promise<void> {
	assertAdmin(actor);
	const areaIds = [...new Set(input.areaIds)];
	if (areaIds.length === 0) throw new FieldAreasEmptyError();
	await db.transaction(async (tx) => {
		if (!(await isProtectedField(tx, input.kind, input.fieldKey))) {
			throw new NotProtectedFieldError();
		}
		await assertAreasExist(tx, areaIds);
		await tx.delete(protectedFieldAreas).where(ownAreasOf(input.kind, input.fieldKey));
		await tx
			.insert(protectedFieldAreas)
			.values(areaIds.map((areaId) => ({ areaId, fieldKey: input.fieldKey, kind: input.kind })));
		await writeAudit(tx, {
			action: 'contacts.settings_changed',
			actorUserId: actor.userId,
			details: { areaIds, fieldKey: input.fieldKey, kind: input.kind },
		});
	});
}

/**
 * Switches a custom field between `base` (every user who sees contacts sees it) and
 * `protected` (it follows the field protection). Going to `base` drops the field's own area
 * assignment, so a later `protected` starts from the area of the kind again.
 *
 * @param db The database.
 * @param actor Who changes it; must be an admin.
 * @param input The custom field and the protection.
 * @throws {ForbiddenError} When the actor is no admin.
 * @throws {UnknownCustomFieldError} When the custom field does not exist.
 */
async function setCustomFieldProtection(
	db: Db,
	actor: Principal,
	input: Readonly<{ customFieldId: string; protection: Protection }>,
): Promise<void> {
	assertAdmin(actor);
	await db.transaction(async (tx) => {
		const [updated] = await tx
			.update(customFields)
			.set({ protection: input.protection })
			.where(eq(customFields.id, input.customFieldId))
			.returning({ kind: customFields.kind });
		if (updated === undefined) throw new UnknownCustomFieldError();
		if (input.protection === 'base') {
			await tx
				.delete(protectedFieldAreas)
				.where(ownAreasOf(updated.kind, customFieldKey(input.customFieldId)));
		}
		await writeAudit(tx, {
			action: 'contacts.settings_changed',
			actorUserId: actor.userId,
			details: { customFieldId: input.customFieldId, protection: input.protection },
		});
	});
}

/**
 * Sets after how many weeks without an import the data counts as old.
 *
 * @param db The database.
 * @param actor Who changes it; must be an admin.
 * @param weeks A whole number from 1 to 52.
 * @throws {ForbiddenError} When the actor is no admin.
 * @throws {StaleImportWeeksInvalidError} When the weeks are out of range or not whole.
 */
async function setStaleImportWeeks(db: Db, actor: Principal, weeks: number): Promise<void> {
	assertAdmin(actor);
	if (!isValidStaleImportWeeks(weeks)) throw new StaleImportWeeksInvalidError();
	await db.transaction(async (tx) => {
		await tx
			.insert(contactSettings)
			.values({ staleImportWeeks: weeks })
			.onConflictDoUpdate({ set: { staleImportWeeks: weeks }, target: contactSettings.id });
		await writeAudit(tx, {
			action: 'contacts.settings_changed',
			actorUserId: actor.userId,
			details: { staleImportWeeks: weeks },
		});
	});
}

export {
	FieldAreasEmptyError,
	getContactSettings,
	getFieldAreas,
	kindAreaId,
	listCustomFields,
	saveContactAreas,
	setContactAreas,
	setCustomFieldProtection,
	setFieldAreas,
	setStaleImportWeeks,
	StaleImportWeeksInvalidError,
};
export type { ContactSettings, CustomFieldRecord };
