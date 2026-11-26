/*
 * The token of an unsubscribe link (Design 12): the contacts of a mail (kind and key, every merged
 * contact of a circular), its occasion and its area, encrypted and authenticated with AES-GCM
 * (additional data `unsubscribe`) and written as base64url. It never expires and hangs on no outbox
 * entry, so it still works after the entries are deleted; it names no member number in clear, and a
 * changed or invented token does not open.
 *
 * The key comes from the app secret through HKDF with a purpose of its own; two keys come from it,
 * one for AES-GCM and one for the IV. The IV is synthetic: an HMAC of the payload. The same payload
 * therefore always seals to the same token, so a mail that is tried again carries the same link and
 * the same content (a Resend retry must repeat its payload to its idempotency key, ruling R4), and
 * two different payloads never share an IV. Pure WebCrypto: it runs on Node and on Workers.
 */
import { z } from 'zod';

import type { ContactKind } from '@/server/contacts/fields';
import { fromBase64Url, hkdfParams, importHkdfKey, toBase64Url } from '@/server/crypto/secrets';

/** Who a link unsubscribes, and from which occasion and area. */
interface UnsubscribePayload {
	readonly contacts: readonly { readonly kind: ContactKind; readonly key: string }[];
	readonly occasionId: string;
	readonly areaId: string;
}

const UNSUBSCRIBE_INFO = 'vereinsbote:unsubscribe:v1';
const ENCRYPTION_INFO = `${UNSUBSCRIBE_INFO}:aes-gcm`;
const IV_INFO = `${UNSUBSCRIBE_INFO}:iv`;
const AAD = new TextEncoder().encode('unsubscribe');
const KEY_BITS = 256;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Longer tokens are refused unread; a mail's token stays far below (Design 12). */
const MAX_TOKEN_LENGTH = 4096;
const BASE64_GROUP_BYTES = 3;
const BASE64_GROUP_CHARACTERS = 4;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** The kinds as one letter each, to keep the token short. */
const KIND_LETTERS: Readonly<Record<ContactKind, 'm' | 'p'>> = { member: 'm', partner: 'p' };

/** A contact in the sealed text: `[kind letter, key]`. */
const sealedContactSchema = z.tuple([z.enum(['m', 'p']), z.string().min(1)]);

/** The sealed text: the occasion, the area and the contacts. */
const sealedSchema = z
	.object({ a: z.guid(), c: z.array(sealedContactSchema).min(1), o: z.guid() })
	.strict();

/**
 * The text a payload seals to, always in the same order.
 *
 * @param payload The payload.
 * @returns The JSON text.
 */
function serialize(payload: Readonly<UnsubscribePayload>): string {
	return JSON.stringify({
		a: payload.areaId,
		c: payload.contacts.map(({ key, kind }) => [KIND_LETTERS[kind], key]),
		o: payload.occasionId,
	});
}

/**
 * Parses JSON text.
 *
 * @param text The text.
 * @returns The value, or undefined when the text is no JSON.
 */
function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * Reads a sealed text.
 *
 * @param text The JSON text.
 * @returns The payload, or null when it is none.
 */
function deserialize(text: string): UnsubscribePayload | null {
	const parsed = sealedSchema.safeParse(parseJson(text));
	if (!parsed.success) return null;
	const { a, c, o } = parsed.data;
	return {
		areaId: a,
		contacts: c.map(([letter, key]) => ({ key, kind: letter === 'm' ? 'member' : 'partner' })),
		occasionId: o,
	};
}

/**
 * The payload of a mail: its occasion and area, and each of its contacts once, in their order.
 * Partners without a customer number who share an address share their key, too.
 *
 * @param target The occasion and the area.
 * @param target.occasionId The occasion.
 * @param target.areaId Its area.
 * @param contacts The contacts of the mail with their kind and key.
 * @returns The payload.
 */
function unsubscribePayload(
	target: Readonly<{ occasionId: string; areaId: string }>,
	contacts: readonly Readonly<{ kind: ContactKind; contactKey: string }>[],
): UnsubscribePayload {
	const seen = new Set<string>();
	const named: { kind: ContactKind; key: string }[] = [];
	for (const { contactKey, kind } of contacts) {
		const id = `${kind}/${contactKey}`;
		if (!seen.has(id)) {
			seen.add(id);
			named.push({ key: contactKey, kind });
		}
	}
	return { areaId: target.areaId, contacts: named, occasionId: target.occasionId };
}

/**
 * The key of the unsubscribe tokens: HKDF of the app secret with a purpose of its own. It only
 * derives the two keys that seal and open; it is not extractable.
 *
 * @param appSecret The app secret.
 * @returns The key.
 */
async function deriveUnsubscribeKey(appSecret: Uint8Array): Promise<CryptoKey> {
	const bits = await globalThis.crypto.subtle.deriveBits(
		hkdfParams(UNSUBSCRIBE_INFO),
		await importHkdfKey(appSecret, 'deriveBits'),
		KEY_BITS,
	);
	return globalThis.crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
}

/**
 * The two keys that come from the key of the tokens: AES-GCM, and HMAC for the synthetic IV.
 *
 * @param key The key of `deriveUnsubscribeKey`.
 * @returns Both keys.
 */
async function tokenKeys(key: CryptoKey): Promise<{ encryption: CryptoKey; iv: CryptoKey }> {
	const { subtle } = globalThis.crypto;
	const [encryption, iv] = await Promise.all([
		subtle.deriveKey(
			hkdfParams(ENCRYPTION_INFO),
			key,
			{ length: KEY_BITS, name: 'AES-GCM' },
			false,
			['encrypt', 'decrypt'],
		),
		subtle.deriveKey(
			hkdfParams(IV_INFO),
			key,
			{ hash: 'SHA-256', length: KEY_BITS, name: 'HMAC' },
			false,
			['sign'],
		),
	]);
	return { encryption, iv };
}

/**
 * Seals a payload: AES-GCM with the additional data `unsubscribe` and an IV made from the payload,
 * then IV and ciphertext together as base64url. The same payload gives the same token.
 *
 * @param key The key of `deriveUnsubscribeKey`.
 * @param payload The contacts, the occasion and the area.
 * @returns The token: base64url only, never `test`.
 */
async function sealUnsubscribe(
	key: CryptoKey,
	payload: Readonly<UnsubscribePayload>,
): Promise<string> {
	const { subtle } = globalThis.crypto;
	const keys = await tokenKeys(key);
	const plaintext = encoder.encode(serialize(payload));
	const iv = new Uint8Array(await subtle.sign('HMAC', keys.iv, plaintext)).slice(0, IV_BYTES);
	const ciphertext = await subtle.encrypt(
		{ additionalData: AAD, iv, name: 'AES-GCM' },
		keys.encryption,
		plaintext,
	);
	const sealed = new Uint8Array(IV_BYTES + ciphertext.byteLength);
	sealed.set(iv);
	sealed.set(new Uint8Array(ciphertext), IV_BYTES);
	return toBase64Url(sealed);
}

/**
 * Opens a token. Any failure (another key, a changed character, a cut token, no token at all) is
 * the same `null`; nothing tells why.
 *
 * @param key The key of `deriveUnsubscribeKey`.
 * @param token The token of the link.
 * @returns The payload, or null.
 */
async function openUnsubscribe(key: CryptoKey, token: string): Promise<UnsubscribePayload | null> {
	if (token.length > MAX_TOKEN_LENGTH) return null;
	try {
		const sealed = fromBase64Url(token);
		if (sealed.length <= IV_BYTES + TAG_BYTES) return null;
		const keys = await tokenKeys(key);
		const plaintext = await globalThis.crypto.subtle.decrypt(
			{ additionalData: AAD, iv: sealed.slice(0, IV_BYTES), name: 'AES-GCM' },
			keys.encryption,
			sealed.slice(IV_BYTES),
		);
		return deserialize(decoder.decode(plaintext));
	} catch {
		return null;
	}
}

/**
 * The length of the token a payload seals to, without sealing it: base64url of the IV, the
 * ciphertext (as long as the text) and the tag.
 *
 * @param payload The payload.
 * @returns The number of characters.
 */
function unsubscribeTokenLength(payload: Readonly<UnsubscribePayload>): number {
	const bytes = IV_BYTES + encoder.encode(serialize(payload)).length + TAG_BYTES;
	return Math.ceil((bytes * BASE64_GROUP_CHARACTERS) / BASE64_GROUP_BYTES);
}

export {
	deriveUnsubscribeKey,
	openUnsubscribe,
	sealUnsubscribe,
	unsubscribePayload,
	unsubscribeTokenLength,
};
export type { UnsubscribePayload };
