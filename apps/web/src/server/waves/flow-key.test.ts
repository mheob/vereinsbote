import { describe, expect, it } from 'vite-plus/test';
import { z } from 'zod';

import { testEnv } from '@/server/sending/testing';

import { deriveFlowKey, flowRequestId } from './flow-key';

const USER = 'user-1';
const OTHER_USER = 'user-2';
const OCCASION = '11111111-1111-4111-8111-111111111111';
const OTHER_OCCASION = '22222222-2222-4222-8222-222222222222';
const WAVE = '33333333-3333-4333-8333-333333333333';
const OTHER_WAVE = '44444444-4444-4444-8444-444444444444';

describe(flowRequestId, () => {
	it('gives the same key for the same user, occasion and newest wave', async () => {
		const key = await deriveFlowKey(testEnv().appSecret);
		const flow = { newestWaveId: null, occasionId: OCCASION, userId: USER };
		const first = await flowRequestId(key, flow);
		await expect(flowRequestId(key, { ...flow })).resolves.toBe(first);
		// The same secret gives the same key in another request.
		const again = await deriveFlowKey(testEnv().appSecret);
		await expect(flowRequestId(again, flow)).resolves.toBe(first);
		expect(z.uuid().safeParse(first).success).toBe(true);
	});

	it('gives another key for another user, occasion or newest wave', async () => {
		const key = await deriveFlowKey(testEnv().appSecret);
		const flow = { newestWaveId: WAVE, occasionId: OCCASION, userId: USER };
		const keys = await Promise.all(
			[
				flow,
				{ ...flow, userId: OTHER_USER },
				{ ...flow, occasionId: OTHER_OCCASION },
				{ ...flow, newestWaveId: OTHER_WAVE },
				{ ...flow, newestWaveId: null },
			].map(async (each) => flowRequestId(key, each)),
		);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('depends on the app secret', async () => {
		const flow = { newestWaveId: null, occasionId: OCCASION, userId: USER };
		const ours = await deriveFlowKey(testEnv().appSecret);
		const theirs = await deriveFlowKey(new Uint8Array(32).fill(1));
		const expected = await flowRequestId(ours, flow);
		await expect(flowRequestId(theirs, flow)).resolves.not.toBe(expected);
	});
});
