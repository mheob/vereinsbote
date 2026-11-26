import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { insertContact, setUpClub } from '@/server/contacts/testing';
import type { Db } from '@/server/db/client';
import { contactOptOuts, occasions } from '@/server/db/schema';
import { createTestDb } from '@/server/db/test-db';
import { insertOccasion } from '@/server/occasions/testing';
import { testEnv } from '@/server/sending/testing';

import { handleOneClick } from './one-click';
import type { OneClickServices } from './one-click';
import { deriveUnsubscribeKey, sealUnsubscribe } from './token';

const NOW = new Date('2026-11-26T09:00:00.000Z');
const URL_BASE = 'https://bote.example.org/unsubscribe/';
const FORM = 'application/x-www-form-urlencoded';
const ONE_CLICK = 'List-Unsubscribe=One-Click';

/**
 * A one-click POST as a mail provider sends it: no cookies, no `Origin`.
 *
 * @param token The token of the link.
 * @param options The content type and the body, when they differ from RFC 8058's.
 * @returns The request.
 */
function oneClick(
	token: string,
	options: Readonly<{ contentType?: string | null; body?: string }> = {},
): Request {
	const contentType = options.contentType === undefined ? FORM : options.contentType;
	return new Request(`${URL_BASE}${token}`, {
		body: options.body ?? ONE_CLICK,
		headers: contentType === null ? {} : { 'content-type': contentType },
		method: 'POST',
	});
}

/**
 * A one-click POST as `multipart/form-data`, the form RFC 8058 prefers.
 *
 * @param token The token of the link.
 * @param fields The fields of the form; a `Blob` is sent as a file.
 * @returns The request; its content type names the boundary.
 */
function multipartOneClick(
	token: string,
	fields: readonly (readonly [string, Blob | string])[] = [['List-Unsubscribe', 'One-Click']],
): Request {
	const form = new FormData();
	for (const [name, value] of fields) form.append(name, value);
	return new Request(`${URL_BASE}${token}`, { body: form, method: 'POST' });
}

/**
 * A multipart one-click POST with the right field after a long preamble, which a multipart parser
 * skips: only the bound of the body refuses it.
 *
 * @param token The token of the link.
 * @returns The request.
 */
function paddedMultipartOneClick(token: string): Request {
	const body = [
		'x'.repeat(2000),
		'--b',
		'Content-Disposition: form-data; name="List-Unsubscribe"',
		'',
		'One-Click',
		'--b--',
		'',
	].join('\r\n');
	return new Request(`${URL_BASE}${token}`, {
		body,
		headers: { 'content-type': 'multipart/form-data; boundary=b' },
		method: 'POST',
	});
}

/**
 * Services that count how often the database was opened.
 *
 * @param db The database, or null for one that must never be opened.
 * @returns The services and the count.
 */
function services(db: Db | null): { services: OneClickServices; opened: () => number } {
	const open = vi.fn<OneClickServices['db']>();
	if (db === null) open.mockRejectedValue(new Error('The database must not be opened.'));
	else open.mockResolvedValue(db);
	return {
		opened: () => open.mock.calls.length,
		services: {
			db: open,
			env: vi.fn<OneClickServices['env']>().mockResolvedValue(testEnv()),
			now: () => NOW,
		},
	};
}

/**
 * A club with an occasion and a member who got its mail, and the token of that mail.
 *
 * @returns The database, the occasion and the token.
 */
async function mailed(): Promise<{ db: Db; occasionId: string; token: string }> {
	const db = await createTestDb();
	const { admin, membersAreaId } = await setUpClub(db);
	const occasionId = await insertOccasion(db, admin, membersAreaId);
	await insertContact(db, { email: 'anna@example.org', kind: 'member', memberNumber: '4711' });
	const key = await deriveUnsubscribeKey(testEnv().appSecret);
	const token = await sealUnsubscribe(key, {
		areaId: membersAreaId,
		contacts: [{ key: 'nr:4711', kind: 'member' }],
		occasionId,
	});
	return { db, occasionId, token };
}

describe(handleOneClick, () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('opts the contacts of the mail out of the occasion and answers 200 without a body', async () => {
		const { db, occasionId, token } = await mailed();
		const response = await handleOneClick(oneClick(token), token, services(db).services);
		expect(response.status).toBe(200);
		await expect(response.text()).resolves.toBe('');
		const rows = await db.select().from(contactOptOuts);
		expect(
			rows.map(({ contactKey, occasionId: id, scope }) => [scope, contactKey, id]),
		).toStrictEqual([['occasion', 'nr:4711', occasionId]]);
		// A second click changes nothing and answers the same.
		const again = await handleOneClick(oneClick(token), token, services(db).services);
		expect(again.status).toBe(200);
		await expect(db.select().from(contactOptOuts)).resolves.toHaveLength(1);
	});

	it('takes the one-click POST as multipart form data as well', async () => {
		const { db, occasionId, token } = await mailed();
		const response = await handleOneClick(multipartOneClick(token), token, services(db).services);
		expect(response.status).toBe(200);
		await expect(response.text()).resolves.toBe('');
		const rows = await db.select().from(contactOptOuts);
		expect(rows.map(({ occasionId: id, scope }) => [scope, id])).toStrictEqual([
			['occasion', occasionId],
		]);
	});

	it.each([
		[
			'a content type with a charset',
			(token: string) =>
				oneClick(token, { contentType: 'Application/X-WWW-Form-Urlencoded; charset=UTF-8' }),
		],
		['other fields as well', (token: string) => oneClick(token, { body: `x=1&${ONE_CLICK}&y=2` })],
		[
			'a value with a trailing line break',
			(token: string) => oneClick(token, { body: `${ONE_CLICK}\r\n` }),
		],
		[
			'multipart with other fields as well',
			(token: string) =>
				multipartOneClick(token, [
					['x', '1'],
					['List-Unsubscribe', 'One-Click'],
				]),
		],
		[
			'multipart with a trailing line break',
			(token: string) => multipartOneClick(token, [['List-Unsubscribe', ' One-Click\r\n']]),
		],
	])('takes %s', async (_name, request) => {
		const { db, token } = await mailed();
		const response = await handleOneClick(request(token), token, services(db).services);
		expect(response.status).toBe(200);
		await expect(db.select().from(contactOptOuts)).resolves.toHaveLength(1);
	});

	it.each([
		['no content type', { contentType: null }],
		['JSON', { body: '{"List-Unsubscribe":"One-Click"}', contentType: 'application/json' }],
		[
			'a multipart type without a multipart body',
			{ contentType: 'multipart/form-data; boundary=x' },
		],
		['plain text', { contentType: 'text/plain' }],
		['another value', { body: 'List-Unsubscribe=Yes' }],
		['no such field', { body: 'x=1&y=One-Click' }],
		['an empty body', { body: '' }],
		// Empty pairs are skipped by the parser: only the bound refuses it.
		['a body above 1 KiB', { body: `${ONE_CLICK}${'&'.repeat(2000)}` }],
	])('refuses %s with 400 before it opens the token or the database', async (_name, options) => {
		const tracked = services(null);
		const response = await handleOneClick(
			oneClick('anything', options),
			'anything',
			tracked.services,
		);
		expect(response.status).toBe(400);
		await expect(response.text()).resolves.toBe('');
		expect(tracked.opened()).toBe(0);
	});

	it.each([
		['another value', () => multipartOneClick('anything', [['List-Unsubscribe', 'Yes']])],
		['no such field', () => multipartOneClick('anything', [['x', 'One-Click']])],
		[
			'a file for the field',
			() => multipartOneClick('anything', [['List-Unsubscribe', new Blob(['One-Click'])]]),
		],
		['an empty form', () => multipartOneClick('anything', [])],
		['a body above 1 KiB', () => paddedMultipartOneClick('anything')],
	])('refuses multipart form data with %s with 400', async (_name, request) => {
		const tracked = services(null);
		const response = await handleOneClick(request(), 'anything', tracked.services);
		expect(response.status).toBe(400);
		await expect(response.text()).resolves.toBe('');
		expect(tracked.opened()).toBe(0);
	});

	it('answers 404 to a token that does not open, before any database work', async () => {
		const tracked = services(null);
		const response = await handleOneClick(oneClick('not-a-token'), 'not-a-token', tracked.services);
		expect(response.status).toBe(404);
		await expect(response.text()).resolves.toBe('');
		expect(tracked.opened()).toBe(0);
	});

	it('answers 200 to the link of a test mail and changes nothing', async () => {
		const tracked = services(null);
		const response = await handleOneClick(oneClick('test'), 'test', tracked.services);
		expect(response.status).toBe(200);
		expect(tracked.opened()).toBe(0);
	});

	it('answers 200 when the occasion is gone: no mail of it will come', async () => {
		const { db, occasionId, token } = await mailed();
		await db.delete(occasions).where(eq(occasions.id, occasionId));
		const response = await handleOneClick(oneClick(token), token, services(db).services);
		expect(response.status).toBe(200);
		await expect(db.select().from(contactOptOuts)).resolves.toStrictEqual([]);
	});

	it('answers 500 without details when the database fails, and logs only a label', async () => {
		const { token } = await mailed();
		const logged = vi.spyOn(console, 'error').mockReturnValue();
		const failing: OneClickServices = {
			db: vi
				.fn<OneClickServices['db']>()
				.mockRejectedValue(new Error(`connection to db failed for ${token}`)),
			env: vi.fn<OneClickServices['env']>().mockResolvedValue(testEnv()),
			now: () => NOW,
		};
		const response = await handleOneClick(oneClick(token), token, failing);
		expect(response.status).toBe(500);
		await expect(response.text()).resolves.toBe('');
		expect(JSON.stringify(logged.mock.calls)).not.toContain(token);
	});
});
