import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import type { AppContext } from '@/platform/context';
import type { Principal } from '@/server/permissions/principal';
import type { ConnectionDetail, QueueCounts } from '@/server/sending/connections';
import type { SendingFailure } from '@/server/sending/failures';
import type { SelfTestResult } from '@/server/sending/open-transport';
import type { QuotaState } from '@/server/sending/quota';
import type { SenderFormOptions, SenderSummary } from '@/server/sending/senders';

/*
 * The server functions of the connections and senders. Server modules are imported inside the
 * handlers, so they stay out of the client bundle. Each handler checks the session itself, the
 * domain functions check the admin role: server functions are reachable without their page.
 * Secrets arrive in the body of a POST and never go back: a page only learns whether one is
 * stored. The refusals of the domain come back as results.
 */

/** A connection of the overview with the days its secret has left. */
interface OverviewConnection extends Omit<
	ConnectionDetail,
	'clientId' | 'hasWebhookSecret' | 'tenantId'
> {
	/** Whole days until the secret expires (negative: expired), or null without a date. */
	readonly secretDaysLeft: number | null;
}

/** A sender of the overview with the names of its connection and areas. */
interface OverviewSender {
	readonly id: string;
	readonly email: string;
	readonly displayName: string;
	readonly connectionName: string;
	readonly areaNames: readonly string[];
	readonly isSystem: boolean;
	/** The waiting, uncertain and failed entries of the sender; no recipient. */
	readonly queue: Readonly<QueueCounts>;
	/** Today's count against the limit of its scope. */
	readonly quota: Readonly<QuotaState>;
}

interface SendingOverview {
	readonly connections: readonly OverviewConnection[];
	readonly senders: readonly OverviewSender[];
	readonly hasSystemSender: boolean;
}

interface SenderPage extends SenderFormOptions {
	/** The sender to change, or null for the form of a new one. */
	readonly sender: Readonly<SenderSummary> | null;
}

/** What checking the credentials after a save found; null when the check itself failed. */
type ConnectionCheck = SelfTestResult['token'] | null;

type OkResult = Readonly<{ ok: true }> | SendingFailure;
type ConnectionCreatedResult =
	| Readonly<{ ok: true; id: string; check: ConnectionCheck }>
	| SendingFailure;
type ConnectionSavedResult =
	| Readonly<{ ok: true; version: number; check: ConnectionCheck }>
	| SendingFailure;
type SenderCreatedResult =
	| Readonly<{ ok: true; id: string; selfTest: SelfTestResult | null }>
	| SendingFailure;
type SenderSavedResult =
	| Readonly<{ ok: true; version: number; selfTest: SelfTestResult | null }>
	| SendingFailure;
type SelfTestOutcome = Readonly<{ ok: true; result: SelfTestResult }> | SendingFailure;

/** The longest id the server looks at; ids are 36 characters. */
const MAX_ID_LENGTH = 100;
const MAX_TEXT = 10_000;
const text = z.string().max(MAX_TEXT);
const optionalText = text.nullable();
const optionalNumber = z.number().nullable();

const connectionInput = z.discriminatedUnion('kind', [
	z.object({
		clientId: text,
		clientSecret: optionalText,
		kind: z.literal('graph'),
		name: text,
		secretExpiresOn: text,
		tenantId: text,
	}),
	z.object({
		apiKey: optionalText,
		dailyLimit: optionalNumber,
		kind: z.literal('resend'),
		name: text,
		perMinute: z.number(),
		webhookSecret: optionalText,
	}),
]);
const senderInput = z.object({
	archiveBcc: optionalText,
	areaIds: z.array(z.uuid()).max(MAX_ID_LENGTH),
	connectionId: z.uuid(),
	dailyLimit: optionalNumber,
	displayName: text,
	email: text,
	perMinute: optionalNumber,
	replyTo: optionalText,
});
const idRequest = z.object({ id: z.uuid() });
const pageRequest = z.object({ id: z.string().max(MAX_ID_LENGTH) });
const createConnectionRequest = z.object({ input: connectionInput });
const updateConnectionRequest = z.object({
	id: z.uuid(),
	input: connectionInput,
	version: z.number().int().min(1),
});
const createSenderRequest = z.object({ input: senderInput });
const updateSenderRequest = z.object({
	id: z.uuid(),
	input: senderInput,
	version: z.number().int().min(1),
});
/** `system`: make the sender the system sender (true) or take the mark from it (false). */
const systemSenderRequest = z.object({ senderId: z.uuid(), system: z.boolean() });
const selfTestRequest = z.object({ probeMailbox: optionalText, senderId: z.uuid() });

/**
 * Runs a check that follows a save. A failing check (a secret that does not decrypt, a network
 * error) never undoes the save: it is logged by its code and the page shows no result.
 *
 * @param check The check.
 * @returns The result, or null when the check itself failed.
 */
async function afterSave<T>(check: () => Promise<T>): Promise<T | null> {
	try {
		return await check();
	} catch (error) {
		const { errorLabel } = await import('@/server/error-label');
		console.error('check after save failed', errorLabel(error));
		return null;
	}
}

/**
 * Checks the credentials of a connection after they were saved.
 *
 * @param app The app context.
 * @param principal The admin.
 * @param id The connection.
 * @returns What the check found, or null when it could not run.
 */
async function checkConnection(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the app context holds the database and the auth instance
	app: AppContext,
	principal: Principal,
	id: string,
): Promise<ConnectionCheck> {
	const { checkConnectionCredentials } = await import('@/server/sending/open-transport');
	return afterSave(async () =>
		checkConnectionCredentials(app.db, app.env, principal, id, {
			fetch: globalThis.fetch,
			now: () => new Date(),
		}),
	);
}

/**
 * Runs the self test of a sender after it was saved, with the admin's address as probe mailbox.
 *
 * @param app The app context.
 * @param principal The admin.
 * @param id The sender.
 * @returns The outcome, or null when the test could not run.
 */
async function testSender(
	// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the app context holds the database and the auth instance
	app: AppContext,
	principal: Principal,
	id: string,
): Promise<SelfTestResult | null> {
	const { runSelfTest } = await import('@/server/sending/open-transport');
	return afterSave(async () =>
		runSelfTest(app.db, app.env, principal, id, null, {
			fetch: globalThis.fetch,
			now: () => new Date(),
		}),
	);
}

/**
 * Tells whether a saved input changes what the provider sees of a connection: a typed secret, or
 * another tenant or client.
 *
 * @param input What was saved.
 * @param before The connection before the save.
 * @returns True when the credentials are new.
 */
function credentialsChanged(
	input: z.infer<typeof connectionInput>,
	before: Readonly<ConnectionDetail>,
): boolean {
	if (input.kind === 'resend') return input.apiKey !== null;
	return (
		input.clientSecret !== null ||
		input.tenantId.trim() !== before.tenantId ||
		input.clientId.trim() !== before.clientId
	);
}

/** The connections and senders for the overview; for admins only. */
const loadSendingOverview = createServerFn({ method: 'GET' }).handler(
	async (): Promise<SendingOverview> => {
		const [{ requireRequestPrincipal }, { sendingOverview }, { listAreas }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/sending/connections'),
			import('@/server/areas/areas'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		const [overview, areas] = await Promise.all([
			sendingOverview(context.db, principal, new Date()),
			listAreas(context.db, principal),
		]);
		const areaName = new Map(areas.map(({ id, name }) => [id, name]));
		const connectionName = new Map(overview.connections.map(({ id, name }) => [id, name]));
		return {
			connections: overview.connections.map(({ daysToExpiry, ...connection }) => ({
				...connection,
				secretDaysLeft: daysToExpiry,
			})),
			hasSystemSender: overview.senders.some(({ isSystem }) => isSystem),
			senders: overview.senders.map((sender) => ({
				areaNames: sender.areaIds.flatMap((id) => areaName.get(id) ?? []),
				connectionName: connectionName.get(sender.connectionId) ?? '',
				displayName: sender.displayName,
				email: sender.email,
				id: sender.id,
				isSystem: sender.isSystem,
				queue: { failed: sender.failed, open: sender.open, uncertain: sender.uncertain },
				quota: sender.quota,
			})),
		};
	},
);

/** One connection for its page, without secrets; a connection that does not exist is "not found". */
const loadConnectionPage = createServerFn({ method: 'GET' })
	.validator(pageRequest)
	.handler(async ({ data }): Promise<{ connection: ConnectionDetail }> => {
		const [{ requireRequestPrincipal }, { getConnection }, { ConnectionNotFoundError }] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/sending/connections'),
				import('@/server/sending/errors'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		// oxlint-disable-next-line typescript/only-throw-error -- the router shows its not-found page
		if (!z.uuid().safeParse(data.id).success) throw notFound();
		try {
			return { connection: await getConnection(context.db, principal, data.id) };
		} catch (error) {
			// oxlint-disable-next-line typescript/only-throw-error -- see above
			if (error instanceof ConnectionNotFoundError) throw notFound();
			throw error;
		}
	});

/** The form of a new sender (no id) or of an existing one; a sender that does not exist is "not found". */
const loadSenderPage = createServerFn({ method: 'GET' })
	.validator(z.object({ id: z.string().max(MAX_ID_LENGTH).nullable() }))
	.handler(async ({ data }): Promise<SenderPage> => {
		const [{ requireRequestPrincipal }, senders, { SenderNotFoundError }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/sending/senders'),
			import('@/server/sending/errors'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		const options = await senders.senderFormOptions(context.db, principal);
		if (data.id === null) return { ...options, sender: null };
		// oxlint-disable-next-line typescript/only-throw-error -- the router shows its not-found page
		if (!z.uuid().safeParse(data.id).success) throw notFound();
		try {
			return { ...options, sender: await senders.getSender(context.db, principal, data.id) };
		} catch (error) {
			// oxlint-disable-next-line typescript/only-throw-error -- see above
			if (error instanceof SenderNotFoundError) throw notFound();
			throw error;
		}
	});

/** Creates a connection; the secrets are encrypted before they are stored, then the credentials are checked. */
const submitCreateConnection = createServerFn({ method: 'POST' })
	.validator(createConnectionRequest)
	.handler(async ({ data }): Promise<ConnectionCreatedResult> => {
		const [{ requireRequestPrincipal }, connections, { sendingFailure }, { deriveSecretsKey }] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/sending/connections'),
				import('@/server/sending/failures'),
				import('@/server/crypto/secrets'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const key = await deriveSecretsKey(context.env.appSecret);
			const { id } = await connections.createConnection(context.db, principal, data.input, key);
			return { check: await checkConnection(context, principal, id), id, ok: true };
		} catch (error) {
			const failure = sendingFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/**
 * Changes a connection, with the version the page loaded; an empty secret stays as it is. New
 * credentials (a typed secret, another tenant or client) are checked after the save.
 */
const submitUpdateConnection = createServerFn({ method: 'POST' })
	.validator(updateConnectionRequest)
	.handler(async ({ data }): Promise<ConnectionSavedResult> => {
		const [{ requireRequestPrincipal }, connections, { sendingFailure }, { deriveSecretsKey }] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/sending/connections'),
				import('@/server/sending/failures'),
				import('@/server/crypto/secrets'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const before = await connections.getConnection(context.db, principal, data.id);
			const { version } = await connections.updateConnection(
				context.db,
				principal,
				data.id,
				data.input,
				data.version,
				await deriveSecretsKey(context.env.appSecret),
			);
			const check = credentialsChanged(data.input, before)
				? await checkConnection(context, principal, data.id)
				: null;
			return { check, ok: true, version };
		} catch (error) {
			const failure = sendingFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/** Deletes a connection no sender uses; one in use comes back with the number of senders. */
const submitDeleteConnection = createServerFn({ method: 'POST' })
	.validator(idRequest)
	.handler(async ({ data }): Promise<OkResult> => {
		const [{ requireRequestPrincipal }, connections, { sendingFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/sending/connections'),
			import('@/server/sending/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await connections.deleteConnection(context.db, principal, data.id);
			return { ok: true };
		} catch (error) {
			const failure = sendingFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/** Creates a sender and runs its self test (credentials, test mail to the admin, restriction). */
const submitCreateSender = createServerFn({ method: 'POST' })
	.validator(createSenderRequest)
	.handler(async ({ data }): Promise<SenderCreatedResult> => {
		const [{ requireRequestPrincipal }, senders, { sendingFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/sending/senders'),
			import('@/server/sending/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const { id } = await senders.createSender(context.db, principal, data.input);
			return { id, ok: true, selfTest: await testSender(context, principal, id) };
		} catch (error) {
			const failure = sendingFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/**
 * Changes a sender, with the version the page loaded. A new address or connection runs the self
 * test again.
 */
const submitUpdateSender = createServerFn({ method: 'POST' })
	.validator(updateSenderRequest)
	.handler(async ({ data }): Promise<SenderSavedResult> => {
		const [{ requireRequestPrincipal }, senders, { sendingFailure }, { normalizeEmail }] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/sending/senders'),
				import('@/server/sending/failures'),
				import('@/server/auth/email'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const before = await senders.getSender(context.db, principal, data.id);
			const { version } = await senders.updateSender(
				context.db,
				principal,
				data.id,
				data.input,
				data.version,
			);
			const selfTest =
				normalizeEmail(data.input.email) !== before.email ||
				data.input.connectionId !== before.connectionId
					? await testSender(context, principal, data.id)
					: null;
			return { ok: true, selfTest, version };
		} catch (error) {
			const failure = sendingFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/** Deletes a sender. */
const submitDeleteSender = createServerFn({ method: 'POST' })
	.validator(idRequest)
	.handler(async ({ data }): Promise<OkResult> => {
		const [{ requireRequestPrincipal }, senders, { sendingFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/sending/senders'),
			import('@/server/sending/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await senders.deleteSender(context.db, principal, data.id);
			return { ok: true };
		} catch (error) {
			const failure = sendingFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/**
 * Makes a sender the system sender, or takes the mark from it; the latter only while it still holds
 * the mark, so a page that is out of date gets `changed` instead of clearing another choice.
 */
const submitSystemSender = createServerFn({ method: 'POST' })
	.validator(systemSenderRequest)
	.handler(async ({ data }): Promise<OkResult> => {
		const [{ requireRequestPrincipal }, senders, { sendingFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/sending/senders'),
			import('@/server/sending/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await (data.system ? senders.setSystemSender : senders.clearSystemSender)(
				context.db,
				principal,
				data.senderId,
			);
			return { ok: true };
		} catch (error) {
			const failure = sendingFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/** Runs the self test of a sender: credentials, a test mail to the admin, the restriction test. */
const submitSelfTest = createServerFn({ method: 'POST' })
	.validator(selfTestRequest)
	.handler(async ({ data }): Promise<SelfTestOutcome> => {
		const [{ requireRequestPrincipal }, { runSelfTest }, { sendingFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/sending/open-transport'),
			import('@/server/sending/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const result = await runSelfTest(
				context.db,
				context.env,
				principal,
				data.senderId,
				data.probeMailbox,
				{ fetch: globalThis.fetch, now: () => new Date() },
			);
			return { ok: true, result };
		} catch (error) {
			const failure = sendingFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

export {
	loadConnectionPage,
	loadSenderPage,
	loadSendingOverview,
	submitCreateConnection,
	submitCreateSender,
	submitDeleteConnection,
	submitDeleteSender,
	submitSelfTest,
	submitSystemSender,
	submitUpdateConnection,
	submitUpdateSender,
};
export type {
	ConnectionCheck,
	ConnectionCreatedResult,
	ConnectionSavedResult,
	OkResult,
	OverviewConnection,
	OverviewSender,
	SenderCreatedResult,
	SenderSavedResult,
	SelfTestOutcome,
	SenderPage,
	SendingOverview,
};
