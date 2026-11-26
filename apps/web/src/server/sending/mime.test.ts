import { describe, expect, it } from 'vite-plus/test';

import {
	buildMime,
	GRAPH_REQUEST_LIMIT_BYTES,
	graphRequestBytes,
	listUnsubscribeFits,
	MimeAddressError,
} from '@/server/sending/mime';
import type { MailAttachment, OutgoingMail } from '@/server/sending/transport';

const DATE = new Date('2026-11-25T10:00:00Z');
const MAX_LINE = 78;
const BASE64_LINE = 76;
const MIB = 1024 * 1024;
const WORD_GAP = /(?<=\?=)\s+(?==\?UTF-8)/gu;
const WORD = /[=]\?UTF-8\?B\?(?<data>[^?]+)\?=/gu;
const BASE64_ROW = /^[A-Za-z0-9+/]{20,}={0,2}$/u;

function mail(overrides: Partial<OutgoingMail> = {}): OutgoingMail {
	return {
		attachments: [],
		bcc: null,
		from: { address: 'verein@example.org', name: 'Förderverein Süd' },
		html: '<p>Hallo Anna</p>',
		idempotencyKey: null,
		kind: 'regular',
		listUnsubscribe: null,
		messageId: '<abc123@example.org>',
		replyTo: null,
		subject: 'Einladung zum Sommerfest',
		text: 'Hallo Anna',
		to: 'anna@example.org',
		...overrides,
	};
}

function plain(): string {
	return buildMime(mail(), DATE);
}

function pdf(size: number): MailAttachment {
	return {
		bytes: new Uint8Array(size).map((_, index) => (index * 7) % 256),
		contentType: 'application/pdf',
		filename: 'a.pdf',
	};
}

// The header lines as written, folded lines still folded.
function rawHeaderLines(mime: string): string[] {
	return mime.slice(0, mime.indexOf('\r\n\r\n')).split('\r\n');
}

// The header lines with folding undone.
function headerLines(mime: string): string[] {
	return mime.slice(0, mime.indexOf('\r\n\r\n')).replaceAll('\r\n ', ' ').split('\r\n');
}

// All lines of the message with folding undone.
function allLines(mime: string): string[] {
	return mime.replaceAll('\r\n ', ' ').split('\r\n');
}

function line(lines: readonly string[], prefix: string): string {
	const found = lines.find((candidate) => candidate.startsWith(prefix));
	if (found === undefined) throw new Error(`no ${prefix} line`);
	return found;
}

function decodeWords(value: string): string {
	return value
		.replaceAll(WORD_GAP, '')
		.replaceAll(WORD, (_match, data: string) =>
			new TextDecoder().decode(Uint8Array.from(atob(data), (char) => char.codePointAt(0) ?? 0)),
		);
}

function subjectOf(mime: string): string {
	const subject = line(headerLines(mime), 'Subject: ');
	return decodeWords(subject.slice('Subject: '.length));
}

function dispositionOf(attachment: MailAttachment): string {
	const mime = buildMime(mail({ attachments: [attachment] }), DATE);
	return line(allLines(mime), 'Content-Disposition: attachment');
}

function longestHeaderLine(mime: string): number {
	return Math.max(...rawHeaderLines(mime).map((raw) => raw.length));
}

function headerNamed(mime: string, name: string): string[] {
	return rawHeaderLines(mime).filter((candidate) => candidate.startsWith(`${name}:`));
}

describe(buildMime, () => {
	it('builds text and html alternatives with crlf line ends', () => {
		const mime = buildMime(mail(), DATE);
		expect(mime).not.toMatch(/(?<!\r)\n/u);
		expect(mime).toContain('MIME-Version: 1.0\r\n');
		expect(mime).toMatch(/Content-Type: multipart\/alternative; boundary="[\w-]+"/u);
		expect(mime).toContain('Date: Wed, 25 Nov 2026 10:00:00 +0000\r\n');
		expect(mime.indexOf('text/plain')).toBeLessThan(mime.indexOf('text/html'));
	});

	it('gives both parts utf-8 base64 bodies', () => {
		const mime = buildMime(mail(), DATE);
		expect(mime).toContain('Content-Type: text/plain; charset=UTF-8\r\n');
		expect(mime).toContain('Content-Type: text/html; charset=UTF-8\r\n');
		expect(mime).toContain(`\r\n\r\n${btoa('Hallo Anna')}\r\n`);
	});

	it('encodes non-ascii subject and display name as rfc 2047 words', () => {
		const mime = buildMime(mail({ subject: 'Einladung zum Sommerfest 🎉' }), DATE);
		expect(line(headerLines(mime), 'Subject: ')).toContain('=?UTF-8?B?');
		expect(subjectOf(mime)).toBe('Einladung zum Sommerfest 🎉');
		const from = line(headerLines(mime), 'From: ');
		expect(decodeWords(from)).toBe('From: Förderverein Süd <verein@example.org>');
		expect(longestHeaderLine(mime)).toBeLessThanOrEqual(MAX_LINE);
	});

	it('quotes an ascii display name', () => {
		const mime = buildMime(
			mail({ from: { address: 'verein@example.org', name: 'Club "A", e.V.' } }),
			DATE,
		);
		expect(line(headerLines(mime), 'From: ')).toBe(
			String.raw`From: "Club \"A\", e.V." <verein@example.org>`,
		);
	});

	it('folds a long encoded subject on whole characters', () => {
		const subject = 'Größe Überraschung für alle Mitglieder 🎉'.repeat(4);
		const mime = buildMime(mail({ subject }), DATE);
		expect(longestHeaderLine(mime)).toBeLessThanOrEqual(MAX_LINE);
		expect(subjectOf(mime)).toBe(subject);
	});

	it('cannot add a header through a line break in the subject', () => {
		const mime = buildMime(mail({ subject: 'Hallo\r\nBcc: x@example.org' }), DATE);
		expect(headerNamed(mime, 'Bcc')).toHaveLength(0);
		expect(headerNamed(mime, 'Subject')).toHaveLength(1);
	});

	it('refuses an address that holds a line break', () => {
		const attack = mail({ to: 'a@example.org\r\nBcc: x@example.org' });
		expect(() => buildMime(attack, DATE)).toThrow(MimeAddressError);
	});

	it.each([
		['to', { to: 'a@example.org, b@example.org' }],
		['to', { to: 'Anna <a@example.org>' }],
		['replyTo', { replyTo: 'ä@example.org' }],
		['bcc', { bcc: 'a@example.org\u0000' }],
		['listUnsubscribe', { listUnsubscribe: 'https://app.example.org/u?a=1,2' }],
		['listUnsubscribe', { listUnsubscribe: 'https://app.example.org/u;x' }],
		['from', { from: { address: 'a b@example.org', name: 'X' } }],
	])('refuses an unusable %s without echoing it', (_field, overrides) => {
		expect(() => buildMime(mail(overrides), DATE)).toThrow(/^invalid address in mail header$/u);
	});

	it('sets Bcc only when given', () => {
		const withBcc = buildMime(mail({ bcc: 'archiv@example.org' }), DATE);
		expect(headerLines(withBcc)).toContain('Bcc: archiv@example.org');
		expect(headerNamed(plain(), 'Bcc')).toHaveLength(0);
	});

	it('sets List-Unsubscribe and the one-click header together', () => {
		const mime = buildMime(mail({ listUnsubscribe: 'https://app.example.org/u/abc' }), DATE);
		expect(headerLines(mime)).toContain('List-Unsubscribe: <https://app.example.org/u/abc>');
		expect(headerLines(mime)).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
		expect(headerNamed(plain(), 'List-Unsubscribe')).toHaveLength(0);
	});

	it('tells whether the List-Unsubscribe line stays within the 998 characters of RFC 5322', () => {
		const prefix = 'https://app.example.org/unsubscribe/';
		// `List-Unsubscribe: <` and `>` take 20 characters of the line.
		const longest = `${prefix}${'a'.repeat(998 - 20 - prefix.length)}`;
		expect(listUnsubscribeFits(longest)).toBe(true);
		const mime = buildMime(mail({ listUnsubscribe: longest }), DATE);
		expect(headerLines(mime)).toContain(`List-Unsubscribe: <${longest}>`);
		expect(`List-Unsubscribe: <${longest}>`).toHaveLength(998);
		expect(listUnsubscribeFits(`${longest}a`)).toBe(false);
	});

	it('wraps base64 parts at 76 characters', () => {
		const mime = buildMime(mail({ attachments: [pdf(1000)] }), DATE);
		const rows = allLines(mime).filter((candidate) => BASE64_ROW.test(candidate));
		expect(mime).toMatch(/Content-Type: multipart\/mixed; boundary="[\w-]+"/u);
		expect(mime).toContain('Content-Type: application/pdf\r\n');
		expect(rows.length).toBeGreaterThan(10);
		expect(Math.max(...rows.map((row) => row.length))).toBe(BASE64_LINE);
	});

	it('names files per rfc 2231 without path parts', () => {
		const disposition = dispositionOf({ ...pdf(10), filename: 'Anmeldung "Süd"/../x.pdf' });
		expect(disposition).toContain('filename="x.pdf"');
		expect(disposition).toContain("filename*=UTF-8''x.pdf");
		expect(disposition).not.toContain('/');
		expect(disposition).not.toContain('..');
	});

	it('percent-encodes a non-ascii file name and keeps an ascii fallback', () => {
		const disposition = dispositionOf({ ...pdf(10), filename: 'Übersicht "Süd".pdf' });
		expect(disposition).toContain("filename*=UTF-8''%C3%9Cbersicht%20%22S%C3%BCd%22.pdf");
		expect(disposition).toContain('filename="_bersicht _S_d_.pdf"');
	});

	it('keeps the given Message-ID and Reply-To', () => {
		const given = mail({ messageId: '<fixed-id@example.org>', replyTo: 'vorstand@example.org' });
		expect(headerLines(buildMime(given, DATE))).toContain('Message-ID: <fixed-id@example.org>');
		expect(headerLines(buildMime(given, DATE))).toContain('Reply-To: vorstand@example.org');
		expect(headerNamed(plain(), 'Reply-To')).toHaveLength(0);
	});
});

describe('header edge cases', () => {
	it('keeps every line of a 200 character subject and name short', () => {
		const long = 'Sommerfest '.repeat(19).slice(0, 200);
		const ascii = buildMime(
			mail({ from: { address: 'v@example.org', name: long }, subject: long }),
			DATE,
		);
		expect(longestHeaderLine(ascii)).toBeLessThanOrEqual(998);
		expect(subjectOf(ascii)).toBe(long.trim());
	});

	it('folds a 200 character ascii word without spaces below 998', () => {
		const word = 'x'.repeat(200);
		const mime = buildMime(
			mail({ from: { address: 'v@example.org', name: word }, subject: word }),
			DATE,
		);
		expect(longestHeaderLine(mime)).toBeLessThanOrEqual(998);
		expect(subjectOf(mime)).toBe(word);
	});

	it('encodes an emoji display name', () => {
		const mime = buildMime(mail({ from: { address: 'v@example.org', name: '🎉🎉 Fest' } }), DATE);
		const from = decodeWords(line(headerLines(mime), 'From: '));
		expect(from).toBe('From: 🎉🎉 Fest <v@example.org>');
		expect(longestHeaderLine(mime)).toBeLessThanOrEqual(MAX_LINE);
	});

	it('turns a lone CR and a CRLF in the subject into spaces', () => {
		const cr = buildMime(mail({ subject: 'Hallo\rWelt' }), DATE);
		const crlf = buildMime(mail({ subject: 'Hallo\r\nBcc: x' }), DATE);
		expect(subjectOf(cr)).toBe('Hallo Welt');
		expect(subjectOf(crlf)).toBe('Hallo Bcc: x');
	});

	it('survives a lone surrogate in a file name', () => {
		const disposition = dispositionOf({ ...pdf(10), filename: 'a\uD800b.pdf' });
		expect(disposition).toContain("filename*=UTF-8''a%EF%BF%BDb.pdf");
	});

	it('keeps the encoded file name parameter short for 100 astral characters', () => {
		const disposition = dispositionOf({ ...pdf(10), filename: '𝒜'.repeat(100) });
		expect(disposition.length).toBeLessThan(500);
		expect(disposition).toContain("filename*=UTF-8''%F0%9D%92%9C");
	});
});

describe(graphRequestBytes, () => {
	it('is above the limit for a large attachment', () => {
		const large = mail({ attachments: [pdf(2.5 * MIB)] });
		expect(graphRequestBytes(large, DATE)).toBeGreaterThan(GRAPH_REQUEST_LIMIT_BYTES);
	});

	it('measures the base64 of the mime text', () => {
		const small = mail({ attachments: [pdf(MIB)] });
		const size = graphRequestBytes(small, DATE);
		expect(size).toBeLessThan(GRAPH_REQUEST_LIMIT_BYTES);
		expect(size).toBe(btoa(buildMime(small, DATE)).length);
	});
});
