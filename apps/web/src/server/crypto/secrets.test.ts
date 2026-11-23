import { describe, expect, it } from 'vite-plus/test';

import {
	SecretDecryptError,
	decryptSecret,
	deriveAuthSecret,
	deriveLoginWindowKey,
	deriveSecretsKey,
	encryptSecret,
	hashLoginWindowEmail,
} from './secrets';

const appSecret = new Uint8Array(32).fill(9);
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const otherSecret = new Uint8Array(32).fill(1);

const splitToken = async (key: CryptoKey): Promise<string[]> => {
	const token = await encryptSecret('x', key);
	return token.split('.');
};

describe('secrets', () => {
	it('round-trips text including umlauts', async () => {
		const key = await deriveSecretsKey(appSecret);
		const token = await encryptSecret('Grüße & Geheimnis', key);
		expect(token.startsWith('v1.')).toBe(true);
		await expect(decryptSecret(token, key)).resolves.toBe('Grüße & Geheimnis');
	});

	it('uses a fresh IV for every encryption', async () => {
		const key = await deriveSecretsKey(appSecret);
		const first = await encryptSecret('x', key);
		const second = await encryptSecret('x', key);
		expect(first).not.toBe(second);
	});

	it('rejects tampered ciphertext', async () => {
		const key = await deriveSecretsKey(appSecret);
		const [v = '', iv = '', ct = ''] = await splitToken(key);
		// The first base64url character carries 6 full data bits, so any other character is a real change.
		const first = alphabet.indexOf(ct.charAt(0));
		const flipped = `${alphabet[(first + 1) % alphabet.length]}${ct.slice(1)}`;
		await expect(decryptSecret([v, iv, flipped].join('.'), key)).rejects.toBeInstanceOf(
			SecretDecryptError,
		);
	});

	it('rejects a token encrypted with another key', async () => {
		const token = await encryptSecret('x', await deriveSecretsKey(appSecret));
		const other = await deriveSecretsKey(otherSecret);
		await expect(decryptSecret(token, other)).rejects.toBeInstanceOf(SecretDecryptError);
	});

	it('rejects unknown versions', async () => {
		const key = await deriveSecretsKey(appSecret);
		await expect(decryptSecret('v9.a.b', key)).rejects.toBeInstanceOf(SecretDecryptError);
	});

	it.each([
		['empty token', () => ''],
		['single part', () => 'v1'],
		['two parts', () => 'v1.a'],
		['too many parts', ([v, iv, ct]: readonly string[]) => `${v}.${iv}.${ct}.extra`],
		['invalid IV characters', ([v, , ct]: readonly string[]) => `${v}.!!!.${ct}`],
		['invalid ciphertext characters', ([v, iv]: readonly string[]) => `${v}.${iv}.***`],
		['wrong IV length', ([v, , ct]: readonly string[]) => `${v}.AAAA.${ct}`],
		['padded base64', ([v, iv, ct]: readonly string[]) => `${v}.${iv}=.${ct}`],
	])('rejects malformed token: %s', async (_name, build) => {
		const key = await deriveSecretsKey(appSecret);
		const parts = await splitToken(key);
		await expect(decryptSecret(build(parts), key)).rejects.toBeInstanceOf(SecretDecryptError);
	});

	it('never leaks token or plaintext in the error message', async () => {
		const key = await deriveSecretsKey(appSecret);
		const token = await encryptSecret('top-secret-value', key);
		const other = await deriveSecretsKey(otherSecret);
		// A fixed message that matches in full cannot contain the token or the plaintext.
		await expect(decryptSecret(token, other)).rejects.toThrow(/^Secret could not be decrypted$/u);
	});

	it('derives a stable auth secret per app secret', async () => {
		const first = await deriveAuthSecret(appSecret);
		await expect(deriveAuthSecret(appSecret)).resolves.toBe(first);
		await expect(deriveAuthSecret(otherSecret)).resolves.not.toBe(first);
	});

	it('derives an auth secret of 32 bytes as unpadded base64url', async () => {
		await expect(deriveAuthSecret(appSecret)).resolves.toMatch(/^[\w-]{43}$/u);
	});
});

describe('login window hash', () => {
	it('is deterministic per secret', async () => {
		const first = await deriveLoginWindowKey(appSecret);
		const second = await deriveLoginWindowKey(appSecret);
		const hash = await hashLoginWindowEmail(first, 'anna@verein.de');
		await expect(hashLoginWindowEmail(second, 'anna@verein.de')).resolves.toBe(hash);
	});

	it('differs across secrets and addresses', async () => {
		const key = await deriveLoginWindowKey(appSecret);
		const hash = await hashLoginWindowEmail(key, 'anna@verein.de');
		const otherKey = await deriveLoginWindowKey(otherSecret);
		await expect(hashLoginWindowEmail(otherKey, 'anna@verein.de')).resolves.not.toBe(hash);
		await expect(hashLoginWindowEmail(key, 'kim@verein.de')).resolves.not.toBe(hash);
	});

	it('is the base64url of 32 bytes and hides the address', async () => {
		const key = await deriveLoginWindowKey(appSecret);
		const hash = await hashLoginWindowEmail(key, 'anna@verein.de');
		expect(hash).toMatch(/^[\w-]{43}$/u);
		expect(hash).not.toContain('anna');
	});
});
