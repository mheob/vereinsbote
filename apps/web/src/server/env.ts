import { z } from 'zod';

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
	'HEARTBEAT_URL',
	'TICK_INTERVAL_MS',
] as const;

const MS_LOGIN_VARIABLES = [
	'MS_LOGIN_CLIENT_ID',
	'MS_LOGIN_CLIENT_SECRET',
	'MS_LOGIN_TENANT_ID',
] as const;

const parseUrl = (value: string): URL | null => {
	try {
		return new URL(value);
	} catch {
		return null;
	}
};

// Decodes and validates once; the schema output is the 32-byte key itself.
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- zod passes a mutable refinement context
const toSecretBytes = (value: string, ctx: z.RefinementCtx): Uint8Array => {
	if (z.base64().safeParse(value).success) {
		const bytes = Uint8Array.from(atob(value), (char) => char.codePointAt(0) ?? 0);
		if (bytes.length === SECRET_BYTES) return bytes;
	}
	ctx.addIssue({ code: 'custom', message: 'invalid' });
	return z.NEVER;
};

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- zod passes a mutable refinement context
const toAppUrl = (value: string, ctx: z.RefinementCtx): URL => {
	const url = parseUrl(value);
	if (
		url &&
		(url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)))
	) {
		return url;
	}
	ctx.addIssue({ code: 'custom', message: 'invalid' });
	return z.NEVER;
};

const isHttpsUrl = (value: string): boolean => parseUrl(value)?.protocol === 'https:';

const isValidTickInterval = (value: string): boolean =>
	Number.isSafeInteger(Number(value)) && Number(value) >= MIN_TICK_INTERVAL_MS;

// Empty strings count as unset, as `.env` files commonly contain `KEY=`.
const withoutEmptyValues = (
	source: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(source)) {
		if (value !== undefined && value !== '') result[name] = value;
	}
	return result;
};

// Every variable has its own rule; the cross-variable MS_LOGIN_* rule lives in `missingMsLogin`.
const schema = z.object({
	APP_SECRET: z.string().transform(toSecretBytes),
	APP_URL: z.string().transform(toAppUrl),
	CRON_SECRET: z.string().min(MIN_CRON_SECRET_LENGTH),
	DATABASE_URL: z.string().regex(/^postgres(?:ql)?:\/\//u),
	DEV_SMTP_URL: z.string().startsWith('smtp://').optional(),
	HEARTBEAT_URL: z.string().refine(isHttpsUrl).optional(),
	MS_LOGIN_CLIENT_ID: z.string().optional(),
	MS_LOGIN_CLIENT_SECRET: z.string().optional(),
	MS_LOGIN_TENANT_ID: z.string().optional(),
	SETUP_TOKEN: z.string().min(MIN_SETUP_TOKEN_LENGTH).optional(),
	TICK_INTERVAL_MS: z.string().regex(/^\d+$/u).refine(isValidTickInterval).optional(),
});

// MS_LOGIN_*: all three or none. Returns the variables that are missing when only some are set.
const missingMsLogin = (
	source: Readonly<Record<string, string | undefined>>,
): readonly string[] => {
	const missing = MS_LOGIN_VARIABLES.filter((name) => source[name] === undefined);
	return missing.length === MS_LOGIN_VARIABLES.length ? [] : missing;
};

export interface Env {
	appSecret: Uint8Array; // exactly 32 bytes
	appUrl: URL;
	cronSecret: string;
	databaseUrl: string;
	devSmtpUrl: string | null;
	heartbeatUrl: string | null;
	microsoftLogin: { clientId: string; clientSecret: string; tenantId: string } | null;
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
	const values = withoutEmptyValues(source);
	const result = schema.safeParse(values);
	const offending = new Set<string>(missingMsLogin(values));
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
		cronSecret: data.CRON_SECRET,
		databaseUrl: data.DATABASE_URL,
		devSmtpUrl: data.DEV_SMTP_URL ?? null,
		heartbeatUrl: data.HEARTBEAT_URL ?? null,
		microsoftLogin:
			clientId !== undefined && clientSecret !== undefined && tenantId !== undefined
				? { clientId, clientSecret, tenantId }
				: null,
		setupToken: data.SETUP_TOKEN ?? null,
		tickIntervalMs:
			data.TICK_INTERVAL_MS === undefined
				? DEFAULT_TICK_INTERVAL_MS
				: Number(data.TICK_INTERVAL_MS),
	};
}
