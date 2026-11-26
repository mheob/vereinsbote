/*
 * The expected refusals of the wave functions (summary, confirmation, stop, sending an uncertain
 * entry again) and of the send flow (search, preview, test mail) as the results the server
 * functions return. A missing right still throws `ForbiddenError`, as in every server function;
 * anything else that is no expected refusal stays an error.
 */
import { ContactNotFoundError } from '@/server/contacts/errors';
import type { Db } from '@/server/db/client';
import {
	OccasionChangedError,
	OccasionInvalidError,
	OccasionNotFoundError,
} from '@/server/occasions/errors';
import type { Principal } from '@/server/permissions/principal';

import {
	TestMailNotSentError,
	WaveAttachmentsGoneError,
	WaveEntryNotFoundError,
	WaveEntryStateError,
	WaveNotFoundError,
	WaveStoppedError,
} from './errors';
import { recipientPreview } from './recipient-preview';
import type { RecipientPreview } from './recipient-preview';
import { searchRecipients } from './recipient-search';
import type { RecipientChoice } from './recipient-search';
import type { RecipientSelection } from './recipients';
import { resendUncertain, stopWave } from './stop';
import { sendTestMail } from './test-mail';
import type { TestMailDeps, TestMailInput } from './test-mail';
import type { TestMailRefusal } from './test-mail-content';
import { confirmWave, summarizeWave } from './waves';
import type { WaveConfirmation, WaveRefusal, WaveSummary, WaveSummaryInput } from './waves';

/**
 * Why a summary or a confirmation failed: the occasion is gone, was archived or changed meanwhile,
 * or a chosen file is no free attachment of the occasion any more.
 */
type WaveFailure = Readonly<{
	ok: false;
	failure: 'archived' | 'attachmentsGone' | 'changed' | 'gone';
}>;

type SummarizeWaveResult = Readonly<{ ok: true; summary: WaveSummary }> | WaveFailure;

type ConfirmWaveResult =
	| Readonly<{ ok: true; waveId: string; mails: number }>
	| Readonly<{ ok: false; failure: 'refused'; reason: WaveRefusal }>
	| WaveFailure;

/** A stop: how many entries it cancelled, or the wave is gone. */
type StopWaveResult =
	| Readonly<{ ok: true; cancelled: number }>
	| Readonly<{ ok: false; failure: 'gone' }>;

/**
 * Sending an uncertain entry again: done, the entry is gone, it is no longer uncertain (another
 * person sent it again already), or its wave was stopped.
 */
type ResendUncertainResult =
	| Readonly<{ ok: true }>
	| Readonly<{ ok: false; failure: 'gone' | 'notUncertain' | 'stopped' }>;

/** The contacts a search of the send flow found. */
type SearchRecipientsResult =
	| Readonly<{ ok: true; contacts: readonly RecipientChoice[] }>
	| WaveFailure;

/** The preview of a contact of the send flow, or the contact is gone. */
type RecipientPreviewResult =
	| Readonly<{ ok: true; preview: RecipientPreview }>
	| Readonly<{ ok: false; failure: 'contactGone' }>
	| WaveFailure;

/**
 * A test mail: done, refused before anything went out (`keys`: the missing required values), the
 * contact is gone, or the provider did not take it (`notSent`) or its answer is unclear
 * (`uncertain`: it may still arrive).
 */
type SendTestMailResult =
	| Readonly<{ ok: true }>
	| Readonly<{ ok: false; failure: 'refused'; reason: TestMailRefusal; keys: readonly string[] }>
	| Readonly<{ ok: false; failure: 'contactGone' | 'notSent' | 'uncertain' }>
	| WaveFailure;

/**
 * The result for an error of a summary or a confirmation.
 *
 * @param error What was thrown.
 * @returns The failure, or null when the error is not an expected refusal.
 */
function waveFailure(error: unknown): WaveFailure | null {
	if (error instanceof OccasionNotFoundError) return { failure: 'gone', ok: false };
	if (error instanceof OccasionChangedError) return { failure: 'changed', ok: false };
	if (error instanceof OccasionInvalidError && error.problem === 'archived') {
		return { failure: 'archived', ok: false };
	}
	if (error instanceof WaveAttachmentsGoneError) return { failure: 'attachmentsGone', ok: false };
	return null;
}

/**
 * Summarizes a wave and turns the expected refusals into results.
 *
 * @param db The database.
 * @param actor Who sends.
 * @param input The occasion, the selection and the attachments.
 * @param appOrigin The origin of the app.
 * @param now The instant.
 * @returns The summary, or why there is none.
 */
// oxlint-disable-next-line max-params -- the same parameters as `summarizeWave`
async function summarizeWaveResult(
	db: Db,
	actor: Principal,
	input: Readonly<WaveSummaryInput>,
	appOrigin: string,
	now: Date,
): Promise<SummarizeWaveResult> {
	try {
		return { ok: true, summary: await summarizeWave(db, actor, input, appOrigin, now) };
	} catch (error) {
		const failure = waveFailure(error);
		if (failure === null) throw error;
		return failure;
	}
}

/**
 * Confirms a wave and turns its refusals and the expected errors into results.
 *
 * @param db The database.
 * @param actor Who sends.
 * @param input The confirmation.
 * @param appOrigin The origin of the app.
 * @param now The instant.
 * @returns The wave, or why there is none.
 */
// oxlint-disable-next-line max-params -- the same parameters as `confirmWave`
async function confirmWaveResult(
	db: Db,
	actor: Principal,
	input: Readonly<WaveConfirmation>,
	appOrigin: string,
	now: Date,
): Promise<ConfirmWaveResult> {
	try {
		const confirmed = await confirmWave(db, actor, input, appOrigin, now);
		if ('refused' in confirmed) return { failure: 'refused', ok: false, reason: confirmed.refused };
		return { mails: confirmed.mails, ok: true, waveId: confirmed.waveId };
	} catch (error) {
		const failure = waveFailure(error);
		if (failure === null) throw error;
		return failure;
	}
}

/**
 * Stops a wave and turns a gone wave into a result.
 *
 * @param db The database.
 * @param actor Who stops.
 * @param waveId The wave.
 * @returns How many entries were cancelled, or that the wave is gone.
 */
async function stopWaveResult(db: Db, actor: Principal, waveId: string): Promise<StopWaveResult> {
	try {
		return { ok: true, ...(await stopWave(db, actor, waveId)) };
	} catch (error) {
		if (error instanceof WaveNotFoundError) return { failure: 'gone', ok: false };
		throw error;
	}
}

/**
 * Sends an uncertain entry again and turns its refusals into results.
 *
 * @param db The database.
 * @param actor Who decides.
 * @param entryId The entry.
 * @returns Done, or why not.
 */
async function resendUncertainResult(
	db: Db,
	actor: Principal,
	entryId: string,
): Promise<ResendUncertainResult> {
	try {
		await resendUncertain(db, actor, entryId);
		return { ok: true };
	} catch (error) {
		if (error instanceof WaveEntryNotFoundError) return { failure: 'gone', ok: false };
		if (error instanceof WaveEntryStateError) return { failure: 'notUncertain', ok: false };
		if (error instanceof WaveStoppedError) return { failure: 'stopped', ok: false };
		throw error;
	}
}

/**
 * Searches the contacts of the send flow and turns the expected refusals into results.
 *
 * @param db The database.
 * @param actor Who sends.
 * @param input The occasion, the selection to search in and the term.
 * @param now The instant.
 * @returns The contacts, or why there are none.
 */
// oxlint-disable-next-line max-params -- the same parameters as `searchRecipients`
async function searchRecipientsResult(
	db: Db,
	actor: Principal,
	input: Readonly<{ occasionId: string; selection: RecipientSelection; term: string }>,
	now: Date,
): Promise<SearchRecipientsResult> {
	try {
		return { contacts: await searchRecipients(db, actor, input, now), ok: true };
	} catch (error) {
		const failure = waveFailure(error);
		if (failure === null) throw error;
		return failure;
	}
}

/**
 * The preview of a contact of the send flow, with the expected refusals as results.
 *
 * @param db The database.
 * @param actor Who sends.
 * @param input The occasion, the contact and the selection.
 * @param now The instant.
 * @returns The preview, or why there is none.
 */
// oxlint-disable-next-line max-params -- the same parameters as `recipientPreview`
async function recipientPreviewResult(
	db: Db,
	actor: Principal,
	input: Readonly<{ occasionId: string; contactId: string; selection: RecipientSelection }>,
	now: Date,
): Promise<RecipientPreviewResult> {
	try {
		return { ok: true, preview: await recipientPreview(db, actor, input, now) };
	} catch (error) {
		if (error instanceof ContactNotFoundError) return { failure: 'contactGone', ok: false };
		const failure = waveFailure(error);
		if (failure === null) throw error;
		return failure;
	}
}

/**
 * The result for an error of a test mail.
 *
 * @param error What was thrown.
 * @returns The failure, or null when the error is not an expected refusal.
 */
function testMailFailure(error: unknown): SendTestMailResult | null {
	if (error instanceof ContactNotFoundError) return { failure: 'contactGone', ok: false };
	if (error instanceof TestMailNotSentError) {
		return { failure: error.uncertain ? 'uncertain' : 'notSent', ok: false };
	}
	return waveFailure(error);
}

/**
 * Sends a test mail and turns its refusals and the expected errors into results.
 *
 * @param deps The database, the environment, the storage, `fetch` and the clock.
 * @param actor Who tests.
 * @param input The occasion, the contact and the files.
 * @returns Done, or why not.
 */
async function sendTestMailResult(
	deps: TestMailDeps,
	actor: Principal,
	input: TestMailInput,
): Promise<SendTestMailResult> {
	try {
		const result = await sendTestMail(deps, actor, input);
		if ('ok' in result) return { ok: true };
		return { failure: 'refused', keys: result.keys ?? [], ok: false, reason: result.refused };
	} catch (error) {
		const failure = testMailFailure(error);
		if (failure === null) throw error;
		return failure;
	}
}

export {
	confirmWaveResult,
	recipientPreviewResult,
	resendUncertainResult,
	searchRecipientsResult,
	sendTestMailResult,
	stopWaveResult,
	summarizeWaveResult,
	waveFailure,
};
export type {
	ConfirmWaveResult,
	RecipientPreviewResult,
	ResendUncertainResult,
	SearchRecipientsResult,
	SendTestMailResult,
	StopWaveResult,
	SummarizeWaveResult,
	WaveFailure,
};
