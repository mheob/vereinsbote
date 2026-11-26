/*
 * The unsubscribe link of a mail (Design 12): the app's address, the unsubscribe page and the
 * mail's token. The same link goes into the mail and into its `List-Unsubscribe` header.
 */
import { UNSUBSCRIBE_PATH } from '@/paths';
import type { ContactKind } from '@/server/contacts/fields';

import { sealUnsubscribe, unsubscribePayload, unsubscribeTokenLength } from './token';
import type { UnsubscribePayload } from './token';

/**
 * The link to the unsubscribe page with a token.
 *
 * @param appOrigin The origin of the app (`APP_URL`).
 * @param token The token, sealed or a stand-in of its length.
 * @returns `<origin>/unsubscribe/<token>`.
 */
function unsubscribeLink(appOrigin: string, token: string): string {
	return `${appOrigin}${UNSUBSCRIBE_PATH}/${token}`;
}

/**
 * The unsubscribe link of a mail.
 *
 * @param appUrl The address of the app (`APP_URL`).
 * @param key The key of `deriveUnsubscribeKey`.
 * @param payload The contacts of the mail, its occasion and its area.
 * @returns `${APP_URL}/unsubscribe/<token>`; the same for the same payload.
 */
async function unsubscribeUrl(
	appUrl: URL,
	key: CryptoKey,
	payload: Readonly<UnsubscribePayload>,
): Promise<string> {
	return unsubscribeLink(appUrl.origin, await sealUnsubscribe(key, payload));
}

/**
 * A link of the length the longest link of some mails gets, for measuring a mail before any token
 * exists (the Graph size probe of a wave): its token is a stand-in as long as the longest token of
 * the mails, every contact of each mail named.
 *
 * @param appOrigin The origin of the app (`APP_URL`).
 * @param target The occasion and its area.
 * @param target.occasionId The occasion.
 * @param target.areaId Its area.
 * @param mails The contacts of each mail.
 * @returns The link.
 */
function standInUnsubscribeLink(
	appOrigin: string,
	target: Readonly<{ occasionId: string; areaId: string }>,
	mails: readonly Readonly<{
		contacts: readonly Readonly<{ kind: ContactKind; contactKey: string }>[];
	}>[],
): string {
	let longest = 0;
	for (const { contacts } of mails) {
		longest = Math.max(longest, unsubscribeTokenLength(unsubscribePayload(target, contacts)));
	}
	return unsubscribeLink(appOrigin, 'x'.repeat(longest));
}

export { standInUnsubscribeLink, unsubscribeLink, unsubscribeUrl };
