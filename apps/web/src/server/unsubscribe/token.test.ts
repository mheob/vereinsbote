import { describe, expect, it } from 'vite-plus/test';

import {
	deriveUnsubscribeKey,
	MAX_TOKEN_LENGTH,
	openUnsubscribe,
	sealUnsubscribe,
	unsubscribePayload,
	unsubscribeTokenLength,
} from './token';
import type { UnsubscribePayload } from './token';

const APP_SECRET = new Uint8Array(32).fill(9);
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const OTHER_SECRET = new Uint8Array(32).fill(1);

const PAYLOAD: UnsubscribePayload = {
	areaId: '00000000-0000-4000-8000-0000000000a1',
	contacts: [
		{ key: 'nr:4711', kind: 'member' },
		{ key: 'email:familie@example.org', kind: 'partner' },
	],
	occasionId: '00000000-0000-4000-8000-0000000000b2',
};

/** The ways a token can be wrong. */
type Tampering =
	| 'changed'
	| 'cut'
	| 'empty'
	| 'extended'
	| 'foreign'
	| 'no base64url'
	| 'test'
	| 'too long';

/**
 * A token made wrong.
 *
 * @param how How.
 * @param token A valid token.
 * @param foreign The same payload sealed under another app secret.
 * @returns The wrong token.
 */
function tampered(how: Tampering, token: string, foreign: string): string {
	const tampers: Record<Tampering, () => string> = {
		changed: () => `${token.slice(0, 20)}${token[20] === 'A' ? 'B' : 'A'}${token.slice(21)}`,
		cut: () => token.slice(0, -2),
		empty: () => '',
		extended: () => `${token}AA`,
		foreign: () => foreign,
		'no base64url': () => 'not a token!',
		test: () => 'test',
		'too long': () => 'A'.repeat(10_000),
	};
	return tampers[how]();
}

/**
 * The bytes of a base64url token as Latin-1 text, to look for clear text in it.
 *
 * @param token The token.
 * @returns The decoded bytes, one character each.
 */
function decoded(token: string): string {
	const padded = token.replaceAll('-', '+').replaceAll('_', '/');
	return atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
}

describe('the unsubscribe token', () => {
	it('round-trips and hides the member number', async () => {
		const key = await deriveUnsubscribeKey(APP_SECRET);
		const token = await sealUnsubscribe(key, PAYLOAD);
		expect(token).toMatch(/^[\w-]{40,}$/u);
		expect(decoded(token)).not.toMatch(/nr:|4711|familie/u);
		await expect(openUnsubscribe(key, token)).resolves.toStrictEqual(PAYLOAD);
	});

	it('seals the same payload to the same token, so a retried mail keeps its link', async () => {
		const key = await deriveUnsubscribeKey(APP_SECRET);
		const token = await sealUnsubscribe(key, PAYLOAD);
		await expect(sealUnsubscribe(key, PAYLOAD)).resolves.toBe(token);
		const fewer = { ...PAYLOAD, contacts: PAYLOAD.contacts.slice(0, 1) };
		await expect(sealUnsubscribe(key, fewer)).resolves.not.toBe(token);
	});

	it('refuses a token whose unused last bits are set, so one payload has one token', async () => {
		const key = await deriveUnsubscribeKey(APP_SECRET);
		// Plaintexts one byte apart: at least two of the three tokens do not fill their last group.
		const tokens = await Promise.all(
			['1', '22', '333'].map(async (number) =>
				sealUnsubscribe(key, { ...PAYLOAD, contacts: [{ key: `nr:${number}`, kind: 'member' }] }),
			),
		);
		const token = String(tokens.find((each) => each.length % 4 !== 0));
		await expect(openUnsubscribe(key, token)).resolves.not.toBeNull();
		// The last character carries unused low bits, all 0; setting one keeps the bytes.
		const last = BASE64URL.indexOf(token.slice(-1));
		const nonCanonical = `${token.slice(0, -1)}${BASE64URL.charAt(last + 1)}`;
		await expect(openUnsubscribe(key, nonCanonical)).resolves.toBeNull();
	});

	it.each<Tampering>([
		'changed',
		'cut',
		'extended',
		'foreign',
		'test',
		'empty',
		'no base64url',
		'too long',
	])('refuses a changed or foreign token: %s', async (how) => {
		const key = await deriveUnsubscribeKey(APP_SECRET);
		const token = await sealUnsubscribe(key, PAYLOAD);
		const foreign = await sealUnsubscribe(await deriveUnsubscribeKey(OTHER_SECRET), PAYLOAD);
		await expect(openUnsubscribe(key, tampered(how, token, foreign))).resolves.toBeNull();
	});

	it('names every contact once and tells the length of its token in advance', async () => {
		const key = await deriveUnsubscribeKey(APP_SECRET);
		const payload = unsubscribePayload({ areaId: PAYLOAD.areaId, occasionId: PAYLOAD.occasionId }, [
			{ contactKey: 'email:familie@example.org', kind: 'partner' },
			{ contactKey: 'nr:4711', kind: 'member' },
			{ contactKey: 'email:familie@example.org', kind: 'partner' },
		]);
		expect(payload.contacts).toStrictEqual([
			{ key: 'email:familie@example.org', kind: 'partner' },
			{ key: 'nr:4711', kind: 'member' },
		]);
		const token = await sealUnsubscribe(key, payload);
		expect(unsubscribeTokenLength(payload)).toBe(token.length);
	});

	it('names the contacts of a mail as long as the token stays within its bound, and opens it', async () => {
		const key = await deriveUnsubscribeKey(APP_SECRET);
		const many = Array.from({ length: 400 }, (_unused, index) => ({
			contactKey: `nr:${String(index).padStart(8, '0')}`,
			kind: 'member' as const,
		}));
		const payload = unsubscribePayload(
			{ areaId: PAYLOAD.areaId, occasionId: PAYLOAD.occasionId },
			many,
		);
		const token = await sealUnsubscribe(key, payload);
		expect(token.length).toBeLessThanOrEqual(MAX_TOKEN_LENGTH);
		await expect(openUnsubscribe(key, token)).resolves.toStrictEqual(payload);
		// The first contacts in their order; one more would not fit.
		expect(payload.contacts).toStrictEqual(
			many.slice(0, payload.contacts.length).map(({ contactKey }) => ({
				key: contactKey,
				kind: 'member',
			})),
		);
		const oneMore = {
			...payload,
			contacts: many
				.slice(0, payload.contacts.length + 1)
				.map(({ contactKey }) => ({ key: contactKey, kind: 'member' as const })),
		};
		expect(unsubscribeTokenLength(oneMore)).toBeGreaterThan(MAX_TOKEN_LENGTH);
		await expect(sealUnsubscribe(key, oneMore)).rejects.toThrow(RangeError);
	});
});
