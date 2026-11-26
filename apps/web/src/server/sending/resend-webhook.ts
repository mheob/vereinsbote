/*
 * Verifies a Resend webhook (Svix scheme): HMAC-SHA256 over `id.timestamp.body` with the decoded
 * part of the `whsec_…` secret after the prefix; the `svix-signature` header holds one or more
 * `v1,<base64>` signatures separated by spaces. Runs on Node, Vercel and Workers (WebCrypto).
 */

import { z } from 'zod';

import { secretsMatch } from '@/server/crypto/constant-time';

type ResendEvent =
	| {
			readonly id: string;
			readonly type: 'bounce';
			readonly emailId: string;
			readonly hard: boolean;
	  }
	| { readonly id: string; readonly type: 'complaint'; readonly emailId: string }
	| { readonly id: string; readonly type: 'other' };

const WEBHOOK_MAX_BYTES = 65_536;
const WEBHOOK_TOLERANCE_MS = 300_000;
const MS_PER_SECOND = 1000;
const SECRET_PREFIX = 'whsec_';
const SIGNATURE_VERSION = 'v1,';
const TIMESTAMP = /^\d{1,12}$/u;

const encoder = new TextEncoder();

const eventSchema = z.object({
	data: z.looseObject({}).optional(),
	type: z.string(),
});
const emailDataSchema = z.object({ email_id: z.string().min(1) });
const bounceDataSchema = z.object({ bounce: z.object({ type: z.string() }) });

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
	try {
		return Uint8Array.from(atob(value), (char) => char.codePointAt(0) ?? 0);
	} catch {
		return null;
	}
}

function toBase64(bytes: Uint8Array): string {
	return btoa(String.fromCodePoint(...bytes));
}

function encode(content: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array(encoder.encode(content));
}

async function sign(secret: string, content: string): Promise<string | null> {
	const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
	const keyBytes = decodeBase64(raw);
	if (keyBytes === null || keyBytes.length === 0) return null;
	const key = await crypto.subtle.importKey(
		'raw',
		keyBytes,
		{ hash: 'SHA-256', name: 'HMAC' },
		false,
		['sign'],
	);
	const mac = await crypto.subtle.sign('HMAC', key, encode(content));
	return toBase64(new Uint8Array(mac));
}

// Every candidate is compared, so the time does not show which one matched.
async function anySignatureMatches(header: string, expected: string): Promise<boolean> {
	const candidates = header
		.split(' ')
		.filter((part) => part.startsWith(SIGNATURE_VERSION))
		.map((part) => part.slice(SIGNATURE_VERSION.length));
	const results = await Promise.all(
		candidates.map(async (candidate) => secretsMatch(candidate, expected)),
	);
	return results.includes(true);
}

function parseJson(body: string): unknown {
	try {
		return JSON.parse(body) as unknown;
	} catch {
		return null;
	}
}

function bounceEvent(id: string, data: unknown): ResendEvent | null {
	const email = emailDataSchema.safeParse(data);
	const bounce = bounceDataSchema.safeParse(data);
	if (!email.success || !bounce.success) return null;
	// Only a permanent bounce is hard; transient and undetermined ones are soft.
	return {
		emailId: email.data.email_id,
		hard: bounce.data.bounce.type === 'Permanent',
		id,
		type: 'bounce',
	};
}

function readEvent(id: string, body: string): ResendEvent | null {
	const event = eventSchema.safeParse(parseJson(body));
	if (!event.success) return null;
	const { data, type } = event.data;
	if (type === 'email.bounced') return bounceEvent(id, data);
	if (type !== 'email.complained') return { id, type: 'other' };
	const email = emailDataSchema.safeParse(data);
	return email.success ? { emailId: email.data.email_id, id, type: 'complaint' } : null;
}

function withinTolerance(timestamp: string, now: Date): boolean {
	const sentAt = Number(timestamp) * MS_PER_SECOND;
	return Math.abs(now.getTime() - sentAt) <= WEBHOOK_TOLERANCE_MS;
}

/**
 * Checks the signature, the time and the size of a webhook and reads the event.
 *
 * @param secret The webhook secret (`whsec_…`).
 * @param headers The request headers.
 * @param body The raw request body.
 * @param now The current time.
 * @returns The event, or `null` when the signature, the time or the form is wrong.
 */
// oxlint-disable-next-line max-params -- the signature is fixed by the plan
async function verifyResendWebhook(
	secret: string,
	headers: Headers,
	body: string,
	now: Date,
): Promise<ResendEvent | null> {
	if (encoder.encode(body).length > WEBHOOK_MAX_BYTES) return null;
	const id = headers.get('svix-id') ?? '';
	const timestamp = headers.get('svix-timestamp') ?? '';
	const signatures = headers.get('svix-signature') ?? '';
	if (id === '' || signatures === '' || !TIMESTAMP.test(timestamp)) return null;
	if (!withinTolerance(timestamp, now)) return null;
	const expected = await sign(secret, `${id}.${timestamp}.${body}`);
	if (expected === null || !(await anySignatureMatches(signatures, expected))) return null;
	return readEvent(id, body);
}

export { verifyResendWebhook, WEBHOOK_MAX_BYTES, WEBHOOK_TOLERANCE_MS };
export type { ResendEvent };
