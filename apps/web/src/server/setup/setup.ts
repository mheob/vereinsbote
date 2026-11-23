/* oxlint-disable max-classes-per-file -- the plan's interface defines the three setup errors in this module */
import type { Locale } from '@/i18n/locale';
import { writeAudit } from '@/server/audit/audit';
import type { Db } from '@/server/db/client';
import { areaMemberships, areas, systemState } from '@/server/db/schema';
import { getState } from '@/server/system-state';
import type { StateKey } from '@/server/system-state';
import { insertUser } from '@/server/users/repo';

/** Set once, by the setup itself; its presence means the setup is done. */
const SETUP_DONE_KEY: StateKey = 'setup_completed_at';

/** The areas every club starts with (Spec 6.7). The first admin may edit "Mitglieder". */
const MEMBERS_AREA = 'Mitglieder';
const FINANCE_AREA = 'Finanzen';

/** PostgreSQL's SQLSTATE for a unique violation. */
const UNIQUE_VIOLATION = '23505';
/** How deep to follow `cause`: Drizzle wraps the error of the driver once. */
const MAX_CAUSE_DEPTH = 5;

const encoder = new TextEncoder();

/** `SETUP_TOKEN` is not set, so the setup is off. */
class SetupDisabledError extends Error {
	public constructor() {
		super('The setup is not enabled, SETUP_TOKEN is not set.');
		this.name = 'SetupDisabledError';
	}
}

/** The given setup token is not `SETUP_TOKEN`. The message names neither token. */
class SetupTokenInvalidError extends Error {
	public constructor() {
		super('The setup token is not correct.');
		this.name = 'SetupTokenInvalidError';
	}
}

/** The setup has already been completed. */
class SetupAlreadyDoneError extends Error {
	public constructor() {
		super('The setup is already done.');
		this.name = 'SetupAlreadyDoneError';
	}
}

async function sha256(value: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

/**
 * Compares two tokens in constant time. Both are hashed first, so the comparison always runs
 * over 32 bytes and visits every byte: neither the length of a token nor a shared prefix shows
 * in the time it takes.
 *
 * @param given The token from the form.
 * @param expected The configured token.
 * @returns True when the tokens are equal.
 */
async function tokensMatch(given: string, expected: string): Promise<boolean> {
	const [givenHash, expectedHash] = await Promise.all([sha256(given), sha256(expected)]);
	let difference = 0;
	for (const [index, byte] of givenHash.entries()) {
		// oxlint-disable-next-line no-bitwise -- XOR and OR keep the comparison free of early exits
		difference |= byte ^ (expectedHash[index] ?? 0);
	}
	return difference === 0;
}

/**
 * Tells whether a database error is a unique violation. Drizzle wraps the error of the driver
 * (pg, Neon, PGlite) in `cause`, and each of them carries the SQLSTATE in `code`.
 *
 * @param error The error of a query.
 * @returns True for a unique violation.
 */
function isUniqueViolation(error: unknown): boolean {
	let current = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
		if (typeof current !== 'object' || current === null) return false;
		if ('code' in current && current.code === UNIQUE_VIOLATION) return true;
		current = 'cause' in current ? current.cause : undefined;
	}
	return false;
}

/**
 * Marks the setup as done, with a plain insert: a second setup, even a concurrent one, fails on
 * the primary key of `system_state` instead of overwriting the first.
 *
 * @param db The database or the setup's transaction.
 * @throws {SetupAlreadyDoneError} When the setup is already done.
 */
async function markSetupDone(db: Db): Promise<void> {
	try {
		await db.insert(systemState).values({ key: SETUP_DONE_KEY, value: new Date().toISOString() });
	} catch (error) {
		if (isUniqueViolation(error)) throw new SetupAlreadyDoneError();
		throw error;
	}
}

/**
 * Tells whether the setup has been completed.
 *
 * @param db The database.
 * @returns True once the first admin exists.
 */
async function isSetupDone(db: Db): Promise<boolean> {
	return (await getState(db, SETUP_DONE_KEY)) !== null;
}

/**
 * Completes the one-time setup: creates the first admin (active), the areas "Mitglieder" and
 * "Finanzen", gives the admin `edit` in "Mitglieder" (Spec 6.7, for the first import) and writes
 * the audit entry. Everything happens in one transaction that starts by marking the setup as
 * done, so of two concurrent attempts exactly one succeeds.
 *
 * @param db The database.
 * @param input The setup form and the configured token.
 * @param input.token The token from the form.
 * @param input.expectedToken `SETUP_TOKEN`, or null when it is not set.
 * @param input.adminEmail The admin's address as typed; it is stored normalized.
 * @param input.adminName The admin's name; it is stored trimmed.
 * @param input.adminLocale The admin's language for system mails; defaults to German.
 * @returns The id of the admin.
 * @throws {SetupDisabledError} When `SETUP_TOKEN` is not set.
 * @throws {SetupTokenInvalidError} When the token is wrong.
 * @throws {SetupAlreadyDoneError} When the setup is already done.
 */
async function completeSetup(
	db: Db,
	input: Readonly<{
		token: string;
		expectedToken: string | null;
		adminEmail: string;
		adminName: string;
		adminLocale?: Locale;
	}>,
): Promise<{ adminUserId: string }> {
	if (input.expectedToken === null) throw new SetupDisabledError();
	if (!(await tokensMatch(input.token, input.expectedToken))) throw new SetupTokenInvalidError();

	return db.transaction(async (tx) => {
		await markSetupDone(tx);
		const { id: adminUserId } = await insertUser(tx, {
			email: input.adminEmail,
			isAdmin: true,
			name: input.adminName.trim(),
			status: 'active',
			...(input.adminLocale === undefined ? {} : { locale: input.adminLocale }),
		});
		const created = await tx
			.insert(areas)
			.values([{ name: MEMBERS_AREA }, { name: FINANCE_AREA }])
			.returning({ id: areas.id, name: areas.name });
		const members = created.find((area) => area.name === MEMBERS_AREA);
		if (members === undefined) throw new Error('Inserting the default areas returned no row.');
		await tx
			.insert(areaMemberships)
			.values({ areaId: members.id, level: 'edit', userId: adminUserId });
		await writeAudit(tx, {
			action: 'setup.completed',
			actorUserId: adminUserId,
			target: `user:${adminUserId}`,
		});
		return { adminUserId };
	});
}

export {
	SetupAlreadyDoneError,
	SetupDisabledError,
	SetupTokenInvalidError,
	completeSetup,
	isSetupDone,
};
