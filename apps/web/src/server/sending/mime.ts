/*
 * Builds the MIME text of a mail by hand: no dependency, full control over every header. Pure: it
 * runs on Node, on Vercel and on Workers (no Buffer, no Node modules).
 *
 * Every header value goes through `cleanHeaderText` (no CR or LF), non-ASCII text becomes
 * RFC 2047 B-words, file names RFC 2231.
 */

import { cleanHeaderText } from '@/mail/escape';
import type { MailAttachment, OutgoingMail } from '@/server/sending/transport';

const CRLF = '\r\n';
const GRAPH_REQUEST_LIMIT_BYTES = 4_000_000;
const MAX_LINE = 78;
/** At most 45 bytes per encoded word: 60 base64 characters plus 12 of framing is 72 characters. */
const WORD_BYTES = 45;
const BASE64_LINE = 76;
const BASE64_CHUNK = 0x60_00;
const MAX_FILENAME_CHARACTERS = 100;
const BOUNDARY_BYTES = 12;
const HEX = 16;

const encoder = new TextEncoder();
const NON_ASCII = /[^\u0020-\u007E]/u;
const ADDRESS_FORBIDDEN = /[\s<>,;"\\]/gu;
const PATH_PART = /^.*[/\\]/u;
const FILENAME_FORBIDDEN = /[\p{Cc}\u2028\u2029]/gu;
const FILENAME_FALLBACK_FORBIDDEN = /[^\w .()+-]/gu;

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
		binary += String.fromCodePoint(...bytes.subarray(offset, offset + BASE64_CHUNK));
	}
	return btoa(binary);
}

function wrapBase64(bytes: Uint8Array): string {
	const encoded = toBase64(bytes);
	const lines: string[] = [];
	for (let index = 0; index < encoded.length; index += BASE64_LINE) {
		lines.push(encoded.slice(index, index + BASE64_LINE));
	}
	return lines.join(CRLF);
}

/**
 * Splits text into RFC 2047 B-words that each hold whole characters.
 *
 * @param text The text.
 * @returns The encoded words.
 */
function encodeWords(text: string): string[] {
	const words: string[] = [];
	let current: number[] = [];
	for (const character of text) {
		const bytes = encoder.encode(character);
		if (current.length + bytes.length > WORD_BYTES) {
			words.push(`=?UTF-8?B?${toBase64(Uint8Array.from(current))}?=`);
			current = [];
		}
		current.push(...bytes);
	}
	if (current.length > 0) words.push(`=?UTF-8?B?${toBase64(Uint8Array.from(current))}?=`);
	return words;
}

/**
 * Text as unbreakable tokens: plain words when it is short ASCII, else encoded words.
 *
 * @param text The text.
 * @returns The tokens.
 */
function textTokens(text: string): string[] {
	const words = text.split(' ').filter(Boolean);
	if (!NON_ASCII.test(text) && words.every((word) => word.length <= MAX_LINE - 8)) return words;
	return encodeWords(text);
}

/**
 * Joins tokens with spaces and folds the header before 78 characters.
 *
 * @param name The header name.
 * @param tokens The unbreakable parts of the value.
 * @returns The header with CRLF between its lines.
 */
function foldHeader(name: string, tokens: readonly string[]): string {
	const lines: string[] = [];
	let line = `${name}:`;
	for (const token of tokens) {
		if (line.length + 1 + token.length > MAX_LINE) {
			lines.push(line);
			line = ` ${token}`;
		} else {
			line += ` ${token}`;
		}
	}
	lines.push(line);
	return lines.join(CRLF);
}

function textHeader(name: string, value: string): string {
	return foldHeader(name, textTokens(cleanHeaderText(value)));
}

function address(value: string): string {
	return cleanHeaderText(value).replaceAll(ADDRESS_FORBIDDEN, '');
}

function fromHeader(from: OutgoingMail['from']): string {
	const mailbox = `<${address(from.address)}>`;
	const name = cleanHeaderText(from.name);
	if (name === '') return foldHeader('From', [mailbox]);
	if (NON_ASCII.test(name)) return foldHeader('From', [...encodeWords(name), mailbox]);
	const quoted = `"${name.replaceAll(/["\\]/gu, String.raw`\$&`)}"`;
	return foldHeader('From', [quoted, mailbox]);
}

function formatDate(date: Date): string {
	return date.toUTCString().replace(/ GMT$/u, ' +0000');
}

function boundary(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(BOUNDARY_BYTES));
	return `vb_${[...bytes].map((byte) => byte.toString(HEX).padStart(2, '0')).join('')}`;
}

function textPart(contentType: string, body: string): string {
	return [
		`Content-Type: ${contentType}; charset=UTF-8`,
		'Content-Transfer-Encoding: base64',
		'',
		wrapBase64(encoder.encode(body)),
	].join(CRLF);
}

function safeFilename(filename: string): string {
	const name = cleanHeaderText(filename.replaceAll(FILENAME_FORBIDDEN, '').replace(PATH_PART, ''))
		.replaceAll(/\.{2,}/gu, '.')
		.trim();
	let limited = '';
	let count = 0;
	for (const character of name) {
		if (count === MAX_FILENAME_CHARACTERS) break;
		limited += character;
		count += 1;
	}
	const trimmed = limited.replace(/^\.+/u, '');
	return trimmed === '' ? 'attachment' : trimmed;
}

function rfc2231(value: string): string {
	return encodeURIComponent(value).replaceAll(
		/['()*]/gu,
		(c) => `%${(c.codePointAt(0) ?? 0).toString(HEX).toUpperCase()}`,
	);
}

function attachmentPart(attachment: MailAttachment): string {
	const filename = safeFilename(attachment.filename);
	const fallback = filename.replaceAll(FILENAME_FALLBACK_FORBIDDEN, '_');
	return [
		`Content-Type: ${attachment.contentType}`,
		'Content-Transfer-Encoding: base64',
		`Content-Disposition: attachment;${CRLF} filename="${fallback}";${CRLF} filename*=UTF-8''${rfc2231(filename)}`,
		'',
		wrapBase64(attachment.bytes),
	].join(CRLF);
}

function multipart(
	type: 'alternative' | 'mixed',
	parts: readonly string[],
): { body: string; contentType: string } {
	const mark = boundary();
	const body = [...parts.flatMap((part) => [`--${mark}`, part]), `--${mark}--`, ''].join(CRLF);
	return { body, contentType: `multipart/${type}; boundary="${mark}"` };
}

/**
 * Builds the MIME text of a mail: `multipart/alternative` (text, HTML), wrapped in
 * `multipart/mixed` when there are attachments.
 *
 * @param mail The mail.
 * @param date The `Date` header's time.
 * @returns The message with CRLF line ends.
 */
function buildMime(mail: Readonly<OutgoingMail>, date: Date): string {
	const alternative = multipart('alternative', [
		textPart('text/plain', mail.text),
		textPart('text/html', mail.html),
	]);
	const top =
		mail.attachments.length === 0
			? alternative
			: multipart('mixed', [
					`Content-Type: ${alternative.contentType}${CRLF}${CRLF}${alternative.body}`,
					...mail.attachments.map((attachment) => attachmentPart(attachment)),
				]);

	const headers = [
		fromHeader(mail.from),
		...(mail.replyTo === null ? [] : [foldHeader('Reply-To', [address(mail.replyTo)])]),
		foldHeader('To', [address(mail.to)]),
		...(mail.bcc === null ? [] : [foldHeader('Bcc', [address(mail.bcc)])]),
		textHeader('Subject', mail.subject),
		`Date: ${formatDate(date)}`,
		foldHeader('Message-ID', [cleanHeaderText(mail.messageId)]),
		'MIME-Version: 1.0',
		...(mail.listUnsubscribe === null
			? []
			: [
					foldHeader('List-Unsubscribe', [`<${address(mail.listUnsubscribe)}>`]),
					'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
				]),
		`Content-Type: ${top.contentType}`,
	];
	return `${headers.join(CRLF)}${CRLF}${CRLF}${top.body}`;
}

/**
 * The size of a Graph request: the length of the base64 of the MIME text.
 *
 * @param mail The mail.
 * @param date The `Date` header's time.
 * @returns The length in bytes.
 */
function graphRequestBytes(mail: Readonly<OutgoingMail>, date: Date): number {
	return toBase64(encoder.encode(buildMime(mail, date))).length;
}

export { buildMime, GRAPH_REQUEST_LIMIT_BYTES, graphRequestBytes };
