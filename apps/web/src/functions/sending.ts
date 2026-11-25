import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import type { ConnectionDetail, ConnectionSummary } from '@/server/sending/connections';
import type { SendingFailure } from '@/server/sending/failures';
import type { SelfTestResult } from '@/server/sending/open-transport';
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

type OkResult = Readonly<{ ok: true }> | SendingFailure;
type CreatedResult = Readonly<{ ok: true; id: string }> | SendingFailure;
type SavedResult = Readonly<{ ok: true; version: number }> | SendingFailure;
type SelfTestOutcome = Readonly<{ ok: true; result: SelfTestResult }> | SendingFailure;

/** The longest id the server looks at; ids are 36 characters. */
const MAX_ID_LENGTH = 100;
const MS_PER_DAY = 86_400_000;
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
const systemSenderRequest = z.object({ senderId: z.uuid().nullable() });
const selfTestRequest = z.object({ probeMailbox: optionalText, senderId: z.uuid() });

/**
 * A connection of the overview.
 *
 * @param connection The connection from the list.
 * @param today The start of today (UTC) in milliseconds.
 * @returns The connection with the days its secret has left.
 */
function overviewConnection(
	connection: Readonly<ConnectionSummary>,
	today: number,
): OverviewConnection {
	const { secretExpiresOn } = connection;
	return {
		dailyLimit: connection.dailyLimit,
		disturbedSince: connection.disturbedSince,
		id: connection.id,
		kind: connection.kind,
		name: connection.name,
		perMinute: connection.perMinute,
		restriction: connection.restriction,
		secretDaysLeft:
			secretExpiresOn === null
				? null
				: Math.round((Date.parse(secretExpiresOn) - today) / MS_PER_DAY),
		secretExpiresOn,
		senders: connection.senders,
		version: connection.version,
	};
}

/** The connections and senders for the overview; for admins only. */
const loadSendingOverview = createServerFn({ method: 'GET' }).handler(
	async (): Promise<SendingOverview> => {
		const [
			{ requireRequestPrincipal },
			{ listConnections },
			{ listSenders },
			{ listAreas },
			{ todayInClubZone },
		] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/sending/connections'),
			import('@/server/sending/senders'),
			import('@/server/areas/areas'),
			import('@/server/contacts/calendar'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		const [connections, senders, areas] = await Promise.all([
			listConnections(context.db, principal),
			listSenders(context.db, principal),
			listAreas(context.db, principal),
		]);
		const today = Date.parse(todayInClubZone(new Date()));
		const areaName = new Map(areas.map(({ id, name }) => [id, name]));
		const connectionName = new Map(connections.map(({ id, name }) => [id, name]));
		return {
			connections: connections.map((connection) => overviewConnection(connection, today)),
			hasSystemSender: senders.some(({ isSystem }) => isSystem),
			senders: senders.map((sender) => ({
				areaNames: sender.areaIds.flatMap((id) => areaName.get(id) ?? []),
				connectionName: connectionName.get(sender.connectionId) ?? '',
				displayName: sender.displayName,
				email: sender.email,
				id: sender.id,
				isSystem: sender.isSystem,
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

/** Creates a connection; the secrets are encrypted before they are stored. */
const submitCreateConnection = createServerFn({ method: 'POST' })
	.validator(createConnectionRequest)
	.handler(async ({ data }): Promise<CreatedResult> => {
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
			return { id, ok: true };
		} catch (error) {
			const failure = sendingFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/** Changes a connection, with the version the page loaded; an empty secret stays as it is. */
const submitUpdateConnection = createServerFn({ method: 'POST' })
	.validator(updateConnectionRequest)
	.handler(async ({ data }): Promise<SavedResult> => {
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
			const { version } = await connections.updateConnection(
				context.db,
				principal,
				data.id,
				data.input,
				data.version,
				key,
			);
			return { ok: true, version };
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

/** Creates a sender. */
const submitCreateSender = createServerFn({ method: 'POST' })
	.validator(createSenderRequest)
	.handler(async ({ data }): Promise<CreatedResult> => {
		const [{ requireRequestPrincipal }, senders, { sendingFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/sending/senders'),
			import('@/server/sending/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const { id } = await senders.createSender(context.db, principal, data.input);
			return { id, ok: true };
		} catch (error) {
			const failure = sendingFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/** Changes a sender, with the version the page loaded. */
const submitUpdateSender = createServerFn({ method: 'POST' })
	.validator(updateSenderRequest)
	.handler(async ({ data }): Promise<SavedResult> => {
		const [{ requireRequestPrincipal }, senders, { sendingFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/sending/senders'),
			import('@/server/sending/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const { version } = await senders.updateSender(
				context.db,
				principal,
				data.id,
				data.input,
				data.version,
			);
			return { ok: true, version };
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

/** Makes a sender the system sender, or clears the choice (no sender id). */
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
			await senders.setSystemSender(context.db, principal, data.senderId);
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
	CreatedResult,
	OkResult,
	OverviewConnection,
	OverviewSender,
	SavedResult,
	SelfTestOutcome,
	SenderPage,
	SendingOverview,
};
