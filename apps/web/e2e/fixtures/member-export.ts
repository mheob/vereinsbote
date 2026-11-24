import writeXlsxFile from 'write-excel-file/node';
import type { Row, SheetData } from 'write-excel-file/node';

/*
 * A member export in the form of the club's member administration (design 1): one sheet, the
 * header in row 1, numbers and Excel dates as such, „-“ for a missing address. All data is
 * invented; addresses use example.org.
 */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type ExportGender = 'keine Angabe' | 'männlich' | 'weiblich';

/** One row of the export. Dates are calendar days at midnight UTC. */
interface MemberExportRow {
	readonly nr: number;
	readonly firstName: string;
	readonly lastName: string;
	readonly birthday: Date;
	/** „-“ without an address. */
	readonly email: string;
	readonly status: 'Aktiv' | 'Passiv';
	readonly memberSince: Date;
	readonly memberUntil: Date | null;
	readonly departments: string;
	readonly gender: ExportGender;
}

const PEOPLE: readonly (readonly [string, ExportGender])[] = [
	['Anna', 'weiblich'],
	['Ben', 'männlich'],
	['Clara', 'weiblich'],
	['David', 'männlich'],
	['Emma', 'weiblich'],
	['Felix', 'männlich'],
	['Greta', 'weiblich'],
	['Hannes', 'männlich'],
	['Ida', 'weiblich'],
	['Jonas', 'männlich'],
	['Kim', 'keine Angabe'],
	['Lena', 'weiblich'],
	['Moritz', 'männlich'],
	['Nora', 'weiblich'],
	['Oskar', 'männlich'],
	['Paula', 'weiblich'],
	['Quirin', 'männlich'],
	['Rosa', 'weiblich'],
	['Simon', 'männlich'],
	['Tilda', 'weiblich'],
	['Uwe', 'männlich'],
	['Vera', 'weiblich'],
	['Wim', 'männlich'],
	['Xenia', 'weiblich'],
	['Yusuf', 'männlich'],
	['Zoe', 'weiblich'],
	['Alex', 'keine Angabe'],
	['Bettina', 'weiblich'],
	['Carl', 'männlich'],
	['Doris', 'weiblich'],
	['Emil', 'männlich'],
	['Frieda', 'weiblich'],
	['Gustav', 'männlich'],
	['Hedwig', 'weiblich'],
	['Ivo', 'männlich'],
	['Jana', 'weiblich'],
	['Karl', 'männlich'],
	['Luise', 'weiblich'],
	['Max', 'männlich'],
	['Mila', 'weiblich'],
];

/** Last names, each once, so a search finds one member. */
const LAST_NAMES: readonly string[] = [
	'Abel',
	'Bauer',
	'Conrad',
	'Dietz',
	'Engel',
	'Fuchs',
	'Graf',
	'Hahn',
	'Iske',
	'Jung',
	'Kraus',
	'Lorenz',
	'Maier',
	'Nagel',
	'Ott',
	'Peters',
	'Quast',
	'Roth',
	'Sommer',
	'Thiel',
	'Ullrich',
	'Vogt',
	'Wolff',
	'Xander',
	'Yildiz',
	'Ziegler',
	'Albers',
	'Brandt',
	'Christ',
	'Dorn',
	'Eckert',
	'Frank',
	'Gerber',
	'Haas',
	'Imhof',
	'Jäger',
	'Keller',
	'Lang',
	'Mertens',
	'Neumann',
];

const DEPARTMENTS: readonly string[] = ['Fußball', 'Fußball, Danceaerobic', '-', 'Tischtennis'];

/** Every seventh member has no address. */
const WITHOUT_EMAIL_EVERY = 7;
/** Every fifth member is passive. */
const PASSIVE_EVERY = 5;
/** Row 39 (index 38) has left the club yesterday, row 40 (index 39) leaves next year. */
const EXITED_INDEX = 38;
const LEAVING_INDEX = 39;
/** The member number of row 2, the first member. */
const FIRST_NUMBER = 1001;

/** How the dates of the rows spread: from a year over some years, by steps per row. */
interface DateSpread {
	readonly firstYear: number;
	readonly years: number;
	readonly yearStep: number;
	readonly monthStep: number;
	readonly dayStep: number;
}

const BIRTHDAYS: DateSpread = {
	dayStep: 11,
	firstYear: 1950,
	monthStep: 5,
	yearStep: 7,
	years: 55,
};
const ENTRIES: DateSpread = { dayStep: 13, firstYear: 1990, monthStep: 7, yearStep: 3, years: 35 };
/** Months of a year, and days every month has. */
const CALENDAR = { days: 28, months: 12 } as const;
/** The day next year on which row 40 leaves: 30 June. */
const LEAVING_DAY = { day: 30, monthIndex: 5 } as const;

const HEADERS = [
	'Nr.',
	'Vorname',
	'Nachname',
	'Geburtstag',
	'E-Mail',
	'Typ',
	'Status',
	'Mitglied seit',
	'Mitglied bis',
	'Abteilungen',
	'Geschlecht',
];

/**
 * Today in the club's time zone, the day the import compares exits with.
 *
 * @param now The instant.
 * @returns Year, month (1–12) and day.
 */
function berlinDay(now: Readonly<Date>): Readonly<{ year: number; month: number; day: number }> {
	const parts = new Intl.DateTimeFormat('en-US', {
		day: 'numeric',
		month: 'numeric',
		timeZone: 'Europe/Berlin',
		year: 'numeric',
	}).formatToParts(now);
	const part = (type: Intl.DateTimeFormatPartTypes): number =>
		Number(parts.find((entry) => entry.type === type)?.value);
	return { day: part('day'), month: part('month'), year: part('year') };
}

/**
 * A text in lowercase without umlauts, for an address.
 *
 * @param text The text.
 * @returns The text.
 */
function ascii(text: string): string {
	return text
		.toLowerCase()
		.replaceAll('ä', 'ae')
		.replaceAll('ö', 'oe')
		.replaceAll('ü', 'ue')
		.replaceAll('ß', 'ss');
}

/**
 * A date of a row, spread over the years.
 *
 * @param index The index of the row.
 * @param spread How the dates spread.
 * @returns The calendar day at midnight UTC.
 */
function spreadDate(index: number, spread: DateSpread): Date {
	return new Date(
		Date.UTC(
			spread.firstYear + ((index * spread.yearStep) % spread.years),
			(index * spread.monthStep) % CALENDAR.months,
			1 + ((index * spread.dayStep) % CALENDAR.days),
		),
	);
}

/**
 * An address from a name, without umlauts.
 *
 * @param firstName The first name.
 * @param lastName The last name.
 * @returns `vorname.nachname@example.org`.
 */
function emailOf(firstName: string, lastName: string): string {
	return `${ascii(firstName)}.${ascii(lastName)}@example.org`;
}

/**
 * The 40 rows of the member export: numbers from 1001, every seventh without address, the
 * departments in turn. Row 39 has left the club yesterday (the club's day), row 40 leaves next
 * year.
 *
 * @param today The day of the test run.
 * @returns The rows.
 */
function memberExportRows(today: Readonly<Date>): MemberExportRow[] {
	const { day, month, year } = berlinDay(today);
	return PEOPLE.map(([firstName, gender], index): MemberExportRow => {
		const lastName = LAST_NAMES[index] ?? `Muster${index}`;
		let memberUntil: Date | null = null;
		if (index === EXITED_INDEX) memberUntil = new Date(Date.UTC(year, month - 1, day - 1));
		if (index === LEAVING_INDEX)
			memberUntil = new Date(Date.UTC(year + 1, LEAVING_DAY.monthIndex, LEAVING_DAY.day));
		return {
			birthday: spreadDate(index, BIRTHDAYS),
			departments: DEPARTMENTS[index % DEPARTMENTS.length] ?? '-',
			email: (index + 1) % WITHOUT_EMAIL_EVERY === 0 ? '-' : emailOf(firstName, lastName),
			firstName,
			gender,
			lastName,
			memberSince: spreadDate(index, ENTRIES),
			memberUntil,
			nr: FIRST_NUMBER + index,
			status: (index + 1) % PASSIVE_EVERY === 0 ? 'Passiv' : 'Aktiv',
		};
	});
}

/**
 * A date cell as Excel shows it in the export.
 *
 * @param value The calendar day at midnight UTC.
 * @returns The cell.
 */
function dateCell(value: Readonly<Date>): Row[number] {
	return { format: 'dd.mm.yyyy', type: Date, value: new Date(value) };
}

/**
 * The export as an XLSX workbook with one sheet, written with write-excel-file.
 *
 * @param rows The rows.
 * @returns The bytes of the file.
 */
async function memberExportXlsx(rows: readonly MemberExportRow[]): Promise<Buffer> {
	const data: SheetData = [
		HEADERS,
		...rows.map((row): Row => [
			{ type: Number, value: row.nr },
			row.firstName,
			row.lastName,
			dateCell(row.birthday),
			row.email,
			'Mitglied',
			row.status,
			dateCell(row.memberSince),
			row.memberUntil === null ? null : dateCell(row.memberUntil),
			row.departments,
			row.gender,
		]),
	];
	return writeXlsxFile(data).toBuffer();
}

export { memberExportRows, memberExportXlsx, XLSX_MIME };
export type { MemberExportRow };
