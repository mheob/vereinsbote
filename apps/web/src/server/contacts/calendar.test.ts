import { describe, expect, it } from 'vite-plus/test';

import { formatCalendarDate, parseCalendarDate, todayInClubZone } from './calendar';

describe(parseCalendarDate, () => {
	it.each([
		['17.05.1980', '1980-05-17'],
		['7.5.1980', '1980-05-07'],
		['1980-05-17', '1980-05-17'],
		['29.02.2024', '2024-02-29'],
	])('parses %s', (input, value) => {
		expect(parseCalendarDate(input)).toStrictEqual({ ok: true, value });
	});

	it.each(['31.02.2020', '29.02.2023', '2020-13-01', '00.01.2020', 'gestern', '17.05.1980 10:00'])(
		'refuses %s',
		(input) => {
			expect(parseCalendarDate(input)).toStrictEqual({ ok: false, reason: 'invalidDate' });
		},
	);

	it.each(['17.05.80', '1.1.99'])('refuses the two-digit year in %s', (input) => {
		expect(parseCalendarDate(input)).toStrictEqual({ ok: false, reason: 'twoDigitYear' });
	});
});

describe(todayInClubZone, () => {
	it('takes today in Berlin, not in UTC', () => {
		expect(todayInClubZone(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
		expect(todayInClubZone(new Date('2026-06-30T21:59:00Z'))).toBe('2026-06-30');
		expect(todayInClubZone(new Date('2026-06-30T22:00:00Z'))).toBe('2026-07-01');
	});
});

describe(formatCalendarDate, () => {
	it('formats without shifting the day', () => {
		expect(formatCalendarDate('1980-05-17', 'de')).toBe('17.05.1980');
		expect(formatCalendarDate('1980-05-17', 'en')).toBe('May 17, 1980');
	});
});
