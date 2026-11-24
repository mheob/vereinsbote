import { neonConfig } from '@neondatabase/serverless';
import { describe, expect, it } from 'vite-plus/test';

import { openDb } from './client';

const DATABASE_URL = 'postgres://vereinsbote:vereinsbote@postgres:5432/vereinsbote';

// The tests run in this order: the proxy changes Neon's global settings for good.
describe('the neon driver', () => {
	it('speaks TLS to Neon by default', async () => {
		const { end } = await openDb(DATABASE_URL, 'neon');
		await end();
		expect(neonConfig.useSecureWebSocket).toBe(true);
	});

	it('speaks plain WebSocket to a local Neon proxy, without pipelining', async () => {
		const { end } = await openDb(DATABASE_URL, 'neon', { devNeonWsProxy: 'localhost:4444/v1' });
		await end();
		expect({
			pipelineConnect: neonConfig.pipelineConnect,
			pipelineTLS: neonConfig.pipelineTLS,
			useSecureWebSocket: neonConfig.useSecureWebSocket,
			wsProxy: neonConfig.wsProxy,
		}).toStrictEqual({
			pipelineConnect: false,
			pipelineTLS: false,
			useSecureWebSocket: false,
			wsProxy: 'localhost:4444/v1',
		});
	});
});
