/*
 * Fixtures of the wave tests: a club with an occasion of its own, and a wave row for tests that
 * only need one to exist. For tests only.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import { emptyTemplate } from '@/mail/starters/starters';
import type { TemplateInput } from '@/mail/templates/template-schema';
import { setUpClub, userWith } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { occasions, waves } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import type { OccasionKind } from '@/server/occasions/limits';
import { createOccasion } from '@/server/occasions/occasions';
import type { Principal } from '@/server/permissions/principal';
import { graphConnection, resendConnection, senderOn } from '@/server/sending/testing';
import { createTemplate } from '@/server/templates/testing';

interface WaveClub {
	readonly db: Db;
	readonly admin: Principal;
	readonly membersAreaId: string;
	readonly partnersAreaId: string;
	/** `send` in "Mitglieder". */
	readonly sender: Principal;
	/** `edit` in "Mitglieder": may change the template, not send. */
	readonly editor: Principal;
	readonly connectionId: string;
	/** The sender of the occasion, released to "Mitglieder". */
	readonly senderId: string;
	readonly templateId: string;
	/** An occasion of "Mitglieder". */
	readonly occasionId: string;
}

interface WaveClubOptions {
	readonly kind?: OccasionKind;
	readonly unsubscribe?: boolean;
	readonly template?: TemplateInput;
	readonly provider?: 'graph' | 'resend';
}

/**
 * A club with an occasion in "Mitglieder" (a circular with the unsubscribe link by default), its
 * template, a sender on a Graph connection (or Resend), and users who may send or edit there.
 *
 * @param db A migrated, empty database.
 * @param options The kind, the link, the template and the provider of the occasion.
 * @returns The club.
 */
async function setUpWaveClubOn(db: Db, options: Readonly<WaveClubOptions> = {}): Promise<WaveClub> {
	const { admin, membersAreaId, partnersAreaId } = await setUpClub(db);
	const editor = await userWith(db, { [membersAreaId]: 'edit' });
	const sender = await userWith(db, { [membersAreaId]: 'send' });
	const connectionId =
		options.provider === 'resend'
			? await resendConnection(db, admin)
			: await graphConnection(db, admin);
	const senderId = await senderOn(db, admin, connectionId, 'verein@example.org', [membersAreaId]);
	const template = options.template ?? emptyTemplate({ name: 'Einladung', subject: 'Sommerfest' });
	const { id: templateId } = await createTemplate(db, editor, membersAreaId, template);
	const kind = options.kind ?? 'circular';
	const { id: occasionId } = await createOccasion(db, editor, membersAreaId, {
		kind,
		name: 'Einladungen',
		senderId,
		templateId,
		unsubscribe: options.unsubscribe ?? kind === 'circular',
	});
	return {
		admin,
		connectionId,
		db,
		editor,
		membersAreaId,
		occasionId,
		partnersAreaId,
		sender,
		senderId,
		templateId,
	};
}

/**
 * The club of `setUpWaveClubOn` in a fresh test database.
 *
 * @param options The kind, the link, the template and the provider of the occasion.
 * @returns The club.
 */
async function setUpWaveClub(options: Readonly<WaveClubOptions> = {}): Promise<WaveClub> {
	return setUpWaveClubOn(await createTestDb(), options);
}

/**
 * A wave of an occasion without entries, as a row: for tests that only need one to exist.
 *
 * @param db The test database or a transaction.
 * @param occasionId The occasion.
 * @param options When the wave was made and the key of its flow; now and a fresh one by default.
 * @returns The id of the wave.
 */
async function insertWave(
	db: Db,
	occasionId: string,
	options: Readonly<{ createdAt?: Date; requestId?: string }> = {},
): Promise<string> {
	const [occasion] = await db.select().from(occasions).where(eq(occasions.id, occasionId));
	if (occasion === undefined) throw new Error('The occasion of the test wave does not exist.');
	const [row] = await db
		.insert(waves)
		.values({
			areaId: occasion.areaId,
			compiled: { html: [], preheader: [], slots: [], subject: [], text: [] },
			createdAt: options.createdAt ?? new Date(),
			kind: occasion.kind,
			occasionId,
			requestId: options.requestId ?? randomUUID(),
			salutationTexts: DEFAULT_SALUTATIONS.du,
			senderId: occasion.senderId,
			templateId: occasion.templateId,
			templateVersion: 1,
			unsubscribe: occasion.unsubscribe,
		})
		.returning({ id: waves.id });
	if (row === undefined) throw new Error('Inserting the test wave returned no row.');
	return row.id;
}

export { insertWave, setUpWaveClub, setUpWaveClubOn };
export type { WaveClub };
