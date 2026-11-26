import { CalendarDateTime } from '@internationalized/date';
import { describe, expect, it } from 'vite-plus/test';

import { defaultSchedule, formatClubDateTime, scheduleBounds, scheduledInstant } from './schedule';

describe(scheduledInstant, () => {
	it('reads a date and time in Berlin in winter and in summer', () => {
		expect(scheduledInstant(new CalendarDateTime(2026, 12, 1, 9, 0))).toStrictEqual(
			new Date('2026-12-01T08:00:00.000Z'),
		);
		expect(scheduledInstant(new CalendarDateTime(2026, 7, 1, 9, 0))).toStrictEqual(
			new Date('2026-07-01T07:00:00.000Z'),
		);
	});

	it('moves a time the clocks skip in spring to the hour after', () => {
		// 02:30 does not exist on 29 March 2026: the clocks go from 02:00 to 03:00.
		expect(scheduledInstant(new CalendarDateTime(2026, 3, 29, 2, 30))).toStrictEqual(
			new Date('2026-03-29T01:30:00.000Z'),
		);
	});

	it('takes the first of a time the clocks repeat in autumn', () => {
		// 02:30 happens twice on 25 October 2026: first in summer time (UTC+2).
		expect(scheduledInstant(new CalendarDateTime(2026, 10, 25, 2, 30))).toStrictEqual(
			new Date('2026-10-25T00:30:00.000Z'),
		);
	});
});

describe(defaultSchedule, () => {
	it('proposes nine o’clock on the next day in Berlin', () => {
		// 23:30 in Berlin on 26 November.
		expect(defaultSchedule(new Date('2026-11-26T22:30:00.000Z'))).toStrictEqual(
			new CalendarDateTime(2026, 11, 27, 9, 0),
		);
		// 00:30 in Berlin on 27 November, still the 26th in UTC.
		expect(defaultSchedule(new Date('2026-11-26T23:30:00.000Z'))).toStrictEqual(
			new CalendarDateTime(2026, 11, 28, 9, 0),
		);
	});
});

describe(scheduleBounds, () => {
	it('allows from now to a year ahead, in Berlin', () => {
		expect(scheduleBounds(new Date('2026-11-26T09:15:40.000Z'))).toStrictEqual({
			max: new CalendarDateTime(2027, 11, 26, 10, 15),
			min: new CalendarDateTime(2026, 11, 26, 10, 16),
		});
	});
});

describe(formatClubDateTime, () => {
	it('names the day and the time in Berlin in the page language', () => {
		const at = new Date('2026-11-27T08:00:00.000Z');
		expect(formatClubDateTime(at, 'de')).toBe('27. November 2026 um 09:00');
		expect(formatClubDateTime(at, 'en')).toBe('November 27, 2026 at 9:00 AM');
	});
});
