import { setTimeout as sleep } from 'node:timers/promises';

import { z } from 'zod';

/** Mailpit's API (`docker/compose.dev.yml`, in CI the job's service container). */
const MAILPIT_API = 'http://localhost:8025/api/v1';

/** How long `latestLink` waits for the mail: login links are sent after the response. */
const LINK_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 250;

const messageSummary = z.object({ ID: z.string() });
const searchResult = z.object({ messages: z.array(messageSummary) });
const message = z.object({ Text: z.string() });
const mailAddress = z.object({ Address: z.string() });
const listedMessage = z.object({
	From: mailAddress,
	ID: z.string(),
	Subject: z.string(),
	To: z.array(mailAddress).nullable(),
});
const listing = z.object({ messages: z.array(listedMessage) });
const attachment = z.object({ ContentType: z.string(), FileName: z.string() });
const linkList = z.array(z.string()).nullable();
const messageDetail = z.object({
	Attachments: z.array(attachment),
	ListUnsubscribe: z.object({ HeaderPost: z.string(), Links: linkList }),
	MessageID: z.string(),
	Text: z.string(),
});
const htmlMessage = z.object({ HTML: z.string() });
const htmlCheck = z.object({ Total: z.object({ Supported: z.number() }) });

/**
 * Calls the Mailpit API.
 *
 * @param path The path below `/api/v1`.
 * @param method The HTTP method.
 * @returns The response, which is ok.
 */
async function mailpit(path: string, method = 'GET'): Promise<Response> {
	const response = await fetch(`${MAILPIT_API}${path}`, { method });
	if (!response.ok) throw new Error(`Mailpit ${method} ${path} answered ${response.status}.`);
	return response;
}

/**
 * Reads from the Mailpit API.
 *
 * @param path The path below `/api/v1`.
 * @returns The response body, parsed as JSON.
 */
async function mailpitJson(path: string): Promise<unknown> {
	const response = await mailpit(path);
	const body: unknown = await response.json();
	return body;
}

/** Deletes all messages, so a run only sees its own mails. Mailpit answers with plain text. */
async function deleteAllMessages(): Promise<void> {
	await mailpit('/messages', 'DELETE');
}

/**
 * The plain text of a message.
 *
 * @param id The message's ID.
 * @returns The text.
 */
async function messageText(id: string): Promise<string> {
	const { Text } = message.parse(await mailpitJson(`/message/${id}`));
	return Text;
}

/**
 * The first link matching the pattern in the mails to an address, newest mail first.
 *
 * @param to The recipient address.
 * @param pattern The pattern the link must match.
 * @returns The link, or null when no mail has one yet.
 */
async function findLink(to: string, pattern: Readonly<RegExp>): Promise<string | null> {
	const query = new URLSearchParams({ query: `to:"${to}"` });
	const { messages } = searchResult.parse(await mailpitJson(`/search?${query}`));
	const texts = await Promise.all(messages.map(async ({ ID }) => messageText(ID)));
	const links = texts.flatMap((text) => text.match(/https?:\/\/\S+/gu) ?? []);
	return links.find((link) => pattern.test(link)) ?? null;
}

/**
 * Waits for a mail to the address with a link that matches the pattern and returns that link.
 * Mailpit lists the newest mail first, so a later mail wins over an earlier one.
 *
 * @param to The recipient address.
 * @param pattern The pattern the link must match.
 * @returns The link.
 */
async function latestLink(to: string, pattern: Readonly<RegExp>): Promise<string> {
	const deadline = Date.now() + LINK_TIMEOUT_MS;
	for (;;) {
		// oxlint-disable-next-line no-await-in-loop -- polling: each attempt waits for the previous one
		const link = await findLink(to, pattern);
		if (link !== null) return link;
		if (Date.now() > deadline)
			throw new Error(`No mail to ${to} with a link matching ${pattern.source}.`);
		// oxlint-disable-next-line no-await-in-loop -- see above
		await sleep(POLL_INTERVAL_MS);
	}
}

/** A message as the inbox lists it. */
interface ListedMessage {
	readonly id: string;
	readonly subject: string;
	readonly from: string;
	readonly to: readonly string[];
}

/** What the tests read of one message besides its body. */
interface MessageDetails {
	/** The Message-ID without angle brackets, as Mailpit gives it. */
	readonly messageId: string;
	readonly attachments: readonly Readonly<{ name: string; contentType: string }>[];
	/** The links of the `List-Unsubscribe` header. */
	readonly unsubscribeLinks: readonly string[];
	/** The value of the `List-Unsubscribe-Post` header, empty without one. */
	readonly unsubscribePost: string;
	readonly text: string;
}

/**
 * Every message in the inbox, oldest first. Mailpit lists them by the time they arrived.
 *
 * @returns The ID, the subject, the sender and the recipients of each.
 */
async function listMessages(): Promise<ListedMessage[]> {
	const { messages } = listing.parse(await mailpitJson('/messages?limit=500'));
	return messages.toReversed().map(({ From, ID, Subject, To }) => ({
		from: From.Address,
		id: ID,
		subject: Subject,
		to: (To ?? []).map(({ Address }) => Address),
	}));
}

/**
 * The messages to an address, oldest first.
 *
 * @param to The recipient address.
 * @returns The messages.
 */
async function messagesTo(to: string): Promise<ListedMessage[]> {
	const messages = await listMessages();
	return messages.filter((entry) => entry.to.includes(to));
}

/**
 * The Message-ID, the attachments, the unsubscribe headers and the plain text of a message.
 *
 * @param id The message's ID.
 * @returns The details.
 */
async function messageDetails(id: string): Promise<MessageDetails> {
	const detail = messageDetail.parse(await mailpitJson(`/message/${id}`));
	return {
		attachments: detail.Attachments.map(({ ContentType, FileName }) => ({
			contentType: ContentType,
			name: FileName,
		})),
		messageId: detail.MessageID,
		text: detail.Text,
		unsubscribeLinks: detail.ListUnsubscribe.Links ?? [],
		unsubscribePost: detail.ListUnsubscribe.HeaderPost,
	};
}

/**
 * The HTML of a message.
 *
 * @param id The message's ID.
 * @returns The HTML.
 */
async function messageHtml(id: string): Promise<string> {
	return htmlMessage.parse(await mailpitJson(`/message/${id}`)).HTML;
}

/**
 * Mailpit's check of the HTML against the CSS and HTML support of mail clients (caniemail).
 *
 * @param id The message's ID.
 * @returns The share of supported features, in percent.
 */
async function supportedShare(id: string): Promise<number> {
	return htmlCheck.parse(await mailpitJson(`/message/${id}/html-check`)).Total.Supported;
}

export {
	deleteAllMessages,
	latestLink,
	listMessages,
	messageDetails,
	messageHtml,
	messagesTo,
	supportedShare,
};
export type { ListedMessage, MessageDetails };
