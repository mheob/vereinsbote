import { createFileRoute } from '@tanstack/react-router';

import { getAppContext, getAppServices } from '@/platform/context';
import { handleTickRequest } from '@/server/tick/http';
import { tickSteps } from '@/server/tick/steps';
import { runTick } from '@/server/tick/tick';

/**
 * Runs a tick for Vercel Cron (GET) and for the self-chaining (POST). The database is opened
 * only after the cron secret was checked, so unauthorized requests stay cheap on Cloudflare.
 * Every method lands here (`ANY`), so other methods get 401 or 405 instead of a rendered page.
 *
 * @param context The route handler context.
 * @param context.request The incoming request.
 * @returns The response of `handleTickRequest`.
 */
async function handleTick({ request }: Readonly<{ request: Request }>): Promise<Response> {
	const { env, platform } = await getAppServices();
	return handleTickRequest(request, {
		env,
		platform,
		async run() {
			const { db } = await getAppContext();
			return runTick({ db, env, steps: tickSteps });
		},
	});
}

export const Route = createFileRoute('/api/tick')({
	server: { handlers: { ANY: handleTick } },
});
