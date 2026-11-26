import { describe, expect, it } from 'vite-plus/test';

import {
	verifyResendWebhook,
	WEBHOOK_MAX_BYTES,
	WEBHOOK_TOLERANCE_MS,
} from '@/server/sending/resend-webhook';

const KEY_BYTES = new Uint8Array(24).map((_, index) => index + 7);
const SECRET = `whsec_${btoa(String.fromCodePoint(...KEY_BYTES))}`;
const NOW = new Date('2026-11-25T10:00:00Z');
const SECONDS = Math.floor(NOW.getTime() / 1000);
const ID = 'msg_invented_1';

async function signature(content: string, keyBytes = KEY_BYTES): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		keyBytes,
		{ hash: 'SHA-256', name: 'HMAC' },
		false,
		['sign'],
	);
	const mac = new Uint8Array(
		await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(content)),
	);
	return `v1,${btoa(String.fromCodePoint(...mac))}`;
}

async function signed(
	body: string,
	timestamp = SECONDS,
	extra: readonly string[] = [],
): Promise<Headers> {
	const own = await signature(`${ID}.${timestamp}.${body}`);
	return new Headers({
		'svix-id': ID,
		'svix-signature': [...extra, own].join(' '),
		'svix-timestamp': String(timestamp),
	});
}

function bounce(type: string): string {
	return JSON.stringify({
		data: { bounce: { subType: 'General', type }, email_id: 'em-1' },
		type: 'email.bounced',
	});
}

async function verify(
	body: string,
	options: Readonly<{ timestamp?: number; extra?: readonly string[] }> = {},
): Promise<Awaited<ReturnType<typeof verifyResendWebhook>>> {
	const headers = await signed(body, options.timestamp, options.extra);
	return verifyResendWebhook(SECRET, headers, body, NOW);
}

describe(verifyResendWebhook, () => {
	it('accepts a correctly signed bounce and reads hard and soft', async () => {
		await expect(verify(bounce('Permanent'))).resolves.toStrictEqual({
			emailId: 'em-1',
			hard: true,
			id: ID,
			type: 'bounce',
		});
		await expect(verify(bounce('Transient'))).resolves.toMatchObject({ hard: false });
		await expect(verify(bounce('Undetermined'))).resolves.toMatchObject({ hard: false });
	});

	it('reads a complaint', async () => {
		const body = JSON.stringify({ data: { email_id: 'em-2' }, type: 'email.complained' });
		await expect(verify(body)).resolves.toStrictEqual({
			emailId: 'em-2',
			id: ID,
			type: 'complaint',
		});
	});

	it('accepts any of several signatures', async () => {
		const body = bounce('Permanent');
		const wrong = await signature(`${ID}.${SECONDS}.${body}`, new Uint8Array(24));
		await expect(verify(body, { extra: [wrong, 'v2,abc'] })).resolves.not.toBeNull();
		const headers = await signed(body);
		headers.set('svix-signature', `${headers.get('svix-signature')} ${wrong}`);
		await expect(verifyResendWebhook(SECRET, headers, body, NOW)).resolves.not.toBeNull();
	});

	it('refuses a wrong signature', async () => {
		const body = bounce('Permanent');
		const headers = await signed(body);
		headers.set('svix-signature', await signature('other'));
		await expect(verifyResendWebhook(SECRET, headers, body, NOW)).resolves.toBeNull();
		await expect(
			verifyResendWebhook(SECRET, await signed(`${body} `), body, NOW),
		).resolves.toBeNull();
	});

	it('refuses a timestamp more than five minutes off in either direction', async () => {
		const body = bounce('Permanent');
		const tolerance = WEBHOOK_TOLERANCE_MS / 1000;
		await expect(verify(body, { timestamp: SECONDS - tolerance - 1 })).resolves.toBeNull();
		await expect(verify(body, { timestamp: SECONDS + tolerance + 1 })).resolves.toBeNull();
		await expect(verify(body, { timestamp: SECONDS - tolerance })).resolves.not.toBeNull();
	});

	it('refuses a body over 64 KiB, measured in bytes', async () => {
		const big = JSON.stringify({ data: { pad: 'ä'.repeat(WEBHOOK_MAX_BYTES / 2) }, type: 'x' });
		expect(new TextEncoder().encode(big).length).toBeGreaterThan(WEBHOOK_MAX_BYTES);
		expect(big.length).toBeLessThan(WEBHOOK_MAX_BYTES);
		await expect(verify(big)).resolves.toBeNull();
	});

	it('refuses missing headers, a bad timestamp and a wrong secret', async () => {
		const body = bounce('Permanent');
		await expect(verifyResendWebhook(SECRET, new Headers(), body, NOW)).resolves.toBeNull();
		const bad = await signed(body);
		bad.set('svix-timestamp', 'abc');
		await expect(verifyResendWebhook(SECRET, bad, body, NOW)).resolves.toBeNull();
		const other = `whsec_${btoa('different-key-bytes-here')}`;
		await expect(verifyResendWebhook(other, await signed(body), body, NOW)).resolves.toBeNull();
		await expect(
			verifyResendWebhook('whsec_!!!', await signed(body), body, NOW),
		).resolves.toBeNull();
	});

	it('maps unknown event types to other', async () => {
		const body = JSON.stringify({ data: {}, type: 'email.delivered' });
		await expect(verify(body)).resolves.toStrictEqual({ id: ID, type: 'other' });
	});

	it.each(['not json', '[]', JSON.stringify({ data: {}, type: 'email.bounced' })])(
		'refuses a signed body of the wrong form: %s',
		async (body) => {
			await expect(verify(body)).resolves.toBeNull();
		},
	);
});
