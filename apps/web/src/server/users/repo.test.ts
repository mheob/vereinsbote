import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { SUPPORTED_LOCALES } from '@/i18n/locale';
import { user } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';

import { findUserByEmail, findUserById, insertUser, setUserLocale } from './repo';

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
