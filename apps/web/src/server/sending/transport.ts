/*
 * The seam between the outbox and a mail provider. Pure types and two helpers: it runs on Node,
 * on Vercel and on Workers.
 */

type AttachmentType = 'application/pdf' | 'image/jpeg' | 'image/png';

interface MailAttachment {
	readonly filename: string;
	readonly contentType: AttachmentType;
	readonly bytes: Uint8Array;
}

interface OutgoingMail {
	/** `system`: Graph JSON without a stored copy, no archive copy. */
	readonly kind: 'regular' | 'system';
	readonly from: Readonly<{ address: string; name: string }>;
	readonly replyTo: string | null;
	readonly to: string;
	readonly bcc: string | null;
	readonly subject: string;
	readonly html: string;
	readonly text: string;
	readonly messageId: string;
	/** A URL; it also sets `List-Unsubscribe-Post`. */
	readonly listUnsubscribe: string | null;
	readonly attachments: readonly MailAttachment[];
	readonly idempotencyKey: string | null;
}

/**
 * `uncertain`: the request went out and the outcome is unknown (a time-out, a network error or a
 * server error after sending); the mail may be on its way and is never resent automatically.
 */
type SendFailureClass = 'transient' | 'rejected' | 'unauthorized' | 'quota' | 'uncertain';

type SendResult =
	| { ok: true; providerId: string | null }
	| { ok: false; failure: SendFailureClass; code: string; retryAfterMs: number | null };

interface BounceReport {
	readonly reportId: string;
	readonly originalMessageId: string;
	readonly hard: boolean;
	readonly receivedAt: Date;
}

/**
 * What the idempotency key of a provider protects (ruling R7): a retry with the same key cannot
 * send twice, but only while the provider still keeps the key.
 */
interface IdempotencyWindow {
	/** How long after the first attempt of a mail a retry with its key is still safe. */
	readonly trustedMs: number;
	/** Whether a refusal with this code leaves open that the provider took the mail. */
	readonly mayHaveSent: (code: string) => boolean;
}

interface Transport {
	readonly send: (mail: Readonly<OutgoingMail>) => Promise<SendResult>;
	/**
	 * Resend: the lifetime of its keys. Absent for a provider without keys (Graph), which answers
	 * `uncertain` instead of `transient` when a mail may have gone.
	 */
	readonly idempotency?: IdempotencyWindow;
	/** Graph: fetch a token. Resend: `null`. */
	readonly probe: (() => Promise<SendResult>) | null;
	readonly fetchBounces:
		| ((
				since: Date | null,
				limit: number,
		  ) => Promise<{ reports: BounceReport[]; until: Date | null }>)
		| null;
}

const RANDOM_BYTES = 16;
const MS_PER_SECOND = 1000;

/**
 * Makes a Message-ID: 22 base64url characters (16 random bytes) and the domain of the sender.
 *
 * @param senderAddress The sender's address.
 * @returns The id with angle brackets.
 */
function newMessageId(senderAddress: string): string {
	const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_BYTES));
	const random = btoa(String.fromCodePoint(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
	const domain = senderAddress.slice(senderAddress.lastIndexOf('@') + 1);
	return `<${random}@${domain}>`;
}

const SECONDS = /^\d+$/u;
const HTTP_DATE = /^[A-Za-z]{3}, /u;

/**
 * Reads `Retry-After`, either seconds or an HTTP date.
 *
 * @param headers The response headers.
 * @param now The current time.
 * @returns The wait in milliseconds (never negative), or `null` without a usable header.
 */
function retryAfterMs(headers: Headers, now: Date): number | null {
	const value = headers.get('retry-after')?.trim() ?? '';
	if (value === '') return null;
	if (SECONDS.test(value)) return Number(value) * MS_PER_SECOND;
	const at = HTTP_DATE.test(value) ? Date.parse(value) : Number.NaN;
	return Number.isNaN(at) ? null : Math.max(0, at - now.getTime());
}

export { newMessageId, retryAfterMs };
export type {
	AttachmentType,
	BounceReport,
	IdempotencyWindow,
	MailAttachment,
	OutgoingMail,
	SendFailureClass,
	SendResult,
	Transport,
};
