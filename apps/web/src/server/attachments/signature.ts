/* oxlint-disable no-magic-numbers -- the numbers are the specification of the three file signatures */
/*
 * What an attachment really is, and the name the recipients see. No server imports. The type
 * comes from the first bytes of the file, never from its name or from what the browser reports.
 */
import type { AttachmentType } from '@/server/sending/transport';

const MAX_NAME_LENGTH = 200;
const FALLBACK_NAME = 'Anhang';

const PDF = [37, 80, 68, 70, 45];
const JPEG = [255, 216, 255];
const PNG = [137, 80, 78, 71];

const EXTENSIONS: Readonly<Record<AttachmentType, string>> = {
	'application/pdf': 'pdf',
	'image/jpeg': 'jpg',
	'image/png': 'png',
};
/** Extensions the file name may carry; the one that fits the type replaces any of them. */
const KNOWN_EXTENSION = /\.(?:pdf|jpe?g|png)$/iu;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
	return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Reads the type of a file from its signature.
 *
 * @param bytes The content.
 * @returns The type, or null for anything but PDF, JPEG and PNG.
 */
function sniffAttachmentType(bytes: Uint8Array): AttachmentType | null {
	if (startsWith(bytes, PDF)) return 'application/pdf';
	if (startsWith(bytes, JPEG)) return 'image/jpeg';
	if (startsWith(bytes, PNG)) return 'image/png';
	return null;
}

/**
 * Reduces a reported file name to one a mail can carry: the last path segment, without control
 * characters and the characters that file systems and headers dislike, with the extension of the
 * sniffed type, at most 200 characters, valid Unicode. Umlauts stay.
 *
 * @param name The name the browser reported.
 * @param type The sniffed type.
 * @returns The name.
 */
function safeFileName(name: string, type: AttachmentType): string {
	const base = name.split(/[/\\]/u).pop() ?? '';
	const cleaned = base
		// oxlint-disable-next-line no-control-regex -- removing the control characters is the point
		.replaceAll(/[\u0000-\u001F\u007F"*:<>?|]/gu, '')
		.replaceAll(/\s+/gu, ' ')
		.trim()
		.replace(KNOWN_EXTENSION, '')
		.replace(/^\.+/u, '')
		.trim();
	const extension = `.${EXTENSIONS[type]}`;
	const room = MAX_NAME_LENGTH - extension.length;
	const stem = cleaned.slice(0, room).toWellFormed().trim();
	return `${stem === '' ? FALLBACK_NAME : stem}${extension}`;
}

export { safeFileName, sniffAttachmentType };
