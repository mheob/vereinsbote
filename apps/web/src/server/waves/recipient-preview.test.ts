import { describe, expect, it } from 'vite-plus/test';

import { emptyTemplate } from '@/mail/starters/starters';
import type { TemplateInput } from '@/mail/templates/template-schema';
import { ContactNotFoundError } from '@/server/contacts/errors';
import { setFieldAreas } from '@/server/contacts/settings';
import { insertContact } from '@/server/contacts/testing';
import { contactSuppressions } from '@/server/db/schema';
import { ForbiddenError } from '@/server/permissions/principal';

import { recipientPreview } from './recipient-preview';
import type { RecipientSelection } from './recipients';
import { setUpWaveClub } from './testing';

/** 10:00 in Berlin. */
const NOW = new Date('2026-11-26T09:00:00.000Z');
const FAMILY = 'familie@example.org';

const EVERY_MEMBER: RecipientSelection = {
	contactIds: null,
	filters: {},
	kind: 'member',
	query: '',
};

/** A template that greets the contact by first name. */
const TEMPLATE: TemplateInput = {
	...emptyTemplate({ name: 'Einladung', subject: 'Sommerfest' }),
	body: {
		blocks: [
			{
				content: [
					{ text: 'Hallo ', type: 'text' },
					{ attrs: { fallback: null, key: 'contact.firstName' }, type: 'placeholder' },
				],
				id: 'heading',
				level: 2,
				type: 'heading',
			},
		],
		kind: 'blocks',
		layout: { kind: 'standard' },
	},
};

describe(recipientPreview, () => {
	it('shows a circular with the values of the first contact of the address and who shares it', async () => {
		const c = await setUpWaveClub({ template: TEMPLATE });
		const second = await insertContact(c.db, {
			email: FAMILY,
			firstName: 'Bernd',
			kind: 'member',
			lastName: 'Muster',
			memberNumber: '2',
		});
		const first = await insertContact(c.db, {
			email: FAMILY,
			firstName: 'Anna',
			kind: 'member',
			lastName: 'Muster',
			memberNumber: '1',
		});
		const preview = await recipientPreview(
			c.db,
			c.sender,
			{ contactId: second, occasionId: c.occasionId, selection: EVERY_MEMBER },
			NOW,
		);
		expect(preview).toMatchObject({
			contactId: first,
			excluded: null,
			names: ['Anna Muster', 'Bernd Muster'],
		});
		expect(preview.values).toHaveProperty(['contact.firstName'], 'Anna');
	});

	it('shows a personal mail with the chosen contact alone', async () => {
		const c = await setUpWaveClub({ kind: 'personal', template: TEMPLATE });
		await insertContact(c.db, {
			email: FAMILY,
			firstName: 'Anna',
			kind: 'member',
			memberNumber: '1',
		});
		const bernd = await insertContact(c.db, {
			email: FAMILY,
			firstName: 'Bernd',
			kind: 'member',
			memberNumber: '2',
		});
		const preview = await recipientPreview(
			c.db,
			c.sender,
			{ contactId: bernd, occasionId: c.occasionId, selection: EVERY_MEMBER },
			NOW,
		);
		expect(preview).toMatchObject({ contactId: bernd, excluded: null, names: ['Bernd'] });
		expect(preview.values).toHaveProperty(['contact.firstName'], 'Bernd');
	});

	it('says why a chosen contact gets no mail of the selection', async () => {
		const c = await setUpWaveClub({ template: TEMPLATE });
		const suppressed = await insertContact(c.db, {
			email: 'gesperrt@example.org',
			firstName: 'Gerd',
			kind: 'member',
			memberNumber: '3',
		});
		await c.db.insert(contactSuppressions).values({ contactKey: 'nr:3', kind: 'member' });
		const partner = await insertContact(c.db, { email: 'firma@example.org', kind: 'partner' });
		const input = { occasionId: c.occasionId, selection: EVERY_MEMBER };
		await expect(
			recipientPreview(c.db, c.sender, { ...input, contactId: suppressed }, NOW),
		).resolves.toMatchObject({ contactId: suppressed, excluded: 'suppressed', names: [] });
		await expect(
			recipientPreview(c.db, c.sender, { ...input, contactId: partner }, NOW),
		).resolves.toMatchObject({ contactId: partner, excluded: 'notSelected', names: [] });
	});

	it('names a reached exit only to a user who may see exit dates', async () => {
		const c = await setUpWaveClub({ template: TEMPLATE });
		const exited = await insertContact(c.db, {
			email: 'ausgetreten@example.org',
			exitDate: '2020-01-01',
			firstName: 'Ina',
			kind: 'member',
			memberNumber: '4',
		});
		const input = { contactId: exited, occasionId: c.occasionId, selection: EVERY_MEMBER };
		await expect(recipientPreview(c.db, c.sender, input, NOW)).resolves.toMatchObject({
			excluded: 'exited',
		});
		await setFieldAreas(c.db, c.admin, {
			areaIds: [c.partnersAreaId],
			fieldKey: 'exitDate',
			kind: 'member',
		});
		await expect(recipientPreview(c.db, c.sender, input, NOW)).resolves.toMatchObject({
			excluded: 'unavailable',
		});
	});

	it('refuses a contact that is gone and a user without send', async () => {
		const c = await setUpWaveClub();
		const anna = await insertContact(c.db, { email: 'anna@example.org', kind: 'member' });
		const input = { contactId: anna, occasionId: c.occasionId, selection: EVERY_MEMBER };
		await expect(
			recipientPreview(c.db, c.sender, { ...input, contactId: crypto.randomUUID() }, NOW),
		).rejects.toThrow(ContactNotFoundError);
		await expect(recipientPreview(c.db, c.editor, input, NOW)).rejects.toThrow(ForbiddenError);
	});
});
