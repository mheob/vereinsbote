import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vite-plus/test';

import { buildSampleMails } from './sample-mails';
import type { SampleMail } from './sample-mails';

const ORIGIN = 'http://localhost:3100';
const IMAGE_SOURCES = /<img[^>]* src="(?<source>[^"]*)"/gu;
const CID_REFERENCES = /\bcid:(?<cid>[\w-]+)/gu;
const PNG_SIGNATURE = '89504e470d0a1a0a';
const SIGNATURE_BYTES = 8;

/**
 * The matches of a pattern with a named group in a text.
 *
 * @param pattern The global pattern.
 * @param group The name of the group.
 * @param text The text.
 * @returns What the group captured, for each match.
 */
function captured(pattern: Readonly<RegExp>, group: string, text: string): string[] {
	return [...text.matchAll(pattern)].map((match) => match.groups?.[group] ?? '');
}

/**
 * What is wrong with the files a mail refers to: a `cid:` without attachment, a file that is not
 * a PNG.
 *
 * @param sample The sample mail.
 * @returns A description of each problem; empty when the mail is fine.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a plain value, never changed
async function attachmentProblems(sample: Readonly<SampleMail>): Promise<string[]> {
	const cids = new Set(captured(CID_REFERENCES, 'cid', sample.mail.html));
	const checks = [...cids].map(async (cid) => {
		const attachment = sample.attachments.find((candidate) => candidate.cid === cid);
		if (attachment === undefined) return `${sample.name}: no attachment for ${cid}`;
		const bytes = await readFile(attachment.path).catch(() => Buffer.alloc(0));
		const signature = bytes.subarray(0, SIGNATURE_BYTES).toString('hex');
		return signature === PNG_SIGNATURE && attachment.contentType === 'image/png'
			? ''
			: `${sample.name}: ${cid} is no PNG file`;
	});
	const results = await Promise.all(checks);
	return results.filter((problem) => problem !== '');
}

describe(buildSampleMails, () => {
	it('builds the four sample mails', async () => {
		const mails = await buildSampleMails(ORIGIN);

		expect(mails.map(({ name }) => name)).toStrictEqual([
			'standard-informal',
			'formal-organization',
			'two-columns',
			'full-brand',
		]);
	});

	it('gives each mail a subject, a text and an HTML', async () => {
		const mails = await buildSampleMails(ORIGIN);

		expect(mails.map(({ mail }) => mail.subject)).not.toContain('');
		expect(mails.map(({ mail }) => mail.text)).not.toContain('');
		expect(mails.filter(({ mail }) => !mail.html.includes('<html'))).toStrictEqual([]);
		expect(
			mails.filter(({ mail }) => [mail.subject, mail.html].some((text) => text.includes('{{'))),
		).toStrictEqual([]);
	});

	it('points no image at the app, a mailbox could not reach it', async () => {
		const mails = await buildSampleMails(ORIGIN);
		const sources = mails.flatMap(({ mail }) => captured(IMAGE_SOURCES, 'source', mail.html));

		expect(sources.length).toBeGreaterThan(0);
		expect(sources.filter((source) => !source.startsWith('cid:'))).toStrictEqual([]);
		expect(mails.filter(({ mail }) => mail.html.includes('http://localhost'))).toStrictEqual([]);
	});

	it('attaches an existing PNG for each referenced image', async () => {
		const mails = await buildSampleMails(ORIGIN);
		const problems = await Promise.all(mails.map(async (sample) => attachmentProblems(sample)));

		expect(problems.flat()).toStrictEqual([]);
	});

	it('shows the photo in the first mail', async () => {
		const [first] = await buildSampleMails(ORIGIN);

		expect(first?.mail.html).toContain('cid:sample-photo');
		expect(first?.attachments.map(({ cid }) => cid)).toContain('sample-photo');
	});

	it('writes the informal salutation to a woman and the formal one to a company', async () => {
		const [informal, formal] = await buildSampleMails(ORIGIN);

		expect(informal?.mail.text).toContain('Liebe Anna');
		expect(formal?.mail.text).toContain('Sehr geehrte Damen und Herren');
	});

	it('shows the icons of the footer links in the full brand mail', async () => {
		const mails = await buildSampleMails(ORIGIN);
		const full = mails.find(({ name }) => name === 'full-brand');

		expect(full?.attachments.map(({ cid }) => cid)).toStrictEqual(
			expect.arrayContaining(['social-instagram-dark', 'social-facebook-dark']),
		);
	});
});
