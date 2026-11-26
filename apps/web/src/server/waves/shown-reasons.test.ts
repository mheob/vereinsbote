import { describe, expect, it } from 'vite-plus/test';

import { exitDateSight, shownExclusions, shownReason } from './shown-reasons';

const EXCLUDED = {
	exited: 3,
	invalidEmail: 0,
	noEmail: 2,
	optedOutArea: 0,
	optedOutOccasion: 0,
	suppressed: 1,
} as const;

describe(shownExclusions, () => {
	it('keeps the exit date for kinds whose exit date the user sees', () => {
		expect(
			shownExclusions(EXCLUDED, { member: 2, partner: 1 }, { member: true, partner: true }),
		).toStrictEqual({ ...EXCLUDED, unavailable: 0 });
	});

	it('counts the exits of kinds the user may not see as unavailable', () => {
		expect(
			shownExclusions(EXCLUDED, { member: 2, partner: 1 }, { member: false, partner: true }),
		).toStrictEqual({ ...EXCLUDED, exited: 1, unavailable: 2 });
		expect(
			shownExclusions(EXCLUDED, { member: 2, partner: 1 }, { member: false, partner: false }),
		).toStrictEqual({ ...EXCLUDED, exited: 0, unavailable: 3 });
	});
});

describe(shownReason, () => {
	it('names an exit only to a user who sees the exit date of the kind', () => {
		const sight = { member: false, partner: true } as const;
		expect(shownReason('exited', 'member', sight)).toBe('unavailable');
		expect(shownReason('exited', 'partner', sight)).toBe('exited');
		expect(shownReason('suppressed', 'member', sight)).toBe('suppressed');
	});
});

describe(exitDateSight, () => {
	it('reads the exit date from the fields the user sees per kind', () => {
		expect(
			exitDateSight({
				canList: true,
				canManage: { member: false, partner: false },
				visible: { member: new Set(['exitDate']), partner: new Set(['birthDate']) },
			}),
		).toStrictEqual({ member: true, partner: false });
	});
});
