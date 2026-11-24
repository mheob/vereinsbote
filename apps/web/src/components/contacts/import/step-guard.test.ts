import { describe, expect, it } from 'vite-plus/test';

import { createStepGuard } from './step-guard';

describe(createStepGuard, () => {
	it('lets the answer count while the wizard stays on its step', () => {
		const guard = createStepGuard();
		const first = guard.start();
		const second = guard.start();
		expect([first(), second()]).toStrictEqual([true, true]);
	});

	it('drops the answer of a request started before a step change', () => {
		// „Andere Datei wählen“ while the preview of the old file is on its way.
		const guard = createStepGuard();
		const late = guard.start();
		guard.move();
		expect(late()).toBe(false);
		const current = guard.start();
		expect(current()).toBe(true);
		guard.move();
		expect([late(), current()]).toStrictEqual([false, false]);
	});
});
