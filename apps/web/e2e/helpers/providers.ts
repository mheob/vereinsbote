import { z } from 'zod';

/** The control endpoints of the fake Graph and Resend server (`e2e/fakes/providers.ts`). */
const PROVIDERS_URL = 'http://localhost:3200';

const webhookResult = z.object({ status: z.number() });
const recorded = z.array(
	z.object({ method: z.string(), path: z.string(), savedToSentItems: z.boolean().optional() }),
);

async function post(path: string, body: unknown): Promise<Response> {
	const response = await fetch(`${PROVIDERS_URL}/__control${path}`, {
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
	});
	if (!response.ok) throw new Error(`Fake providers ${path} answered ${response.status}.`);
	return response;
}

/** Forgets the recorded requests, the sender list, the bounce reports and the idempotency keys. */
async function resetProviders(): Promise<void> {
	await post('/reset', {});
}

/**
 * Sets the mailboxes whose inbox the fake Graph lets the app read; every other mailbox answers
 * 403, except `readable@verein.test`.
 *
 * @param mailboxes The sender mailboxes.
 */
async function setSenders(mailboxes: readonly string[]): Promise<void> {
	await post('/senders', { mailboxes });
}

/**
 * Puts a bounce report into a mailbox's inbox.
 *
 * @param input The mailbox, the Message-ID of the mail that bounced and whether it is permanent.
 */
async function addNdr(
	input: Readonly<{ mailbox: string; originalMessageId: string; hard: boolean }>,
): Promise<void> {
	await post('/graph/ndr', input);
}

/**
 * Sends a signed Resend webhook to the app.
 *
 * @param input Where and how to send it: the app, the connection, the signing secret and the event.
 * @returns The HTTP status of the app.
 */
async function sendResendWebhook(
	input: Readonly<{
		appUrl: string;
		connectionId: string;
		secret: string;
		emailId: string;
		type: 'bounce' | 'complaint' | 'other';
		hard?: boolean;
	}>,
): Promise<number> {
	const response = await post('/resend/webhook', input);
	return webhookResult.parse(await response.json()).status;
}

/** @returns The requests the fake has answered since the last reset (control calls excluded). */
async function recordedRequests(): Promise<z.infer<typeof recorded>> {
	const response = await fetch(`${PROVIDERS_URL}/__control/requests`);
	return recorded.parse(await response.json());
}

export { addNdr, recordedRequests, resetProviders, sendResendWebhook, setSenders };
