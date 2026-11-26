import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { TEST_UNSUBSCRIBE_TOKEN } from '@/paths';
import type { UnsubscribePayload } from '@/server/unsubscribe/token';

/*
 * The server functions of the unsubscribe page (Design 12). They are public: the recipient of a mail
 * has no session, so none of them asks for one (`requireRequestPrincipal`); the token of the link
 * authorizes, and a token that does not open changes nothing. The CSRF middleware still guards them
 * (same origin), unlike the one-click POST of the route itself. Server modules are imported inside
 * the handlers, so they stay out of the client bundle.
 */

/** What the unsubscribe page shows: the page of a test mail, or the choice. Never a contact. */
type UnsubscribePageData =
	| Readonly<{ kind: 'test' }>
	| Readonly<{
			kind: 'choice';
			clubName: string;
			/** Null when the occasion no longer exists: only the area is offered. */
			occasionName: string | null;
			/** Null when the area no longer exists: only the occasion is offered. */
			areaName: string | null;
	  }>;

/**
 * An unsubscribe with its undo value (null when every contact was unsubscribed already, so nothing
 * changed and nothing can be undone), or why it was refused.
 */
type SubmitUnsubscribeResult =
	| Readonly<{ ok: true; undo: string | null }>
	| Readonly<{ ok: false; failure: 'gone' | 'invalid' }>;

/** An undone unsubscribe, or why it can no longer be undone. */
type UndoUnsubscribeResult = Readonly<{ ok: true }> | Readonly<{ ok: false; failure: 'expired' }>;

/** The longest token the server looks at; a token of a mail has at most 4096 characters. */
const MAX_TOKEN_INPUT = 10_000;
/** The longest undo value the server looks at; that of 180 contacts has about 11,000. */
const MAX_UNDO_INPUT = 100_000;

const pageRequest = z.object({ token: z.string() });
const submitRequest = z.object({
	scope: z.enum(['occasion', 'area']),
	token: z.string().max(MAX_TOKEN_INPUT),
});
const undoRequest = z.object({ undo: z.string().max(MAX_UNDO_INPUT) });

/**
 * Opens the token of a link with the key from the app secret. No database is opened for it.
 *
 * @param token The token.
 * @returns The payload, or null when the token does not open.
 */
async function openToken(token: string): Promise<UnsubscribePayload | null> {
	const [{ getAppEnv }, { deriveUnsubscribeKey, openUnsubscribe }] = await Promise.all([
		import('@/platform/context'),
		import('@/server/unsubscribe/token'),
	]);
	const { appSecret } = await getAppEnv();
	return openUnsubscribe(await deriveUnsubscribeKey(appSecret), token);
}

/**
 * The key of the undo values.
 *
 * @returns The key from the app secret.
 */
async function undoKey(): Promise<CryptoKey> {
	const [{ getAppEnv }, { deriveUndoKey }] = await Promise.all([
		import('@/platform/context'),
		import('@/server/unsubscribe/undo'),
	]);
	const { appSecret } = await getAppEnv();
	return deriveUndoKey(appSecret);
}

/**
 * The page of an unsubscribe link. It changes nothing: mail scanners open links. The link of a test
 * mail gives the test page; a token that does not open, or whose occasion and area are both gone,
 * the neutral "link invalid" page (not found).
 */
const loadUnsubscribePage = createServerFn({ method: 'POST' })
	.validator(pageRequest)
	.handler(async ({ data }): Promise<UnsubscribePageData> => {
		if (data.token === TEST_UNSUBSCRIBE_TOKEN) return { kind: 'test' };
		const payload = await openToken(data.token);
		// oxlint-disable-next-line typescript/only-throw-error -- the route shows its "link invalid" page
		if (payload === null) throw notFound();
		const [{ getAppContext }, { describeUnsubscribe }] = await Promise.all([
			import('@/platform/context'),
			import('@/server/unsubscribe/unsubscribe'),
		]);
		const { db } = await getAppContext();
		const page = await describeUnsubscribe(db, payload);
		// oxlint-disable-next-line typescript/only-throw-error -- see above
		if (!page.valid) throw notFound();
		const { areaName, clubName, occasionName } = page;
		return { areaName, clubName, kind: 'choice', occasionName };
	});

/**
 * Unsubscribes the contacts of a mail from its occasion or its area. The link of a test mail opens
 * no token and changes nothing, like any other token that does not open.
 */
const submitUnsubscribe = createServerFn({ method: 'POST' })
	.validator(submitRequest)
	.handler(async ({ data }): Promise<SubmitUnsubscribeResult> => {
		const payload = await openToken(data.token);
		if (payload === null) return { failure: 'invalid', ok: false };
		const [{ getAppContext }, { unsubscribe, UnsubscribeTargetGoneError }] = await Promise.all([
			import('@/platform/context'),
			import('@/server/unsubscribe/unsubscribe'),
		]);
		const { db } = await getAppContext();
		try {
			const { undo } = await unsubscribe(db, await undoKey(), payload, data.scope, new Date());
			return { ok: true, undo };
		} catch (error) {
			if (error instanceof UnsubscribeTargetGoneError) return { failure: 'gone', ok: false };
			throw error;
		}
	});

/** Takes an unsubscribe back within 30 minutes, with the undo value `submitUnsubscribe` gave. */
const submitUndoUnsubscribe = createServerFn({ method: 'POST' })
	.validator(undoRequest)
	.handler(async ({ data }): Promise<UndoUnsubscribeResult> => {
		const [{ getAppContext }, { undoUnsubscribe }] = await Promise.all([
			import('@/platform/context'),
			import('@/server/unsubscribe/unsubscribe'),
		]);
		const key = await undoKey();
		const { db } = await getAppContext();
		const undone = await undoUnsubscribe(db, key, data.undo, new Date());
		return undone ? { ok: true } : { failure: 'expired', ok: false };
	});

export { loadUnsubscribePage, submitUndoUnsubscribe, submitUnsubscribe };
export type { SubmitUnsubscribeResult, UndoUnsubscribeResult, UnsubscribePageData };
