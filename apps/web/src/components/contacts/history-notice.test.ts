import { describe, expect, it } from 'vite-plus/test';

import { clearHistoryNotice } from './history-notice';

/** A history entry with its state, as `window.history` keeps it. */
class FakeHistory {
	public readonly replaced: unknown[] = [];

	public constructor(public state: unknown) {}

	public replaceState(state: unknown): void {
		this.state = state;
		this.replaced.push(state);
	}
}

describe(clearHistoryNotice, () => {
	it('removes the notice and keeps the router keys of the entry', () => {
		const history = new FakeHistory({
			__TSR_index: 3,
			__TSR_key: 'abc',
			deletedContact: 'Sportpresse Nord',
			key: 'abc',
		});
		clearHistoryNotice(history, 'deletedContact');
		expect(history.state).toStrictEqual({ __TSR_index: 3, __TSR_key: 'abc', key: 'abc' });
	});

	it('leaves an entry without the notice alone', () => {
		const history = new FakeHistory({ __TSR_index: 1, partnerSaved: true });
		clearHistoryNotice(history, 'deletedContact');
		const empty = new FakeHistory(null);
		clearHistoryNotice(empty, 'partnerSaved');
		expect([history.replaced, empty.replaced]).toStrictEqual([[], []]);
	});
});
