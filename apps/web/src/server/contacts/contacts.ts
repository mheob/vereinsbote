import { and, count, eq, sql } from 'drizzle-orm';

import type { Db } from '@/server/db/client';
import { areas, contactOptOuts, contacts, contactSuppressions } from '@/server/db/schema';
import type { ContactRecord } from '@/server/db/schema';
import { ForbiddenError } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

import { assertCanList, loadContactAccess } from './access';
import { todayInClubZone } from './calendar';
import { displayName } from './display-name';
import type { DisplayName } from './display-name';
import { customFieldKey, protectedFieldOf } from './fields';
import type { ContactKind, CustomFieldType, FieldKey, Gender } from './fields';
import { filterConditions, searchCondition, suppressionOfContact } from './filters';
import type { ContactFilters } from './filters';
import { CONTACTS_PAGE_SIZE } from './list-query';
import { listTags } from './partners';
import { listCustomFields } from './settings';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

/** One page of a kind; `page` counts from 1. */
interface ContactListQuery {
	readonly kind: ContactKind;
	readonly page: number;
	readonly query: string;
	readonly filters: ContactFilters;
}

/** A contact in the list: base fields only. */
interface ContactListItem {
	readonly id: string;
	/** The member number of a member, the customer number of a partner. */
	readonly number: string | null;
	readonly name: DisplayName;
	readonly email: string | null;
	readonly groups: readonly string[];
	readonly tags: readonly string[];
	readonly suppressed: boolean;
}

interface ContactListPage {
	readonly items: readonly ContactListItem[];
	readonly total: number;
	readonly page: number;
	/** All groups of the kind, for the filter. */
	readonly groups: readonly string[];
	/** The tags of the partners, one per tag ignoring case, for the filter; members have none. */
	readonly tags: readonly string[];
	/** Whether the user may filter by exit, i.e. sees the members' exit date. */
	readonly canFilterExit: boolean;
}

/** The columns of the protected built-in fields. */
type ProtectedValueField =
	| 'birthDate'
	| 'city'
	| 'entryDate'
	| 'exitDate'
	| 'postalCode'
	| 'street';

const PROTECTED_VALUE_FIELDS = [
	'birthDate',
	'entryDate',
	'exitDate',
	'street',
	'postalCode',
	'city',
] as const satisfies readonly ProtectedValueField[];

/** A contact as one user may see it. */
interface ContactDetail {
	readonly id: string;
	readonly kind: ContactKind;
	readonly memberNumber: string | null;
	readonly customerNumber: string | null;
	readonly organization: string | null;
	readonly firstName: string | null;
	readonly lastName: string | null;
	readonly email: string | null;
	readonly gender: Gender;
	readonly groups: readonly string[];
	readonly tags: readonly string[];
	readonly name: DisplayName;
	/** Only the visible fields that have a value. */
	readonly protectedValues: Readonly<Partial<Record<ProtectedValueField, string>>>;
	/** Only the visible custom fields that have a value, oldest field first. */
	readonly customValues: readonly Readonly<{
		id: string;
		name: string;
		type: CustomFieldType;
		value: string;
	}>[];
	readonly suppression: Readonly<{ at: string }> | null;
	/** The opt-outs per area, by area name. */
	readonly optOuts: readonly Readonly<{ areaId: string; areaName: string; at: string }>[];
	readonly canManage: boolean;
	/** All areas by name, for setting opt-outs; empty without `canManage`. */
	readonly areas: readonly Readonly<{ id: string; name: string }>[];
}

/**
 * All groups of a kind, by name.
 *
 * @param db The database.
 * @param kind The kind.
 * @returns The groups.
 */
async function listGroups(db: Db, kind: ContactKind): Promise<string[]> {
	const all = db
		.selectDistinct({ value: sql<string>`unnest(${contacts.groups})`.as('value') })
		.from(contacts)
		.where(eq(contacts.kind, kind))
		.as('all_groups');
	const rows = await db
		.select({ value: all.value })
		.from(all)
		.orderBy(sql`lower(${all.value})`, all.value);
	return rows.map((row) => row.value);
}

/**
 * Lists one page of contacts of a kind with search and filters. Only base fields are listed;
 * the exit filter needs the right to see the exit date.
 *
 * @param db The database.
 * @param principal Who asks.
 * @param query The kind, page, search and filters.
 * @param now The instant; the exit filter compares with today in the club's time zone.
 * @returns The page.
 * @throws {ForbiddenError} Without `read` in any area, or with `exit` without seeing the exit date.
 * @throws {Error} When the page is not a whole number from 1.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function listContacts(
	db: Db,
	principal: Principal,
	query: Readonly<ContactListQuery>,
	now: Date,
): Promise<ContactListPage> {
	const access = await loadContactAccess(db, principal);
	assertCanList(access);
	const canFilterExit = query.kind === 'member' && access.visible.member.has('exitDate');
	if (query.filters.exit !== undefined && !canFilterExit) throw new ForbiddenError('Forbidden');
	if (!Number.isInteger(query.page) || query.page < 1) {
		throw new Error('The page is a whole number from 1.');
	}
	const where = and(
		eq(contacts.kind, query.kind),
		searchCondition(query.query),
		...filterConditions(query.filters, todayInClubZone(now)),
	);
	const [counted] = await db.select({ total: count() }).from(contacts).where(where);
	const rows = await db
		.select({
			customerNumber: contacts.customerNumber,
			email: contacts.email,
			firstName: contacts.firstName,
			groups: contacts.groups,
			id: contacts.id,
			lastName: contacts.lastName,
			memberNumber: contacts.memberNumber,
			organization: contacts.organization,
			suppressed: sql<boolean>`${contactSuppressions.contactKey} is not null`,
			tags: contacts.tags,
		})
		.from(contacts)
		// At most one row: kind and `contact_key` are the key of the suppressions.
		.leftJoin(contactSuppressions, suppressionOfContact)
		.where(where)
		.orderBy(
			sql`lower(coalesce(${contacts.organization}, ${contacts.lastName}, ${contacts.firstName}, ${contacts.email}, ${contacts.memberNumber}, ${contacts.customerNumber}))`,
			sql`lower(${contacts.firstName})`,
			contacts.id,
		)
		.limit(CONTACTS_PAGE_SIZE)
		.offset((query.page - 1) * CONTACTS_PAGE_SIZE);
	return {
		canFilterExit,
		groups: await listGroups(db, query.kind),
		items: rows.map((row) => ({
			email: row.email,
			groups: row.groups,
			id: row.id,
			name: displayName(row),
			number: query.kind === 'member' ? row.memberNumber : row.customerNumber,
			suppressed: row.suppressed,
			tags: row.tags,
		})),
		page: query.page,
		tags: query.kind === 'partner' ? await listTags(db) : [],
		total: counted?.total ?? 0,
	};
}

/**
 * The protected built-in values a user sees: only visible fields, only set values.
 *
 * @param row The contact.
 * @param visible The fields of the contact's kind the user sees.
 * @returns The values.
 */
function visibleProtectedValues(
	row: Readonly<Pick<ContactRecord, ProtectedValueField>>,
	visible: ReadonlySet<FieldKey>,
): Partial<Record<ProtectedValueField, string>> {
	const values: Partial<Record<ProtectedValueField, string>> = {};
	for (const field of PROTECTED_VALUE_FIELDS) {
		const key = protectedFieldOf(field);
		const value = row[field];
		if (key !== null && visible.has(key) && value !== null && value !== '') values[field] = value;
	}
	return values;
}

/**
 * The custom values a user sees: only fields of the contact's kind, only visible ones, only set
 * values.
 *
 * @param db The database.
 * @param row The contact.
 * @param visible The fields of the contact's kind the user sees.
 * @returns The values, oldest field first.
 */
async function visibleCustomValues(
	db: Db,
	row: Readonly<{ kind: ContactKind; customValues: Readonly<Record<string, string>> }>,
	visible: ReadonlySet<FieldKey>,
): Promise<ContactDetail['customValues']> {
	const fields = await listCustomFields(db, row.kind);
	return fields.flatMap((field) => {
		const value: unknown = row.customValues[field.id];
		if (!visible.has(customFieldKey(field.id)) || typeof value !== 'string' || value === '') {
			return [];
		}
		return [{ id: field.id, name: field.name, type: field.type, value }];
	});
}

/**
 * The suppression and the area opt-outs of a contact.
 *
 * @param db The database.
 * @param row The contact.
 * @returns The suppression and the opt-outs by area name.
 */
async function suppressionAndOptOuts(
	db: Db,
	row: Readonly<Pick<ContactRecord, 'contactKey' | 'kind'>>,
): Promise<Pick<ContactDetail, 'optOuts' | 'suppression'>> {
	const [suppression] = await db
		.select({ createdAt: contactSuppressions.createdAt })
		.from(contactSuppressions)
		.where(
			and(
				eq(contactSuppressions.kind, row.kind),
				eq(contactSuppressions.contactKey, row.contactKey),
			),
		);
	const optOuts = await db
		.select({ areaId: areas.id, areaName: areas.name, createdAt: contactOptOuts.createdAt })
		.from(contactOptOuts)
		.innerJoin(areas, eq(areas.id, contactOptOuts.areaId))
		.where(
			and(
				eq(contactOptOuts.kind, row.kind),
				eq(contactOptOuts.contactKey, row.contactKey),
				eq(contactOptOuts.scope, 'area'),
			),
		)
		.orderBy(sql`lower(${areas.name})`, areas.name);
	return {
		optOuts: optOuts.map((optOut) => ({
			areaId: optOut.areaId,
			areaName: optOut.areaName,
			at: optOut.createdAt.toISOString(),
		})),
		suppression: suppression === undefined ? null : { at: suppression.createdAt.toISOString() },
	};
}

/**
 * Shows one contact. Protected values the user may not see are never put into the result.
 *
 * @param db The database.
 * @param principal Who asks.
 * @param contactId The contact.
 * @returns The contact, or null when no contact has the id.
 * @throws {ForbiddenError} Without `read` in any area.
 */
async function getContact(
	db: Db,
	principal: Principal,
	contactId: string,
): Promise<ContactDetail | null> {
	const access = await loadContactAccess(db, principal);
	assertCanList(access);
	if (!UUID.test(contactId)) return null;
	const [row] = await db.select().from(contacts).where(eq(contacts.id, contactId));
	if (row === undefined) return null;
	const visible = access.visible[row.kind];
	const canManage = access.canManage[row.kind];
	const customValues = await visibleCustomValues(db, row, visible);
	const { optOuts, suppression } = await suppressionAndOptOuts(db, row);
	// Built field by field: the row also holds the protected values the user may not see.
	return {
		areas: canManage
			? await db
					.select({ id: areas.id, name: areas.name })
					.from(areas)
					.orderBy(sql`lower(${areas.name})`, areas.name)
			: [],
		canManage,
		customValues,
		customerNumber: row.customerNumber,
		email: row.email,
		firstName: row.firstName,
		gender: row.gender,
		groups: row.groups,
		id: row.id,
		kind: row.kind,
		lastName: row.lastName,
		memberNumber: row.memberNumber,
		name: displayName(row),
		optOuts,
		organization: row.organization,
		protectedValues: visibleProtectedValues(row, visible),
		suppression,
		tags: row.tags,
	};
}

export { getContact, listContacts };
export type { ContactFilters } from './filters';
export type {
	ContactDetail,
	ContactListItem,
	ContactListPage,
	ContactListQuery,
	ProtectedValueField,
};
