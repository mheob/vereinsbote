/*
 * The expected refusals of the wave functions as the results the server functions return. A
 * missing right still throws `ForbiddenError`, as in every server function; anything else that is
 * no expected refusal stays an error.
 */
import type { Db } from '@/server/db/client';
import {
	OccasionChangedError,
	OccasionInvalidError,
	OccasionNotFoundError,
} from '@/server/occasions/errors';
import type { Principal } from '@/server/permissions/principal';

import { WaveAttachmentsGoneError } from './errors';
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

export { confirmWaveResult, summarizeWaveResult, waveFailure };
export type { ConfirmWaveResult, SummarizeWaveResult, WaveFailure };
