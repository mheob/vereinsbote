import { intlLocale } from '@/i18n/locale';
import type { Locale } from '@/i18n/locale';

/** "Today" for the club is the calendar day here, never the server's (UTC) or the browser's. */
const CLUB_TIME_ZONE = 'Europe/Berlin';

type DateParseResult =
	| { ok: true; value: string }
	| { ok: false; reason: 'invalidDate' | 'twoDigitYear' };

const GERMAN_DATE = /^(?<day>\d{1,2})\.(?<month>\d{1,2})\.(?<year>\d{4})$/u;
const GERMAN_TWO_DIGIT_YEAR = /^(?<day>\d{1,2})\.(?<month>\d{1,2})\.\d{2}$/u;
const ISO_DATE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

const MAX_DAY = 31;
const MAX_MONTH = 12;
const YEAR_DIGITS = 4;
const MONTH_DAY_DIGITS = 2;

const INVALID: DateParseResult = { ok: false, reason: 'invalidDate' };

/**
 * Today's calendar day in the club's time zone.
 *
 * @param now The instant.
 * @returns The day as `YYYY-MM-DD`.
 */
function todayInClubZone(now: Date): string {
	// The `sv` locale writes dates as `YYYY-MM-DD`.
	return new Intl.DateTimeFormat('sv', { timeZone: CLUB_TIME_ZONE }).format(now);
}

/**
 * Left-pads a number with zeros.
 *
 * @param value The number.
 * @param length The width.
 * @returns The padded text.
 */
function pad(value: number, length: number): string {
	return String(value).padStart(length, '0');
}

/**
 * Builds a calendar date if the day exists. The year 0 does not: PostgreSQL refuses it.
 *
 * @param year The year, four digits.
 * @param month The month, 1 to 12.
 * @param day The day of the month.
 * @returns The date as `YYYY-MM-DD`, or the invalid result.
 */
function calendarDate(year: number, month: number, day: number): DateParseResult {
	if (year < 1) return INVALID;
	const probe = new Date(Date.UTC(year, month - 1, day));
	// `Date.UTC` maps years 0 to 99 to 1900 to 1999; `setUTCFullYear` does not.
	probe.setUTCFullYear(year);
	if (
		probe.getUTCFullYear() !== year ||
		probe.getUTCMonth() !== month - 1 ||
		probe.getUTCDate() !== day
	) {
		return INVALID;
	}
	return {
		ok: true,
		value: `${pad(year, YEAR_DIGITS)}-${pad(month, MONTH_DAY_DIGITS)}-${pad(day, MONTH_DAY_DIGITS)}`,
	};
}

/**
 * Reads a date typed as `TT.MM.JJJJ`, `T.M.JJJJ` or `JJJJ-MM-TT`. A year with two digits is
 * refused: it could mean two centuries.
 *
 * @param input The text.
 * @returns The date as `YYYY-MM-DD`, or the reason it was refused.
 */
function parseCalendarDate(input: string): DateParseResult {
	const full = GERMAN_DATE.exec(input)?.groups ?? ISO_DATE.exec(input)?.groups;
	if (full !== undefined)
		return calendarDate(Number(full.year), Number(full.month), Number(full.day));
	const short = GERMAN_TWO_DIGIT_YEAR.exec(input)?.groups;
	if (short === undefined) return INVALID;
	const day = Number(short.day);
	const month = Number(short.month);
	const plausible = day >= 1 && day <= MAX_DAY && month >= 1 && month <= MAX_MONTH;
	return plausible ? { ok: false, reason: 'twoDigitYear' } : INVALID;
}

/**
 * Formats a calendar date for display without shifting the day.
 *
 * @param value The date as `YYYY-MM-DD`.
 * @param locale The UI language.
 * @returns The date, e.g. `17.05.1980` in German.
 */
function formatCalendarDate(value: string, locale: Locale): string {
	return new Intl.DateTimeFormat(intlLocale(locale), {
		dateStyle: 'medium',
		timeZone: 'UTC',
	}).format(new Date(`${value}T00:00:00Z`));
}

/**
 * Formats an instant as the calendar day in the club's time zone.
 *
 * @param at The instant.
 * @param locale The UI language.
 * @returns The day, e.g. `1. Oktober 2026` in German.
 */
function formatClubDate(at: Date, locale: Locale): string {
	return new Intl.DateTimeFormat(intlLocale(locale), {
		dateStyle: 'long',
		timeZone: CLUB_TIME_ZONE,
	}).format(at);
}

export { CLUB_TIME_ZONE, formatCalendarDate, formatClubDate, parseCalendarDate, todayInClubZone };
export type { DateParseResult };
