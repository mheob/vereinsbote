import { describe, expect, it } from 'vite-plus/test';

import { contactBounces } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';

import { isEmailInvalid } from './bounces';

const ANNA = { contactKey: 'nr:7', email: 'anna@example.org', kind: 'member' } as const;

describe(isEmailInvalid, () => {
	it.each([
		['the address that bounced', ANNA, true],
		['the address as typed', { ...ANNA, email: ' Anna@Example.org' }, true],
		// An import brought another address: the mark no longer applies.
		['another address', { ...ANNA, email: 'anna.neu@example.org' }, false],
		['the other kind', { ...ANNA, kind: 'partner' }, false],
		['another key', { ...ANNA, contactKey: 'nr:8' }, false],
		['no address', { ...ANNA, email: null }, false],
	] as const)('checks %s', async (_case, contact, invalid) => {
		const db = await createTestDb();
		await db.insert(contactBounces).values({ ...ANNA, source: 'graph' });
		await expect(isEmailInvalid(db, contact)).resolves.toBe(invalid);
	});
});
