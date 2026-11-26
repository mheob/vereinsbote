/*
 * The planned start of a wave (Design 8.7): a date and a time on the club's clock (Europe/Berlin),
 * whatever the browser's time zone, turned into the instant the server checks and stores. Pure and
 * browser-safe: `@internationalized/date` knows the time zone rules, also across a change of the
 * clocks.
 */
import { CalendarDateTime, fromDate, toCalendarDateTime, toZoned } from '@internationalized/date';

import { intlLocale } from '@/i18n/locale';
import type { Locale } from '@/i18n/locale';
import { CLUB_TIME_ZONE } from '@/server/contacts/calendar';

/** When a wave starts: at once, or at a planned date and time. */
type When = 'later' | 'now';

/** The hour the planned start proposes. */
const PROPOSED_HOUR = 9;

/**
 * The instant of a date and time on the club's clock. A time the clocks skip in spring moves to
 * the hour after; one they repeat in autumn is its first, in summer time (`compatible`).
 *
 * @param at The date and time in Europe/Berlin.
 * @returns The instant.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a date of @internationalized/date is an immutable value whose class the rule cannot see into
function scheduledInstant(at: CalendarDateTime): Date {
	return toZoned(at, CLUB_TIME_ZONE, 'compatible').toDate();
}

/**
 * The club's clock at an instant, to the minute (seconds dropped).
 *
 * @param at The instant.
 * @returns The date and time in Europe/Berlin.
 */
function clubClock(at: Date): CalendarDateTime {
	return toCalendarDateTime(fromDate(at, CLUB_TIME_ZONE)).set({ millisecond: 0, second: 0 });
}

/**
 * The start the field proposes: nine o'clock on the club's next day.
 *
 * @param now The instant.
 * @returns The date and time in Europe/Berlin.
 */
function defaultSchedule(now: Date): CalendarDateTime {
	const today = clubClock(now);
	return new CalendarDateTime(today.year, today.month, today.day, PROPOSED_HOUR, 0).add({
		days: 1,
	});
}

/**
 * The earliest and the latest start the field takes: from the next minute on the club's clock to a
 * year ahead (Design 8.7), the same range the server checks.
 *
 * @param now The instant.
 * @returns The bounds in Europe/Berlin.
 */
function scheduleBounds(now: Date): { min: CalendarDateTime; max: CalendarDateTime } {
	const latest = new Date(now);
	latest.setUTCFullYear(latest.getUTCFullYear() + 1);
	const current = clubClock(now);
	const onTheMinute = now.getUTCSeconds() === 0 && now.getUTCMilliseconds() === 0;
	return { max: clubClock(latest), min: onTheMinute ? current : current.add({ minutes: 1 }) };
}

/**
 * Names a planned start: the day and the time on the club's clock, in the page's language.
 *
 * @param at The instant.
 * @param locale The language of the page.
 * @returns E.g. `27. November 2026 um 09:00`.
 */
function formatClubDateTime(at: Date, locale: Locale): string {
	return new Intl.DateTimeFormat(intlLocale(locale), {
		dateStyle: 'long',
		timeStyle: 'short',
		timeZone: CLUB_TIME_ZONE,
	}).format(at);
}

export { defaultSchedule, formatClubDateTime, scheduleBounds, scheduledInstant };
export type { When };
