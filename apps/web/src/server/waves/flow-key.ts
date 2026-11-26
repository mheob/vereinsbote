/*
 * The key of a send flow (Design 10.5, ruling R19): the `request_id` of the wave a confirmation
 * makes. The server derives it when the flow's page loads, from the user, the occasion and the
 * occasion's newest wave, so every tab one user opened before a confirmation has the same key and
 * a second confirmation finds the wave of the first; the first flow opened after a wave has a new
 * one. It is an HMAC under a key of its own from the app secret (HKDF), written as a UUID, so
 * nobody can make a flow's key without the secret. Pure WebCrypto: it runs on Node and on Workers.
 */
import { desc, eq } from 'drizzle-orm';

import { hkdfParams, importHkdfKey } from '@/server/crypto/secrets';
import type { Db } from '@/server/db/client';
import { waves } from '@/server/db/schema';

/** What a flow's key is made of. */
interface FlowOrigin {
	readonly userId: string;
	readonly occasionId: string;
	/** The occasion's newest wave when the flow opened; null when it has none. */
	readonly newestWaveId: string | null;
}

const FLOW_INFO = 'vereinsbote:send-flow:v1';
const KEY_BITS = 256;
const UUID_BYTES = 16;
/** The byte whose high nibble is the version, and the byte whose high bits are the variant. */
const VERSION_BYTE = 6;
const VARIANT_BYTE = 8;
/** Version 8 (RFC 9562: custom) in the high nibble, above the kept low nibble. */
const VERSION_8 = 128;
const NIBBLE = 16;
/** The variant `10` in the two high bits, above the kept low six bits. */
const VARIANT_RFC = 128;
const SIX_BITS = 64;
const HEX_RADIX = 16;
/** The 32 hex digits of a UUID in their five groups. */
const UUID_GROUPS = /^(?<a>\w{8})(?<b>\w{4})(?<c>\w{4})(?<d>\w{4})(?<e>\w{12})$/u;

const encoder = new TextEncoder();

/**
 * The key of the flow keys: HMAC-SHA256, derived from the app secret with a purpose of its own.
 *
 * @param appSecret The app secret.
 * @returns The key; sign only, not extractable.
 */
async function deriveFlowKey(appSecret: Uint8Array): Promise<CryptoKey> {
	return globalThis.crypto.subtle.deriveKey(
		hkdfParams(FLOW_INFO),
		await importHkdfKey(appSecret, 'deriveKey'),
		{ hash: 'SHA-256', length: KEY_BITS, name: 'HMAC' },
		false,
		['sign'],
	);
}

/**
 * Writes 16 bytes as a UUID of version 8.
 *
 * @param bytes The bytes; changed in place for the version and the variant.
 * @returns The UUID.
 */
function asUuid(bytes: Uint8Array): string {
	bytes[VERSION_BYTE] = ((bytes[VERSION_BYTE] ?? 0) % NIBBLE) + VERSION_8;
	bytes[VARIANT_BYTE] = ((bytes[VARIANT_BYTE] ?? 0) % SIX_BITS) + VARIANT_RFC;
	const hex = [...bytes].map((byte) => byte.toString(HEX_RADIX).padStart(2, '0')).join('');
	return hex.replace(UUID_GROUPS, '$<a>-$<b>-$<c>-$<d>-$<e>');
}

/**
 * The key of a flow: the same for the same user, occasion and newest wave.
 *
 * @param key The key of `deriveFlowKey`.
 * @param flow The user, the occasion and its newest wave.
 * @returns The flow's key, a UUID.
 */
async function flowRequestId(key: CryptoKey, flow: Readonly<FlowOrigin>): Promise<string> {
	// A JSON array keeps the parts apart, whatever characters a user id holds.
	const text = JSON.stringify([flow.userId, flow.occasionId, flow.newestWaveId ?? 'none']);
	const signature = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(text));
	return asUuid(new Uint8Array(signature, 0, UUID_BYTES));
}

/**
 * The key of a flow a user opens now: from the occasion's newest wave.
 *
 * @param db The database.
 * @param key The key of `deriveFlowKey`.
 * @param flow The user and the occasion.
 * @returns The flow's key.
 */
async function currentFlowRequestId(
	db: Db,
	key: CryptoKey,
	flow: Readonly<Omit<FlowOrigin, 'newestWaveId'>>,
): Promise<string> {
	const [newest] = await db
		.select({ id: waves.id })
		.from(waves)
		.where(eq(waves.occasionId, flow.occasionId))
		.orderBy(desc(waves.createdAt), desc(waves.id))
		.limit(1);
	return flowRequestId(key, { ...flow, newestWaveId: newest?.id ?? null });
}

export { currentFlowRequestId, deriveFlowKey, flowRequestId };
export type { FlowOrigin };
