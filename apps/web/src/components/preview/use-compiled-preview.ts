/*
 * Compiles the template in the browser and fills it for the preview contact, with the same module
 * that sends the mails (`@/mail/render`). The renderer and the stream polyfill load only in the
 * browser, when a preview is first asked for: the server render of a page that shows the
 * preview never touches them.
 *
 * A template is not tied to an occasion, so the editor's preview compiles without the unsubscribe
 * link, unless the template places `{{unsubscribe.url}}` itself: then it shows that link (`auto`).
 * The send flow knows its occasion and compiles as a wave does: with the link or without it. The
 * link leads to the page of test mails, which changes nothing.
 */
import { useEffect, useState } from 'react';

import { DEFAULT_LOCALE } from '@/i18n/locale';
import type { Brand } from '@/mail/brand/brand-schema';
import { UNSUBSCRIBE_URL_KEY } from '@/mail/placeholders/registry';
import type { CompileResult, MailSource } from '@/mail/render/compile';
import type { FilledMail } from '@/mail/render/fill';
import { TEST_UNSUBSCRIBE_PATH } from '@/paths';

type PreviewState =
	| { readonly kind: 'pending' }
	| { readonly kind: 'ready'; readonly mail: Readonly<FilledMail> }
	/** `brand`: the keys are brand values the CD lacks; else values the contact lacks. */
	| { readonly kind: 'missing'; readonly keys: readonly string[]; readonly brand: boolean }
	| { readonly kind: 'invalid' };

/**
 * Whether the mail carries the unsubscribe link: `with` and `without` as the occasion says, `auto`
 * only where the template places it (the editor, which knows no occasion).
 */
type PreviewUnsubscribe = 'auto' | 'with' | 'without';

/** How long the preview waits after the last change before it compiles again. */
const PREVIEW_DELAY_MS = 300;

/**
 * Compiles a source with or without the unsubscribe link.
 *
 * @param source The source.
 * @param brand The brand.
 * @param appOrigin The origin of the app.
 * @param unsubscribe Whether the link goes in.
 * @returns What `compileMail` gives.
 */
// oxlint-disable-next-line max-params -- the parameters of `computePreview` that compiling needs
async function compileFor(
	source: Readonly<MailSource>,
	brand: Brand,
	appOrigin: string,
	unsubscribe: PreviewUnsubscribe,
): Promise<CompileResult> {
	const { compileMail } = await import('@/mail/render/compile');
	if (unsubscribe === 'with') {
		return compileMail(source, brand, appOrigin, DEFAULT_LOCALE, { unsubscribe: true });
	}
	const plain = await compileMail(source, brand, appOrigin);
	// Refused only because the template places the unsubscribe link: show it with the link.
	const placesLink = !plain.ok && 'invalid' in plain && plain.invalid === 'unsubscribe';
	return placesLink && unsubscribe === 'auto'
		? compileMail(source, brand, appOrigin, DEFAULT_LOCALE, { unsubscribe: true })
		: plain;
}

/**
 * Compiles a source and fills it for a contact.
 *
 * @param source The subject, preview text, body and images.
 * @param brand The brand.
 * @param appOrigin The origin of the app, for the images' addresses.
 * @param values The placeholder values of the preview contact.
 * @param unsubscribe Whether the mail carries the unsubscribe link.
 * @returns The mail, or what the preview lacks, or that the source is invalid.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
async function computePreview(
	source: Readonly<MailSource>,
	brand: Brand,
	appOrigin: string,
	values: ReadonlyMap<string, string>,
	unsubscribe: PreviewUnsubscribe = 'auto',
): Promise<PreviewState> {
	const [{ ensureReadableByteStreams }, { fillMail }] = await Promise.all([
		import('./readable-stream-polyfill'),
		import('@/mail/render/fill'),
	]);
	await ensureReadableByteStreams();
	const compiled = await compileFor(source, brand, appOrigin, unsubscribe);
	if (!compiled.ok) {
		return 'missingBrand' in compiled
			? { brand: true, keys: compiled.missingBrand, kind: 'missing' }
			: { kind: 'invalid' };
	}
	const testLink = `${new URL(appOrigin).origin}${TEST_UNSUBSCRIBE_PATH}`;
	const filled = fillMail(compiled.mail, new Map([...values, [UNSUBSCRIBE_URL_KEY, testLink]]));
	return filled.ok
		? { kind: 'ready', mail: filled.mail }
		: { brand: false, keys: filled.missing, kind: 'missing' };
}

/**
 * The result of a compile; a compile that throws is an invalid preview.
 *
 * @param compute Compiles and fills.
 * @returns The state.
 */
async function settled(compute: () => Promise<PreviewState>): Promise<PreviewState> {
	try {
		return await compute();
	} catch {
		return { kind: 'invalid' };
	}
}

/**
 * Compiles after a delay and hands the result over, unless it was cancelled meanwhile.
 *
 * @param compute Compiles and fills.
 * @param publish Receives the state; never called after the cancel function ran.
 * @param delayMs The delay.
 * @returns The cancel function: it stops a pending compile and drops a result still on its way.
 */
function schedulePreview(
	compute: () => Promise<PreviewState>,
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a callback is behavior, not data
	publish: (state: PreviewState) => void,
	delayMs: number,
): () => void {
	let current = true;
	async function run(): Promise<void> {
		const next = await settled(compute);
		if (current) publish(next);
	}
	const timer = setTimeout(() => {
		// oxlint-disable-next-line no-void -- `run` never rejects: `settled` catches a failed compile
		void run();
	}, delayMs);
	return () => {
		current = false;
		clearTimeout(timer);
	};
}

/**
 * The preview of a source: `pending` until the first result, then the latest one. A change
 * compiles after `delayMs` without another change; a result that a later change overtook is
 * dropped. A failure to compile (not a missing value) shows as `invalid`.
 *
 * @param source The source; give the same object while it does not change.
 * @param brand The brand.
 * @param appOrigin The origin of the app.
 * @param values The placeholder values of the preview contact.
 * @param options The delay after the last change, and whether the mail carries the unsubscribe
 *   link (`auto` by default: only where the template places it).
 * @param options.delayMs The delay after the last change.
 * @param options.unsubscribe Whether the mail carries the unsubscribe link.
 * @returns The state of the preview.
 */
// oxlint-disable-next-line max-params -- the plan's interface fixes these parameters
function useCompiledPreview(
	source: Readonly<MailSource>,
	brand: Brand,
	appOrigin: string,
	values: ReadonlyMap<string, string>,
	options: Readonly<{ delayMs?: number; unsubscribe?: PreviewUnsubscribe }> = {},
): PreviewState {
	const { delayMs = PREVIEW_DELAY_MS, unsubscribe = 'auto' } = options;
	const [state, setState] = useState<PreviewState>({ kind: 'pending' });
	useEffect(
		() =>
			schedulePreview(
				async () => computePreview(source, brand, appOrigin, values, unsubscribe),
				setState,
				delayMs,
			),
		[source, brand, appOrigin, values, delayMs, unsubscribe],
	);
	return state;
}

export { computePreview, PREVIEW_DELAY_MS, schedulePreview, useCompiledPreview };
export type { PreviewState, PreviewUnsubscribe };
