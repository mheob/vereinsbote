/*
 * The undo value of an unsubscribe (Design 12): which opt-outs it made, for which scope and target,
 * and when. The unsubscribe page gets it sealed and hands it back to undo within 30 minutes. It is
 * sealed with AES-GCM (`encryptSecret`, additional data `unsubscribe-undo`) under a key of its own,
 * derived from the app secret through HKDF with a purpose other than the unsubscribe token's: an
 * undo value never opens as a token, nor the other way round. Pure WebCrypto: Node and Workers.
 */
import { z } from 'zod';

import type { ContactKind } from '@/server/contacts/fields';
import type { OptOutScope } from '@/server/contacts/suppressions';
import {
	decryptSecret,
	encryptSecret,
	hkdfParams,
	importHkdfKey,
	SecretDecryptError,
} from '@/server/crypto/secrets';

/** An unsubscribe as its undo needs it. */
interface UndoRecord {
	readonly scope: OptOutScope;
	/** The occasion or the area. */
	readonly targetId: string;
	/** The opt-outs the unsubscribe made, by id, with the kind of their contact. */
	readonly optOuts: readonly Readonly<{ id: string; kind: ContactKind }>[];
	readonly at: Date;
}

const UNDO_INFO = 'vereinsbote:unsubscribe-undo:v1';
const UNDO_AAD = 'unsubscribe-undo';
const KEY_BITS = 256;

const KIND_LETTERS: Readonly<Record<ContactKind, 'm' | 'p'>> = { member: 'm', partner: 'p' };

/** An opt-out in the sealed text: `[id, kind letter]`. */
const sealedOptOutSchema = z.tuple([z.guid(), z.enum(['m', 'p'])]);

/** The sealed text: scope, target, opt-outs, time in milliseconds. */
const sealedSchema = z
	.object({
		at: z.int().nonnegative(),
		o: z.array(sealedOptOutSchema),
		s: z.enum(['area', 'occasion']),
		t: z.guid(),
	})
	.strict();

/**
 * The key of the undo values: AES-GCM, derived from the app secret with a purpose of its own.
 *
 * @param appSecret The app secret.
 * @returns The key; not extractable.
 */
async function deriveUndoKey(appSecret: Uint8Array): Promise<CryptoKey> {
	return globalThis.crypto.subtle.deriveKey(
		hkdfParams(UNDO_INFO),
		await importHkdfKey(appSecret, 'deriveKey'),
		{ length: KEY_BITS, name: 'AES-GCM' },
		false,
		['encrypt', 'decrypt'],
	);
}

/**
 * Seals the record of an unsubscribe.
 *
 * @param key The key of `deriveUndoKey`.
 * @param record What the unsubscribe made.
 * @returns The undo value.
 */
async function sealUndo(key: CryptoKey, record: Readonly<UndoRecord>): Promise<string> {
	const text = JSON.stringify({
		at: record.at.getTime(),
		o: record.optOuts.map(({ id, kind }) => [id, KIND_LETTERS[kind]]),
		s: record.scope,
		t: record.targetId,
	});
	return encryptSecret(text, key, UNDO_AAD);
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
 * Opens an undo value. Anything that does not open (another key, a changed character, no undo
 * value at all) is the same `null`.
 *
 * @param key The key of `deriveUndoKey`.
 * @param undo The undo value.
 * @returns The record, or null.
 */
async function openUndo(key: CryptoKey, undo: string): Promise<UndoRecord | null> {
	const text = await decryptSecret(undo, key, UNDO_AAD).catch((error: unknown) => {
		if (error instanceof SecretDecryptError) return null;
		throw error;
	});
	if (text === null) return null;
	const parsed = sealedSchema.safeParse(parseJson(text));
	if (!parsed.success) return null;
	const { at, o, s, t } = parsed.data;
	return {
		at: new Date(at),
		optOuts: o.map(([id, letter]) => ({ id, kind: letter === 'm' ? 'member' : 'partner' })),
		scope: s,
		targetId: t,
	};
}

export { deriveUndoKey, openUndo, sealUndo };
export type { UndoRecord };
