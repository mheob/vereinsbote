import { setUpClub, userWith } from '@/server/contacts/testing';
/* oxlint-disable no-magic-numbers -- the bytes are the signatures of the file formats */
/*
 * Files and fixtures for the attachment tests. For tests only.
 */
import type { Db } from '@/server/db/client';
import { createTestDb } from '@/server/db/test-db';
import { insertOccasion } from '@/server/occasions/testing';
import type { Principal } from '@/server/permissions/principal';
import { createMemoryStorage } from '@/server/storage/memory';
import type { ObjectStorage } from '@/server/storage/storage';

const PDF_SIGNATURE = [37, 80, 68, 70, 45, 49];

/**
 * The bytes of a file that starts like a PDF.
 *
 * @param length The length of the file.
 * @returns The bytes.
 */
function pdfBytes(length = 100): Uint8Array {
	const bytes = new Uint8Array(Math.max(length, PDF_SIGNATURE.length));
	bytes.set(PDF_SIGNATURE);
	return bytes;
}

/**
 * The bytes of a text, one byte per character (Latin-1).
 *
 * @param text The text.
 * @returns The bytes.
 */
function bytesOf(text: string): Uint8Array {
	return Uint8Array.from(text, (character) => character.codePointAt(0) ?? 0);
}

interface AttachmentsFixture {
	readonly admin: Principal;
	readonly db: Db;
	readonly membersAreaId: string;
	readonly occasionId: string;
	readonly partnersAreaId: string;
	/** `send` in "Mitglieder". */
	readonly sender: Principal;
	readonly storage: ObjectStorage;
}

/**
 * A club with an occasion in "Mitglieder", and a user who may send there.
 *
 * @returns The database, a memory storage, the area, the occasion and the users.
 */
async function setUpAttachments(): Promise<AttachmentsFixture> {
	const db = await createTestDb();
	const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
	const sender = await userWith(db, { [membersAreaId]: 'send' });
	const occasionId = await insertOccasion(db, admin, membersAreaId);
	return {
		admin,
		db,
		membersAreaId,
		occasionId,
		partnersAreaId,
		sender,
		storage: createMemoryStorage(),
	};
}

export { bytesOf, pdfBytes, setUpAttachments };
