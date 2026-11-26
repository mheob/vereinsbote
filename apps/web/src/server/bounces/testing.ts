/*
 * Fixtures of the bounce tests: a wave of a circular whose mails went out, one to a family address
 * shared by two members and one to a single member. For tests only.
 */
import { and, eq } from 'drizzle-orm';

import { insertContact } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { outboxEntries, waveContacts } from '@/server/db/schema';
import { confirmTestWave, setUpWaveClub } from '@/server/waves/testing';
import type { WaveClub } from '@/server/waves/testing';

/** 10:00 in Berlin: when the test wave was confirmed and its mails went out. */
const SENT_AT = new Date('2026-11-26T09:00:00.000Z');
/** The address the members 1 and 2 share. */
const FAMILY = 'familie@example.org';
/** The address of member 3. */
const SINGLE = 'clara@example.org';

/** A sent entry: its id, its Message-ID and the id the provider gave it. */
interface SentEntry {
	readonly id: string;
	readonly messageId: string;
	readonly providerId: string;
}

/** A club whose wave went out: the family's mail (members 1 and 2) and member 3's. */
interface SentWave {
	readonly club: WaveClub;
	readonly waveId: string;
	readonly family: SentEntry;
	readonly single: SentEntry;
	/** The members by number. */
	readonly contactIds: Readonly<Record<'1' | '2' | '3', string>>;
}

/**
 * A member with a first name.
 *
 * @param db The database.
 * @param memberNumber The member number.
 * @param email The address.
 * @returns The id.
 */
async function member(db: Db, memberNumber: string, email: string): Promise<string> {
	return insertContact(db, {
		email,
		firstName: `Vorname-${memberNumber}`,
		kind: 'member',
		memberNumber,
	});
}

/**
 * Marks the entry of an address as sent, with a Message-ID and a provider id of its own.
 *
 * @param db The database.
 * @param waveId The wave.
 * @param email The address of the entry.
 * @returns The entry.
 */
async function sendEntry(db: Db, waveId: string, email: string): Promise<SentEntry> {
	const [row] = await db
		.select({ id: outboxEntries.id })
		.from(outboxEntries)
		.innerJoin(waveContacts, eq(waveContacts.entryId, outboxEntries.id))
		.where(and(eq(outboxEntries.waveId, waveId), eq(waveContacts.email, email)))
		.limit(1);
	if (row === undefined) throw new Error('The test wave has no entry for the address.');
	const entry = { id: row.id, messageId: `<${row.id}@example.org>`, providerId: `re-${row.id}` };
	await db
		.update(outboxEntries)
		.set({
			attempts: 1,
			messageId: entry.messageId,
			providerId: entry.providerId,
			recipient: email,
			sentAt: SENT_AT,
			status: 'sent',
		})
		.where(eq(outboxEntries.id, row.id));
	return entry;
}

/**
 * A club with a circular of "Mitglieder" that went out through Graph (or Resend): one mail to the
 * family address of the members 1 and 2, one to member 3.
 *
 * @param provider The provider of the occasion's sender.
 * @returns The club, the wave and its two sent entries.
 */
async function setUpSentWave(provider: 'graph' | 'resend' = 'graph'): Promise<SentWave> {
	const club = await setUpWaveClub({ provider });
	const { db } = club;
	const contactIds = {
		1: await member(db, '1', FAMILY),
		2: await member(db, '2', FAMILY),
		3: await member(db, '3', SINGLE),
	};
	const waveId = await confirmTestWave(club, SENT_AT);
	const family = await sendEntry(db, waveId, FAMILY);
	const single = await sendEntry(db, waveId, SINGLE);
	return { club, contactIds, family, single, waveId };
}

export { FAMILY, SENT_AT, SINGLE, setUpSentWave };
export type { SentEntry, SentWave };
