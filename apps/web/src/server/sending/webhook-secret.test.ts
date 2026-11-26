import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vite-plus/test';

import { setUpClub } from '@/server/contacts/testing';
import { mailConnections } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';

import { graphConnection, resendConnection, testKey } from './testing';
import { brokenWebhookSecrets } from './webhook-secret';

describe(brokenWebhookSecrets, () => {
	it('finds the Resend webhook secrets that do not decrypt, by a fingerprint of each', async () => {
		const db = await createTestDb();
		const { admin } = await setUpClub(db);
		await graphConnection(db, admin);
		const healthy = await resendConnection(db, admin, 'Gesund');
		const first = await resendConnection(db, admin, 'Erste');
		const second = await resendConnection(db, admin, 'Zweite');
		const ciphertexts = await db
			.select({ id: mailConnections.id, secret: mailConnections.webhookSecretCiphertext })
			.from(mailConnections);
		const secretOf = new Map(ciphertexts.map(({ id, secret }) => [id, secret]));
		// Each gets the ciphertext of another row: it does not decrypt there.
		await db
			.update(mailConnections)
			.set({ webhookSecretCiphertext: secretOf.get(healthy) })
			.where(eq(mailConnections.id, first));
		await db
			.update(mailConnections)
			.set({ webhookSecretCiphertext: secretOf.get(first) })
			.where(eq(mailConnections.id, second));

		const broken = await brokenWebhookSecrets(db, await testKey());

		expect([...broken.keys()].toSorted()).toStrictEqual([first, second].toSorted());
		// A fingerprint tells stored secrets apart and holds nothing of them.
		expect(new Set(broken.values()).size).toBe(2);
		expect([...broken.values()].every((value) => /^[\da-f]{16}$/u.test(value))).toBe(true);
	});
});
