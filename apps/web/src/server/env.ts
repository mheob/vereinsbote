import { z } from 'zod';

import { platformName } from '@/platform/platform';
import type { PlatformName } from '@/platform/platform';

import type { S3Config } from './storage/s3';

const SECRET_BYTES = 32;
const MIN_CRON_SECRET_LENGTH = 32;
const MIN_SETUP_TOKEN_LENGTH = 24;
const MIN_TICK_INTERVAL_MS = 60_000;
const DEFAULT_TICK_INTERVAL_MS = 900_000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

// All variable names, in the order of the rules table. EnvError.variables follows this order.
const VARIABLE_ORDER = [
	'DATABASE_URL',
	'APP_URL',
	'APP_SECRET',
	'CRON_SECRET',
	'SETUP_TOKEN',
	'MS_LOGIN_CLIENT_ID',
	'MS_LOGIN_CLIENT_SECRET',
	'MS_LOGIN_TENANT_ID',
	'DEV_SMTP_URL',
	'DEV_NEON_WS_PROXY',
	'DEV_PROVIDERS_URL',
	'HEARTBEAT_URL',
	'TICK_INTERVAL_MS',
	'S3_ENDPOINT',
	'S3_REGION',
	'S3_BUCKET',
	'S3_ACCESS_KEY_ID',
	'S3_SECRET_ACCESS_KEY',
	'BLOB_READ_WRITE_TOKEN',
] as const;

const MS_LOGIN_VARIABLES = [
	'MS_LOGIN_CLIENT_ID',
	'MS_LOGIN_CLIENT_SECRET',
	'MS_LOGIN_TENANT_ID',
] as const;

const S3_VARIABLES = [
	'S3_ENDPOINT',
	'S3_REGION',
	'S3_BUCKET',
	'S3_ACCESS_KEY_ID',
	'S3_SECRET_ACCESS_KEY',
] as const;

const parseUrl = (value: string): URL | null => {
	try {
		return new URL(value);
	} catch {
		return null;
	}
};

// Decodes and validates once; the schema output is the 32-byte key itself.
const toSecretBytes = (value: string, ctx: z.RefinementCtx): Uint8Array => {
	if (z.base64().safeParse(value).success) {
		const bytes = Uint8Array.from(atob(value), (char) => char.codePointAt(0) ?? 0);
		if (bytes.length === SECRET_BYTES) return bytes;
	}
	ctx.addIssue({ code: 'custom', message: 'invalid' });
	return z.NEVER;
};

// The origin only: links are built from it, so a path, query, fragment or credentials would end
// up in every link of the app.
const isOriginOnly = (url: URL): boolean => url.href === `${url.origin}/`;

const isAllowedScheme = (url: URL): boolean =>
	url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));

const toAppUrl = (value: string, ctx: z.RefinementCtx): URL => {
	const url = parseUrl(value);
	if (url !== null && isOriginOnly(url) && isAllowedScheme(url)) return url;
	ctx.addIssue({ code: 'custom', message: 'invalid' });
	return z.NEVER;
};

const toDevProvidersUrl = (value: string, ctx: z.RefinementCtx): URL => {
	const url = parseUrl(value);
	if (
		url !== null &&
		isOriginOnly(url) &&
		url.protocol === 'http:' &&
		LOCAL_HOSTS.has(url.hostname)
	)
		return url;
	ctx.addIssue({ code: 'custom', message: 'invalid' });
	return z.NEVER;
};

const isHttpsUrl = (value: string): boolean => parseUrl(value)?.protocol === 'https:';

// S3 traffic carries the credentials' signatures and the images: https, or http to this machine.
const isS3Endpoint = (value: string): boolean => {
	const url = parseUrl(value);
	return url !== null && isAllowedScheme(url);
};

const isValidTickInterval = (value: string): boolean =>
	Number.isSafeInteger(Number(value)) && Number(value) >= MIN_TICK_INTERVAL_MS;

// Values are trimmed, since a copied secret often brings a space or line break along. Empty
// values count as unset, as `.env` files commonly contain `KEY=`.
const trimmedValues = (
	source: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(source)) {
		const trimmed = value?.trim();
		if (trimmed !== undefined && trimmed !== '') result[name] = trimmed;
	}
	return result;
};

// Every variable has its own rule; the all-or-none rules of MS_LOGIN_* and S3_* live in `missingFromGroup`.
const schema = z.object({
	APP_SECRET: z.string().transform(toSecretBytes),
	APP_URL: z.string().transform(toAppUrl),
	// The Vercel Blob store's read-write token; the Vercel build reads it.
	BLOB_READ_WRITE_TOKEN: z.string().optional(),
	CRON_SECRET: z.string().min(MIN_CRON_SECRET_LENGTH),
	DATABASE_URL: z.string().regex(/^postgres(?:ql)?:\/\//u),
	// A local Neon WebSocket proxy as host[:port][/path], without scheme or query.
	DEV_NEON_WS_PROXY: z
		.string()
		.regex(/^[\w.-]+(?::\d+)?(?:\/[\w./-]*)?$/u)
		.optional(),
	// The local fake server of the mail providers (e2e, development): `http://localhost:<port>`.
	DEV_PROVIDERS_URL: z.string().transform(toDevProvidersUrl).optional(),
	DEV_SMTP_URL: z.string().startsWith('smtp://').optional(),
	HEARTBEAT_URL: z.string().refine(isHttpsUrl).optional(),
	MS_LOGIN_CLIENT_ID: z.string().optional(),
	MS_LOGIN_CLIENT_SECRET: z.string().optional(),
	// The tenant ID (a GUID) of the club's Microsoft Entra tenant. The aliases `common`,
	// `organizations` and `consumers` would let any Microsoft account sign in, so they are refused.
	MS_LOGIN_TENANT_ID: z.guid().optional(),
	// S3 storage for images (Node/Docker): all five or none, see `missingS3`.
	S3_ACCESS_KEY_ID: z.string().optional(),
	S3_BUCKET: z
		.string()
		.regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u)
		.optional(),
	S3_ENDPOINT: z.string().refine(isS3Endpoint).optional(),
	S3_REGION: z.string().optional(),
	S3_SECRET_ACCESS_KEY: z.string().optional(),
	SETUP_TOKEN: z.string().min(MIN_SETUP_TOKEN_LENGTH).optional(),
	TICK_INTERVAL_MS: z.string().regex(/^\d+$/u).refine(isValidTickInterval).optional(),
});

// A group of variables is all or nothing. Returns the variables that are missing when only some
// are set.
const missingFromGroup = (
	source: Readonly<Record<string, string | undefined>>,
	group: readonly string[],
): readonly string[] => {
	const missing = group.filter((name) => source[name] === undefined);
	return missing.length === group.length ? [] : missing;
};

/**
 * DEV_NEON_WS_PROXY: development only, so it needs a local `http://` APP_URL. The database traffic
 * then goes unencrypted to the proxy, which a deployment must never do.
 *
 * @param source The trimmed values.
 * @returns The variable when it is set without a local APP_URL.
 */
const misplacedNeonProxy = (
	source: Readonly<Record<string, string | undefined>>,
): readonly string[] => {
	if (source.DEV_NEON_WS_PROXY === undefined) return [];
	const appUrl = parseUrl(source.APP_URL ?? '');
	const local = appUrl?.protocol === 'http:' && LOCAL_HOSTS.has(appUrl.hostname);
	return local ? [] : ['DEV_NEON_WS_PROXY'];
};

/**
 * DEV_PROVIDERS_URL: development only. Provider credentials and mails would go unencrypted to
 * that address, so it needs a local `http://` APP_URL and is refused on Cloudflare and Vercel.
 *
 * @param source The trimmed values.
 * @param platform The build's platform.
 * @returns The variable when it is set outside local development.
 */
const misplacedProvidersUrl = (
	source: Readonly<Record<string, string | undefined>>,
	platform: PlatformName = platformName(),
): readonly string[] => {
	if (source.DEV_PROVIDERS_URL === undefined) return [];
	const appUrl = parseUrl(source.APP_URL ?? '');
	const local = appUrl?.protocol === 'http:' && LOCAL_HOSTS.has(appUrl.hostname);
	return local && platform === 'node' ? [] : ['DEV_PROVIDERS_URL'];
};

const toS3Config = (data: z.output<typeof schema>): S3Config | null => {
	const { S3_ACCESS_KEY_ID: accessKeyId, S3_BUCKET: bucket, S3_ENDPOINT: endpoint } = data;
	const { S3_REGION: region, S3_SECRET_ACCESS_KEY: secretAccessKey } = data;
	if (
		accessKeyId === undefined ||
		bucket === undefined ||
		endpoint === undefined ||
		region === undefined ||
		secretAccessKey === undefined
	)
		return null;
	return { accessKeyId, bucket, endpoint: new URL(endpoint), region, secretAccessKey };
};

export interface Env {
	appSecret: Uint8Array; // exactly 32 bytes
	appUrl: URL;
	/** The Vercel Blob store's token, for the Vercel build. */
	blobToken: string | null;
	cronSecret: string;
	databaseUrl: string;
	/** A local Neon WebSocket proxy (`host:port/path`) for the `neon` driver, development only. */
	devNeonWsProxy: string | null;
	/** The local fake server of the mail providers, development and e2e only. */
	devProvidersUrl: URL | null;
	devSmtpUrl: string | null;
	heartbeatUrl: string | null;
	microsoftLogin: { clientId: string; clientSecret: string; tenantId: string } | null;
	/** The S3 bucket for images (Node/Docker), or null when `S3_*` is not set. */
	s3: S3Config | null;
	setupToken: string | null;
	tickIntervalMs: number;
}

// Carries the offending variable names only. Neither message nor fields ever contain a value.
export class EnvError extends Error {
	public readonly variables: string[];

	public constructor(variables: readonly string[]) {
		super(`Invalid environment configuration: ${variables.join(', ')}`);
		this.name = 'EnvError';
		this.variables = [...variables];
	}
}

export function parseEnv(source: Readonly<Record<string, string | undefined>>): Env {
	const values = trimmedValues(source);
	const result = schema.safeParse(values);
	const offending = new Set<string>([
		...missingFromGroup(values, MS_LOGIN_VARIABLES),
		...missingFromGroup(values, S3_VARIABLES),
		...misplacedNeonProxy(values),
		...misplacedProvidersUrl(values),
	]);
	if (!result.success) {
		for (const name of Object.keys(z.flattenError(result.error).fieldErrors)) offending.add(name);
	}
	if (!result.success || offending.size > 0)
		throw new EnvError(VARIABLE_ORDER.filter((name) => offending.has(name)));

	const { data } = result;
	const { MS_LOGIN_CLIENT_ID: clientId, MS_LOGIN_CLIENT_SECRET: clientSecret } = data;
	const { MS_LOGIN_TENANT_ID: tenantId } = data;
	return {
		appSecret: data.APP_SECRET,
		appUrl: data.APP_URL,
		blobToken: data.BLOB_READ_WRITE_TOKEN ?? null,
		cronSecret: data.CRON_SECRET,
		databaseUrl: data.DATABASE_URL,
		devNeonWsProxy: data.DEV_NEON_WS_PROXY ?? null,
		devProvidersUrl: data.DEV_PROVIDERS_URL ?? null,
		devSmtpUrl: data.DEV_SMTP_URL ?? null,
		heartbeatUrl: data.HEARTBEAT_URL ?? null,
		microsoftLogin:
			clientId !== undefined && clientSecret !== undefined && tenantId !== undefined
				? { clientId, clientSecret, tenantId }
				: null,
		s3: toS3Config(data),
		setupToken: data.SETUP_TOKEN ?? null,
		tickIntervalMs:
			data.TICK_INTERVAL_MS === undefined
				? DEFAULT_TICK_INTERVAL_MS
				: Number(data.TICK_INTERVAL_MS),
	};
}

export { misplacedProvidersUrl };
