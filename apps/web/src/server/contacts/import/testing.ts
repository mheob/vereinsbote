/*
 * Payloads in the form of the club's exports. For tests only (also of the member and partner
 * import); all data in the tests is invented.
 */
import { DEFAULT_IMPORT_OPTIONS } from './mapping';
import type { ImportOptions, MappedTarget } from './mapping';
import type { ImportPayload } from './payload';

const field = (name: Extract<MappedTarget, { type: 'field' }>['field']): MappedTarget => ({
	field: name,
	type: 'field',
});

const MEMBER_COLUMNS: ImportPayload['columns'] = [
	{ header: 'Nr.', target: field('memberNumber') },
	{ header: 'Vorname', target: field('firstName') },
	{ header: 'Nachname', target: field('lastName') },
	{ header: 'E-Mail', target: field('email') },
	{ header: 'Geburtstag', target: field('birthDate') },
	{ header: 'Mitglied bis', target: field('exitDate') },
	{ header: 'Abteilungen', target: { type: 'groups' } },
	{ header: 'Status', target: { type: 'groups' } },
	{ header: 'Geschlecht', target: field('gender') },
];

const PARTNER_COLUMNS: ImportPayload['columns'] = [
	{ header: 'Nr.', target: field('customerNumber') },
	{ header: 'Nachname', target: field('lastName') },
	{ header: 'Vorname', target: field('firstName') },
	{ header: 'E-Mail', target: field('email') },
	{ header: 'Geschlecht', target: field('gender') },
];

/** The gender values of the club's exports. */
const EXPORT_GENDER_VALUES: ImportOptions['genderValues'] = {
	'keine Angabe': 'unspecified',
	männlich: 'male',
	weiblich: 'female',
};

/**
 * Builds a payload. Rows may be shorter than the columns; the missing cells are null.
 *
 * @param shape The contact kind and the columns.
 * @param rows The cells per row; row n is line n + 2 of the file (line 1 is the header).
 * @param options Options that differ from the defaults with the export's gender values.
 * @returns The payload.
 */
function payloadOf(
	shape: Pick<ImportPayload, 'columns' | 'kind'>,
	rows: readonly (readonly string[])[],
	options: Partial<ImportOptions>,
): ImportPayload {
	const { kind, columns } = shape;
	return {
		columns,
		discardedHeaders: [],
		filters: [],
		kind,
		options: { ...DEFAULT_IMPORT_OPTIONS, genderValues: EXPORT_GENDER_VALUES, ...options },
		rows: rows.map((cells, index) => {
			if (cells.length > columns.length) throw new Error('A test row has more cells than columns.');
			return {
				cells: columns.map((_column, at) => cells[at] ?? null),
				line: index + 2,
			};
		}),
	};
}

/**
 * A member payload with the columns Nr., Vorname, Nachname, E-Mail, Geburtstag, Mitglied bis,
 * Abteilungen, Status, Geschlecht. For tests only.
 *
 * @param rows The cells per row, in this order.
 * @param options Options that differ from the defaults.
 * @returns The payload.
 */
function memberPayload(
	rows: readonly (readonly string[])[],
	options: Partial<ImportOptions> = {},
): ImportPayload {
	return payloadOf({ columns: MEMBER_COLUMNS, kind: 'member' }, rows, options);
}

/**
 * A partner payload with the columns Nr., Nachname, Vorname, E-Mail, Geschlecht. For tests only.
 *
 * @param rows The cells per row, in this order.
 * @param options Options that differ from the defaults.
 * @returns The payload.
 */
function partnerPayload(
	rows: readonly (readonly string[])[],
	options: Partial<ImportOptions> = {},
): ImportPayload {
	return payloadOf({ columns: PARTNER_COLUMNS, kind: 'partner' }, rows, options);
}

export { memberPayload, partnerPayload };
