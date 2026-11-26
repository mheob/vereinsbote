import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vite-plus/test';

import { userWith } from '@/server/contacts/testing';
import { attachments } from '@/server/db/schema';
import { ForbiddenError } from '@/server/permissions/principal';

import { removeAttachmentResult, uploadAttachmentResult } from './failures';
import { bytesOf, pdfBytes, setUpAttachments } from './testing';

describe(uploadAttachmentResult, () => {
	it('gives the attachment, or the refusal as a result', async () => {
		const { db, occasionId, sender, storage } = await setUpAttachments();
		const file = { bytes: pdfBytes(), name: 'a.pdf' };
		await expect(
			uploadAttachmentResult(db, storage, sender, occasionId, file),
		).resolves.toMatchObject({
			attachment: { name: 'a.pdf' },
			ok: true,
		});
		await expect(
			uploadAttachmentResult(db, storage, sender, occasionId, {
				bytes: bytesOf('<html>'),
				name: 'a.pdf',
			}),
		).resolves.toStrictEqual({ failure: 'invalid', ok: false, problem: 'type' });
		await expect(
			uploadAttachmentResult(db, storage, sender, randomUUID(), file),
		).resolves.toStrictEqual({ failure: 'gone', ok: false });
		await expect(uploadAttachmentResult(db, null, sender, occasionId, file)).resolves.toStrictEqual(
			{
				failure: 'storageMissing',
				ok: false,
			},
		);
	});

	it('still throws for a missing right', async () => {
		const { db, membersAreaId, occasionId, storage } = await setUpAttachments();
		const editor = await userWith(db, { [membersAreaId]: 'edit' });
		await expect(
			uploadAttachmentResult(db, storage, editor, occasionId, { bytes: pdfBytes(), name: 'a.pdf' }),
		).rejects.toBeInstanceOf(ForbiddenError);
	});
});

describe(removeAttachmentResult, () => {
	it('removes, and reports an unknown attachment or a missing storage', async () => {
		const { db, occasionId, sender, storage } = await setUpAttachments();
		const uploaded = await uploadAttachmentResult(db, storage, sender, occasionId, {
			bytes: pdfBytes(),
			name: 'a.pdf',
		});
		expect(uploaded).toMatchObject({ ok: true });
		const rows = await db.select({ id: attachments.id }).from(attachments);
		const id = rows.map((row) => row.id).join('');
		await expect(removeAttachmentResult(db, storage, sender, id)).resolves.toStrictEqual({
			ok: true,
		});
		await expect(removeAttachmentResult(db, storage, sender, id)).resolves.toStrictEqual({
			failure: 'gone',
			ok: false,
		});
		await expect(removeAttachmentResult(db, null, sender, id)).resolves.toStrictEqual({
			failure: 'storageMissing',
			ok: false,
		});
	});
});
