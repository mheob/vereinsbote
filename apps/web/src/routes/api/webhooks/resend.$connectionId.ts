import { createFileRoute } from '@tanstack/react-router';

/*
 * Resend's webhook of a connection (Design 13, 17): bounces and complaints, posted server to server
 * without cookies and without `Origin`. It is no server function, so the CSRF check does not apply;
 * `handleResendWebhook` checks the Svix signature with the connection's webhook secret instead.
 * Every method lands here (`ANY`), so other methods get 405 instead of a rendered page.
 */

/**
 * Answers a request to the webhook.
 *
 * @param context The route handler context.
 * @param context.request The incoming request.
 * @returns The empty response of `handleResendWebhook`.
 */
async function handleWebhook({ request }: Readonly<{ request: Request }>): Promise<Response> {
	const [{ handleResendWebhook, precheckResendWebhook }, { getAppContext }, { deriveSecretsKey }] =
		await Promise.all([
			import('@/server/bounces/resend-webhook-handler'),
			import('@/platform/context'),
			import('@/server/crypto/secrets'),
		]);
	// A stray request is refused before a database opens.
	const checked = await precheckResendWebhook(request);
	if (checked instanceof Response) return checked;
	const { db, env } = await getAppContext();
	return handleResendWebhook(request, {
		db,
		env,
		key: await deriveSecretsKey(env.appSecret),
		now: () => new Date(),
	});
}

export const Route = createFileRoute('/api/webhooks/resend/$connectionId')({
	server: { handlers: { ANY: handleWebhook } },
});
