/*
 * The partner import: the rows of a file are matched with the stored partners, nothing is
 * replaced. A row with a known customer number updates its partner; a row with a new number takes
 * over the only partner without customer number that has its address (one made by hand), else it
 * creates a partner; a row without number is matched by its address. Empty cells and field issues
 * never overwrite a stored value. Partners with a customer number that no row matches are listed
 * as missing from the export; a confirm deletes only those the user ticked.
 */
import { eq } from 'drizzle-orm';

import { displayName } from '@/server/contacts/display-name';
import type { DisplayName } from '@/server/contacts/display-name';
import type { FieldKey } from '@/server/contacts/fields';
import { getImportState } from '@/server/contacts/import-state';
import { contactKey, rekeyContactKey } from '@/server/contacts/suppressions';
import type { Db } from '@/server/db/client';
import { contacts } from '@/server/db/schema';
import type { Principal } from '@/server/permissions/principal';

import type { MappedTarget } from './mapping';
import type { ImportPayload } from './payload';
import {
	authorizeImport,
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
} from './plan';
import type {
	ChangedField,
	ConfirmImportResult,
	ContactValues,
	ImportChange,
	StoredContact,
	WithFieldIds,
	WrittenCounts,
} from './plan';
import type { BlankKey, BlockingIssue, FieldIssue, ImportedRow } from './rows';

/** A row the import skips. */
interface PartnerRowIssue {
	readonly line: number;
	/**
	 * `emailAmbiguous`: a row without customer number whose address several partners have;
	 * `emailRepeated`: an earlier row without customer number has the address; `nameMissing`: a
	 * row that would create a partner without organization, first and last name.
	 */
	readonly reason: 'emailAmbiguous' | 'emailRepeated' | 'nameMissing';
}

/** An empty cell or a field issue: the value the partner has stays. */
interface KeptValue {
	readonly line: number;
	readonly column: string;
}

/** What a partner import does, in numbers. */
interface PartnerImportCounts {
	created: number;
	/** Stored partners that change, except those taken over. */
	updated: number;
	/** Stored partners a row matched that stay as they are. */
	unchanged: number;
	/** Partners without customer number (made by hand) that get one. */
	takenOver: number;
	/** Rows skipped, see `rowIssues`. */
	skipped: number;
}

/** A stored partner whose customer number no row has; the user may tick it for deletion. */
interface MissingPartner {
	id: string;
	customerNumber: string;
	name: DisplayName;
}

/** What the preview of a partner import shows. */
interface PartnerImportPreview {
	/** The stock version the confirm must still find. */
	stockVersion: number;
	counts: PartnerImportCounts;
	/** Changed first, then created; at most `MAX_LISTED_CHANGES`. */
	changes: ImportChange[];
	moreChanges: number;
	/** By customer number. Never deleted unless ticked. */
	notInExport: MissingPartner[];
	/** Only fields the user may see; at most `MAX_LISTED_ISSUES`. */
	keptValues: KeptValue[];
	moreKeptValues: number;
	/** At most `MAX_LISTED_ISSUES`. */
	rowIssues: PartnerRowIssue[];
	moreRowIssues: number;
	/** At most `MAX_LISTED_ISSUES`. */
	fieldIssues: FieldIssue[];
	moreIssues: number;
	blocking: BlockingIssue[];
}

/** A partner rows matched or created. */
interface MatchedPartner {
	/** Null for a partner a row creates. */
	readonly stored: StoredContact | null;
	/** The values after the rows matched so far. */
	readonly values: ContactValues;
}

/** A field of a row that was empty or had a field issue while the partner had a value. */
interface KeptField {
	readonly line: number;
	readonly key: BlankKey;
}

/** A stored partner the file changes. */
interface ChangedPartner {
	readonly stored: StoredContact;
	readonly values: ContactValues;
	readonly fields: readonly ChangedField[];
	/** The partner had no customer number and gets one. */
	readonly takenOver: boolean;
}

/** A stored partner with a customer number that no row matched. */
interface UnmatchedPartner {
	readonly customerNumber: string;
	readonly stored: StoredContact;
}

/** The comparison of the file with the stock. */
interface PartnerPlan {
	readonly created: readonly ContactValues[];
	readonly changed: readonly ChangedPartner[];
	readonly unchanged: number;
	/** By customer number. */
	readonly notInExport: readonly UnmatchedPartner[];
	readonly kept: readonly KeptField[];
	readonly rowIssues: readonly PartnerRowIssue[];
}

/** What the matching of the rows yields. */
interface MatchResult {
	/** In the order of the first row that matched or created each. */
	readonly matched: readonly MatchedPartner[];
	readonly kept: readonly KeptField[];
	readonly rowIssues: readonly PartnerRowIssue[];
}

/** What a confirm writes besides the plan. */
interface PartnerWrite {
	readonly plan: PartnerPlan;
	/** The partners missing from the export the user ticked; a subset of `plan.notInExport`. */
	readonly deleteIds: ReadonlySet<string>;
}

/** The plan of a file that is not compared with the stock, because it has blocking issues. */
const NO_PLAN: PartnerPlan = {
	changed: [],
	created: [],
	kept: [],
	notInExport: [],
	rowIssues: [],
	unchanged: 0,
};

const CUSTOM_PREFIX = 'custom:';

/**
 * Tells whether a partner has a value in a field: a text, a gender other than `unspecified`, or
 * a custom value.
 *
 * @param values The partner's values.
 * @param key The field.
 * @returns True with a value.
 */
function hasValue(values: ContactValues, key: BlankKey): boolean {
	if (isCustomChange(key)) {
		return Object.hasOwn(values.customValues, key.slice(CUSTOM_PREFIX.length));
	}
	if (key === 'gender') return values.gender !== 'unspecified';
	return values[key] !== null;
}

/**
 * Tells whether a partner has a name: an organization, a first or a last name (decision 12 of
 * the plan).
 *
 * @param values The partner's values.
 * @returns True with a name.
 */
function hasName(values: ContactValues): boolean {
	return [values.organization, values.firstName, values.lastName].some((part) => part !== null);
}

/**
 * The field a column fills, as `ImportedRow.blank` names it.
 *
 * @param target The target of the column.
 * @returns The field; null for the groups, which partners do not have.
 */
function blankKeyOf(target: MappedTarget): BlankKey | null {
	if (target.type === 'field') return target.field;
	if (target.type === 'customField') return `${CUSTOM_PREFIX}${target.customFieldId}`;
	if (target.type === 'newCustomField') return `${CUSTOM_PREFIX}${newFieldKey(target.name)}`;
	return null;
}

/**
 * Matches rows with the partners one after the other, in file order: a later row sees what the
 * earlier ones did (the partners they created, the numbers and addresses they wrote). A partner
 * two rows match, one by its number and one by its address, gets both merged in and is written
 * once.
 */
class PartnerMatcher {
	/** Every partner by key: the id of a stored one, `new:<n>` for one a row creates. */
	private readonly partners = new Map<string, MatchedPartner>();
	/** The key by customer number. */
	private readonly byNumber = new Map<string, string>();
	/** The keys by address. */
	private readonly byEmail = new Map<string, Set<string>>();
	/** The keys rows matched or created, in the order of their first row. */
	private readonly matched = new Set<string>();
	/** The addresses of the rows without customer number so far. */
	private readonly emailsWithoutNumber = new Set<string>();
	private readonly kept: KeptField[] = [];
	private readonly rowIssues: PartnerRowIssue[] = [];
	private createdCount = 0;

	/**
	 * Starts with the stored partners.
	 *
	 * @param stored The stored partners.
	 */
	public constructor(stored: readonly StoredContact[]) {
		for (const record of stored) {
			this.put(record.id, { stored: record, values: storedValues(record) });
		}
	}

	/**
	 * Matches a row: by customer number, else by address.
	 *
	 * @param row The row, free of blocking issues.
	 */
	public match(row: ImportedRow): void {
		const number = row.values.customerNumber;
		if (typeof number === 'string') this.matchNumber(row, number);
		else this.matchEmail(row);
	}

	/**
	 * The outcome of the rows matched so far.
	 *
	 * @returns The matched and created partners, the kept fields and the skipped rows.
	 */
	public result(): MatchResult {
		return {
			kept: [...this.kept],
			matched: [...this.matched].flatMap((key) => this.partners.get(key) ?? []),
			rowIssues: [...this.rowIssues],
		};
	}

	/**
	 * A row with a customer number: updates the partner with it; a new number takes over the only
	 * partner without number that has the row's address, else it creates a partner (or skips a
	 * row without name).
	 *
	 * @param row The row.
	 * @param number Its customer number.
	 */
	private matchNumber(row: ImportedRow, number: string): void {
		const known = this.byNumber.get(number);
		if (known !== undefined) {
			this.merge(known, row);
			return;
		}
		const [manual, ...others] = this.withEmail(row.values.email).filter(
			(key) => this.partners.get(key)?.values.customerNumber === null,
		);
		if (manual !== undefined && others.length === 0) this.merge(manual, row);
		else this.create(row);
	}

	/**
	 * A row without customer number: skipped when an earlier such row had the address or several
	 * partners have it; else updates the one partner with the address or creates one (or skips a
	 * row without name).
	 *
	 * @param row The row.
	 * @throws {TypeError} For a row without address, which the blocking check excludes.
	 */
	private matchEmail(row: ImportedRow): void {
		const { email } = row.values;
		if (typeof email !== 'string') {
			throw new TypeError('A row without customer number and address reached the plan.');
		}
		if (this.emailsWithoutNumber.has(email)) {
			this.rowIssues.push({ line: row.line, reason: 'emailRepeated' });
			return;
		}
		this.emailsWithoutNumber.add(email);
		const [only, ...others] = this.withEmail(email);
		if (only === undefined) this.create(row);
		else if (others.length > 0) this.rowIssues.push({ line: row.line, reason: 'emailAmbiguous' });
		else this.merge(only, row);
	}

	/**
	 * The keys of the partners with an address.
	 *
	 * @param email The address, or nothing.
	 * @returns The keys; none without an address.
	 */
	private withEmail(email: string | null | undefined): string[] {
		return typeof email === 'string' ? [...(this.byEmail.get(email) ?? [])] : [];
	}

	/**
	 * Merges a row into a partner and notes the fields whose value stays although the row's cell
	 * was empty or had a field issue.
	 *
	 * @param key The partner.
	 * @param row The row.
	 * @throws {Error} For an unknown key, which the indexes never hold.
	 */
	private merge(key: string, row: ImportedRow): void {
		const partner = this.partners.get(key);
		if (partner === undefined) throw new Error('A matched partner is missing.');
		for (const blank of row.blank) {
			if (hasValue(partner.values, blank)) this.kept.push({ key: blank, line: row.line });
		}
		this.put(key, { ...partner, values: mergedValues(partner.values, row) });
		this.matched.add(key);
	}

	/**
	 * Creates a partner with the values of a row; a gender without value is `unspecified`. A row
	 * without any name is skipped: a partner needs one, in the app as in the import.
	 *
	 * @param row The row.
	 */
	private create(row: ImportedRow): void {
		const values = replacedValues('partner', row);
		if (!hasName(values)) {
			this.rowIssues.push({ line: row.line, reason: 'nameMissing' });
			return;
		}
		this.createdCount += 1;
		const key = `new:${this.createdCount}`;
		this.put(key, { stored: null, values });
		this.matched.add(key);
	}

	/**
	 * Stores a partner under its key and indexes it by customer number and address.
	 *
	 * @param key The partner.
	 * @param partner Its values.
	 */
	private put(key: string, partner: MatchedPartner): void {
		const before = this.partners.get(key);
		if (before !== undefined) this.unindex(key, before.values);
		this.partners.set(key, partner);
		const { customerNumber, email } = partner.values;
		if (customerNumber !== null) this.byNumber.set(customerNumber, key);
		if (email !== null) this.byEmail.set(email, (this.byEmail.get(email) ?? new Set()).add(key));
	}

	/**
	 * Removes a partner's old values from the indexes.
	 *
	 * @param key The partner.
	 * @param values Its old values.
	 */
	private unindex(key: string, values: ContactValues): void {
		if (values.customerNumber !== null) this.byNumber.delete(values.customerNumber);
		if (values.email !== null) this.byEmail.get(values.email)?.delete(key);
	}
}

/**
 * Compares the rows with the stored partners.
 *
 * @param stored The stored partners.
 * @param rows The rows, free of blocking issues.
 * @returns The plan.
 */
function comparePartners(
	stored: readonly StoredContact[],
	rows: readonly ImportedRow[],
): PartnerPlan {
	const matcher = new PartnerMatcher(stored);
	for (const row of rows) matcher.match(row);
	const { kept, matched, rowIssues } = matcher.result();
	const created = matched.flatMap(({ stored: record, values }) =>
		record === null ? [values] : [],
	);
	const compared = matched.flatMap(({ stored: record, values }): ChangedPartner[] =>
		record === null
			? []
			: [
					{
						fields: diffValues(storedValues(record), values),
						stored: record,
						// Only a take-over gives a stored partner without number one.
						takenOver: record.customerNumber === null && values.customerNumber !== null,
						values,
					},
				],
	);
	const changed = compared.filter(({ fields }) => fields.length > 0);
	const matchedIds = new Set(compared.map((partner) => partner.stored.id));
	const notInExport = stored
		.flatMap((record): UnmatchedPartner[] =>
			record.customerNumber === null || matchedIds.has(record.id)
				? []
				: [{ customerNumber: record.customerNumber, stored: record }],
		)
		.toSorted((a, b) => NUMBER_ORDER.compare(a.customerNumber, b.customerNumber));
	return {
		changed,
		created,
		kept,
		notInExport,
		rowIssues,
		unchanged: compared.length - changed.length,
	};
}

/**
 * Compares the rows with the stored partners.
 *
 * @param db The database or a transaction.
 * @param rows The rows, free of blocking issues.
 * @returns The plan.
 */
async function planPartners(db: Db, rows: readonly ImportedRow[]): Promise<PartnerPlan> {
	const stored = await db.select().from(contacts).where(eq(contacts.kind, 'partner'));
	return comparePartners(stored, rows);
}

/**
 * The kept fields as cells of the file, without the fields the user may not see: such an entry
 * would tell that the hidden field has a value.
 *
 * @param kept The kept fields.
 * @param payload The payload, for the column headers.
 * @param visible The partner fields the user sees.
 * @returns The kept values.
 */
function keptValuesOf(
	kept: readonly KeptField[],
	payload: ImportPayload,
	visible: ReadonlySet<FieldKey>,
): KeptValue[] {
	const headers = new Map(
		payload.columns.flatMap(({ header, target }): [BlankKey, string][] => {
			const key = blankKeyOf(target);
			return key === null ? [] : [[key, header]];
		}),
	);
	return kept.flatMap(({ key, line }): KeptValue[] => {
		const column = headers.get(key);
		return column === undefined || !isVisibleChange(key, visible) ? [] : [{ column, line }];
	});
}

/**
 * What a preview shows of a plan, for one user: the counts, the changes, the partners missing from
 * the export, the kept values and the skipped rows.
 *
 * @param plan The plan.
 * @param payload The payload, for the column headers.
 * @param visible The partner fields the user sees.
 * @returns The part of the preview that comes from the plan.
 */
function describePlan(
	plan: PartnerPlan,
	payload: ImportPayload,
	visible: ReadonlySet<FieldKey>,
): Omit<PartnerImportPreview, 'blocking' | 'fieldIssues' | 'moreIssues' | 'stockVersion'> {
	const takenOver = plan.changed.filter((partner) => partner.takenOver).length;
	const changes = firstOf(
		[
			...plan.changed.map(({ fields, values }) =>
				toImportChange({ fields, type: 'changed', values }, visible),
			),
			...plan.created.map((values) => toImportChange({ type: 'created', values }, visible)),
		],
		MAX_LISTED_CHANGES,
	);
	const kept = firstOf(keptValuesOf(plan.kept, payload, visible), MAX_LISTED_ISSUES);
	const rowIssues = firstOf(plan.rowIssues, MAX_LISTED_ISSUES);
	return {
		changes: changes.listed,
		counts: {
			created: plan.created.length,
			skipped: plan.rowIssues.length,
			takenOver,
			unchanged: plan.unchanged,
			updated: plan.changed.length - takenOver,
		},
		keptValues: kept.listed,
		moreChanges: changes.more,
		moreKeptValues: kept.more,
		moreRowIssues: rowIssues.more,
		notInExport: plan.notInExport.map(({ customerNumber, stored }) => ({
			customerNumber,
			id: stored.id,
			name: displayName(stored),
		})),
		rowIssues: rowIssues.listed,
	};
}

/**
 * Previews a partner import: what the file changes in the stock. With blocking issues the file
 * is not compared (its keys are not reliable), the preview names the issues only. Nothing is
 * stored.
 *
 * @param db The database.
 * @param principal Who imports; needs `edit` in the partners area.
 * @param payload The rows of the file.
 * @param _now Unused: the partner import compares no dates. The parameter keeps the interface of
 *   the member import.
 * @returns The preview.
 * @throws {ForbiddenError} For a payload of another kind or without the right.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function previewPartnerImport(
	db: Db,
	principal: Principal,
	payload: ImportPayload,
	_now: Date,
): Promise<PartnerImportPreview> {
	const access = await authorizeImport(db, principal, { kind: 'partner', payload });
	// The version is read before the stock: a change in between makes the confirm refuse, it can
	// never accept a preview of an older stock.
	const { stockVersion } = await getImportState(db, 'partner');
	const rows = await readImportRows(db, payload);
	const plan = rows.blocking.length > 0 ? NO_PLAN : await planPartners(db, rows.rows);
	const issues = firstOf(rows.fieldIssues, MAX_LISTED_ISSUES);
	return {
		...describePlan(plan, payload, access.visible.partner),
		blocking: [...rows.blocking],
		fieldIssues: issues.listed,
		moreIssues: issues.more,
		stockVersion,
	};
}

/**
 * Moves the suppression and the opt-outs of each partner taken over from its address to its
 * customer number. No other partner keeps the old key: the partner was the only one without
 * number that had the address, and a later row with the address matches it instead of creating
 * another one.
 *
 * @param tx The transaction; the partners already have their numbers.
 * @param changed The changed partners.
 */
async function rekeyTakenOver(tx: Db, changed: readonly ChangedPartner[]): Promise<void> {
	for (const { stored, takenOver, values } of changed) {
		const to = contactKey(values);
		if (takenOver && to !== null) {
			// oxlint-disable-next-line no-await-in-loop -- a transaction runs one statement at a time
			await rekeyContactKey(tx, 'partner', stored.contactKey, to);
		}
	}
}

/**
 * Writes a partner plan: deletes the ticked partners, inserts, updates, then lets the
 * suppressions and opt-outs of the partners taken over follow their new key.
 *
 * @param tx The transaction.
 * @param input The plan and the partners to delete.
 * @param withFieldIds Keys the custom values by field id.
 * @returns The counts and the audit details.
 */
async function writePartners(
	tx: Db,
	input: PartnerWrite,
	withFieldIds: WithFieldIds,
): Promise<WrittenCounts> {
	const { deleteIds, plan } = input;
	await deleteContacts(tx, [...deleteIds]);
	await insertContacts(tx, plan.created.map(withFieldIds));
	await updateContacts(
		tx,
		plan.changed.map(({ stored, values }) => ({ id: stored.id, values: withFieldIds(values) })),
	);
	await rekeyTakenOver(tx, plan.changed);
	const takenOver = plan.changed.filter((partner) => partner.takenOver).length;
	return {
		counts: {
			changed: plan.changed.length,
			created: plan.created.length,
			removed: deleteIds.size,
		},
		details: {
			created: plan.created.length,
			deleted: deleteIds.size,
			takenOver,
			updated: plan.changed.length - takenOver,
		},
	};
}

/**
 * Confirms a partner import in one transaction: creates and updates partners, takes hand-made
 * ones over and deletes the ticked partners missing from the export. No safety check: nothing is
 * deleted unless ticked. Refuses without writing when the stock changed since the preview, the
 * rows have blocking issues, or a ticked partner is not (or no longer) missing from the export.
 *
 * @param db The database.
 * @param principal Who imports; needs `edit` in the partners area.
 * @param payload The rows of the file, as previewed.
 * @param input The stock version of the preview and the ticked partners.
 * @param now The instant of the import.
 * @returns The counts (`changed`: updated and taken over, `removed`: deleted), or why nothing
 *   was written.
 * @throws {ForbiddenError} For a payload of another kind or without the right.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function confirmPartnerImport(
	db: Db,
	principal: Principal,
	payload: ImportPayload,
	input: Readonly<{ stockVersion: number; deleteIds: readonly string[] }>,
	now: Date,
): Promise<ConfirmImportResult> {
	const deleteIds: ReadonlySet<string> = new Set(input.deleteIds);
	return confirmImport<PartnerPlan>(
		db,
		{
			auditAction: 'import.partners',
			kind: 'partner',
			now,
			payload,
			principal,
			stockVersion: input.stockVersion,
		},
		{
			plan: async (tx, rows) => planPartners(tx, rows.rows),
			refuse: (plan) => {
				const missing = new Set(plan.notInExport.map(({ stored }) => stored.id));
				return [...deleteIds].every((id) => missing.has(id)) ? null : 'stockChanged';
			},
			write: async (tx, plan, withFieldIds) => writePartners(tx, { deleteIds, plan }, withFieldIds),
		},
	);
}

export { confirmPartnerImport, previewPartnerImport };
export type {
	KeptValue,
	MissingPartner,
	PartnerImportCounts,
	PartnerImportPreview,
	PartnerRowIssue,
};
