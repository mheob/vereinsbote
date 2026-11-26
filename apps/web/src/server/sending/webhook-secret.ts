/*
 * The webhook secrets of Resend connections that do not decrypt (ruling R16), e.g. after
 * `APP_SECRET` changed and only the API key was entered anew. Such a connection is not disturbed:
 * sending uses the API key. Its webhook refuses every event (401) until an admin saves the secret
 * anew; the sending warnings tell the admins once per stored secret, and the overview shows it.
 */
import { and, eq, isNotNull } from 'drizzle-orm';

import { decryptSecret, SecretDecryptError, secretAad } from '@/server/crypto/secrets';
import type { Db } from '@/server/db/client';
import { mailConnections } from '@/server/db/schema';

/** Hex digits of a fingerprint: enough to tell stored secrets apart. */
const FINGERPRINT_LENGTH = 16;
const HEX = 16;
const BYTE_DIGITS = 2;

const encoder = new TextEncoder();

/**
 * A fingerprint of a stored ciphertext: the start of its SHA-256, which holds nothing of the
 * secret and changes whenever a secret is saved.
 *
 * @param ciphertext The stored ciphertext.
 * @returns Sixteen hex digits.
 */
async function fingerprint(ciphertext: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(ciphertext)));
	const hex = [...digest].map((byte) => byte.toString(HEX).padStart(BYTE_DIGITS, '0')).join('');
	return hex.slice(0, FINGERPRINT_LENGTH);
}

/**
 * Whether a connection's webhook secret decrypts.
 *
 * @param ciphertext The stored ciphertext.
 * @param key The key of the secrets.
 * @param connectionId The connection, part of the associated data.
 * @returns False when it does not.
 * @throws {Error} Anything but a `SecretDecryptError`.
 */
async function decrypts(
	ciphertext: string,
	key: CryptoKey,
	connectionId: string,
): Promise<boolean> {
	try {
		const aad = secretAad('mail_connections', connectionId, 'webhook_secret_ciphertext');
		await decryptSecret(ciphertext, key, aad);
		return true;
	} catch (error) {
		if (error instanceof SecretDecryptError) return false;
		throw error;
	}
}

/**
 * The Resend connections whose stored webhook secret does not decrypt.
 *
 * @param db The database.
 * @param key The key of the secrets (`deriveSecretsKey`).
 * @returns A fingerprint of the stored secret per connection id.
 */
async function brokenWebhookSecrets(db: Db, key: CryptoKey): Promise<Map<string, string>> {
	const rows = await db
		.select({ ciphertext: mailConnections.webhookSecretCiphertext, id: mailConnections.id })
		.from(mailConnections)
		.where(
			and(eq(mailConnections.kind, 'resend'), isNotNull(mailConnections.webhookSecretCiphertext)),
		);
	const broken = new Map<string, string>();
	for (const { ciphertext, id } of rows) {
		// oxlint-disable-next-line no-await-in-loop -- one secret after another
		if (ciphertext !== null && !(await decrypts(ciphertext, key, id))) {
			// oxlint-disable-next-line no-await-in-loop -- see above
			broken.set(id, await fingerprint(ciphertext));
		}
	}
	return broken;
}

export { brokenWebhookSecrets };
