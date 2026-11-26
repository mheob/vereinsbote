import { randomUUID } from 'node:crypto';

import { emptyTemplate } from '@/mail/starters/starters';
import { userWith } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import type { Principal } from '@/server/permissions/principal';
import { graphConnection, senderOn } from '@/server/sending/testing';
import { createTemplate } from '@/server/templates/testing';

import { createOccasion } from './occasions';

/**
 * An occasion in an area with a template and a sender of its own. For tests only.
 *
 * @param db The test database.
 * @param admin An admin, who makes the connection and the sender.
 * @param areaId The area.
 * @param name The name of the occasion.
 * @returns The id of the occasion.
 */
// oxlint-disable-next-line max-params -- a test helper with the plain parts of an occasion
async function insertOccasion(
	db: Db,
	admin: Principal,
	areaId: string,
	name = 'Einladungen',
): Promise<string> {
	const editor = await userWith(db, { [areaId]: 'edit' });
	const unique = randomUUID();
	const connectionId = await graphConnection(db, admin, `Anbindung ${unique}`);
	const senderId = await senderOn(db, admin, connectionId, `${unique}@example.org`, [areaId]);
	const { id: templateId } = await createTemplate(
		db,
		editor,
		areaId,
		emptyTemplate({ name: `Vorlage ${unique}`, subject: 'Betreff' }),
	);
	const { id } = await createOccasion(db, editor, areaId, {
		kind: 'circular',
		name,
		senderId,
		templateId,
		unsubscribe: true,
	});
	return id;
}

export { insertOccasion };
