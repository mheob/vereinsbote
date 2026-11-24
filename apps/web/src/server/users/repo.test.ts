import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { SUPPORTED_LOCALES } from '@/i18n/locale';
import { user } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';

import { findUserByEmail, findUserById, insertUser, recordSignIn, setUserLocale } from './repo';

describe('user locale', () => {
	it('stores every supported locale', async () => {
		const db = await createTestDb();
		for (const locale of SUPPORTED_LOCALES) {
			// oxlint-disable-next-line no-await-in-loop -- one user after the other on the single test connection
			const { id } = await insertUser(db, { email: `${locale}@verein.de`, locale, name: locale });
			// oxlint-disable-next-line no-await-in-loop -- see above
			await expect(findUserById(db, id)).resolves.toMatchObject({ locale });
		}
	});

	it('rejects an unsupported locale in the database', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
		await expect(
			db.execute(sql`update ${user} set locale = 'fr' where ${user.id} = ${id}`),
		).rejects.toThrow();
		await expect(findUserByEmail(db, 'anna@verein.de')).resolves.toMatchObject({ locale: 'de' });
	});

	describe(setUserLocale, () => {
		it('changes the locale of one user only', async () => {
			const db = await createTestDb();
			const anna = await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
			const kim = await insertUser(db, { email: 'kim@verein.de', name: 'Kim' });
			await setUserLocale(db, anna.id, 'en');
			await expect(findUserById(db, anna.id)).resolves.toMatchObject({ locale: 'en' });
			await expect(findUserById(db, kim.id)).resolves.toMatchObject({ locale: 'de' });
			const [row] = await db.select({ locale: user.locale }).from(user).where(eq(user.id, anna.id));
			expect(row).toStrictEqual({ locale: 'en' });
		});
	});
});

/**
 * The status and the first sign-in of a user.
 *
 * @param db The database.
 * @param id The user id.
 * @returns The row.
 */
async function signInState(
	db: Awaited<ReturnType<typeof createTestDb>>,
	id: string,
): Promise<{ firstSignInAt: Date | null; status: string } | undefined> {
	const [row] = await db
		.select({ firstSignInAt: user.firstSignInAt, status: user.status })
		.from(user)
		.where(eq(user.id, id));
	return row;
}

describe(recordSignIn, () => {
	it('activates an invited user and keeps the time of the first sign-in', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, { email: 'anna@verein.de', name: 'Anna' });
		await expect(signInState(db, id)).resolves.toStrictEqual({
			firstSignInAt: null,
			status: 'invited',
		});
		await recordSignIn(db, id);
		const first = await signInState(db, id);
		expect(first?.status).toBe('active');
		expect(first?.firstSignInAt).toBeInstanceOf(Date);
		await recordSignIn(db, id);
		await expect(signInState(db, id)).resolves.toStrictEqual(first);
	});

	it('records the first sign-in of a user who is active already (the setup admin)', async () => {
		const db = await createTestDb();
		const { id } = await insertUser(db, { email: 'alex@verein.de', name: 'A', status: 'active' });
		await recordSignIn(db, id);
		const state = await signInState(db, id);
		expect(state?.status).toBe('active');
		expect(state?.firstSignInAt).toBeInstanceOf(Date);
	});
});
