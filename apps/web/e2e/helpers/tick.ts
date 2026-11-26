const HTTP_OK = 200;

/**
 * Runs one tick of the app, as the cron job would: the server's own interval is 15 minutes, so
 * nothing ticks on its own during the tests. The request runs the tick and answers with its
 * report, so the work is done when this returns.
 *
 * @param app Where the app is and the secret of its cron endpoint (`env.ts`).
 * @param app.url The app's address.
 * @param app.cronSecret The `CRON_SECRET` of the app.
 * @throws {Error} When the app does not answer 200.
 */
async function runTick(app: Readonly<{ url: string; cronSecret: string }>): Promise<void> {
	const response = await fetch(`${app.url}/api/tick`, {
		headers: { authorization: `Bearer ${app.cronSecret}` },
		method: 'POST',
	});
	await response.body?.cancel();
	if (response.status !== HTTP_OK) throw new Error(`The tick answered ${response.status}.`);
}

export { runTick };
