/* oxlint-disable max-classes-per-file -- the plan's interface defines the three setup errors in this module */
import type { Locale } from '@/i18n/locale';
import { writeAudit } from '@/server/audit/audit';
import { normalizeEmail } from '@/server/auth/email';
import type { Db } from '@/server/db/client';
import { areaMemberships, areas, systemState } from '@/server/db/schema';
import { getState, setState } from '@/server/system-state';
import type { StateKey } from '@/server/system-state';
import { findUserById, insertUser } from '@/server/users/repo';

/** Set once, by the setup itself; its presence means the setup is done. Holds `SetupMarker`. */
const SETUP_DONE_KEY: StateKey = 'setup_completed_at';
/** Set once the setup admin's first session exists; from then on the setup opens no session. */
const SESSION_OPENED_KEY: StateKey = 'setup_session_opened_at';

/** The areas every club starts with (Spec 6.7). The first admin may edit "Mitglieder". */
const MEMBERS_AREA = 'Mitglieder';
const FINANCE_AREA = 'Finanzen';

/** PostgreSQL's SQLSTATE for a unique violation. */
const UNIQUE_VIOLATION = '23505';
/** How deep to follow `cause`: Drizzle wraps the error of the driver once. */
const MAX_CAUSE_DEPTH = 5;

const encoder = new TextEncoder();

/** The value under `setup_completed_at`. */
interface SetupMarker {
	/** When the setup was completed (ISO 8601). */
	at: string;
	/** The admin the setup created. */
	adminUserId: string;
}

interface SetupInput {
	/** The token from the form. */
	token: string;
	/** `SETUP_TOKEN`, or null when it is not set. */
	expectedToken: string | null;
	/** The admin's address as typed; it is stored normalized. */
	adminEmail: string;
	/** The admin's name; it is stored trimmed. */
	adminName: string;
	/** The admin's language for system mails; defaults to German. */
	adminLocale?: Locale;
}

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
 * the primary key of `system_state` instead of overwriting the first. The admin is added to the
 * marker once it exists, in the same transaction.
 *
 * @param db The database or the setup's transaction.
 * @param at When the setup is completed (ISO 8601).
 * @throws {SetupAlreadyDoneError} When the setup is already done.
 */
async function markSetupDone(db: Db, at: string): Promise<void> {
	try {
		await db.insert(systemState).values({ key: SETUP_DONE_KEY, value: { at } });
	} catch (error) {
		if (isUniqueViolation(error)) throw new SetupAlreadyDoneError();
		throw error;
	}
}

/**
 * The admin of a completed setup whose first session was never opened, if the address is that
 * admin's. Only a caller that has already checked the setup token may ask.
 *
 * @param db The database.
 * @param adminEmail The address from the form, in any spelling.
 * @returns The admin's id, or null when the session was opened or the address is another one.
 */
async function adminWithoutSession(db: Db, adminEmail: string): Promise<string | null> {
	const [opened, marker] = await Promise.all([
		getState(db, SESSION_OPENED_KEY),
		getState<Partial<SetupMarker>>(db, SETUP_DONE_KEY),
	]);
	if (opened !== null || marker?.adminUserId === undefined) return null;
	const admin = await findUserById(db, marker.adminUserId);
	if (admin === null || normalizeEmail(admin.email) !== normalizeEmail(adminEmail)) return null;
	return admin.id;
}

/**
 * Closes the way to a setup session for good. Idempotent, so a double submission is fine.
 *
 * @param db The database.
 */
async function markSessionOpened(db: Db): Promise<void> {
	await db
		.insert(systemState)
		.values({ key: SESSION_OPENED_KEY, value: { at: new Date().toISOString() } })
		.onConflictDoNothing();
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
 * Tells whether the setup admin's first session has been opened. Until then the setup page
 * keeps its form, so a failed opening can be retried (see `completeSetupAndSignIn`).
 *
 * @param db The database.
 * @returns True once the setup is done and its session was opened.
 */
async function hasSetupSession(db: Db): Promise<boolean> {
	return (await getState(db, SESSION_OPENED_KEY)) !== null;
}

/**
 * Completes the one-time setup: creates the first admin (active), the areas "Mitglieder" and
 * "Finanzen", gives the admin `edit` in "Mitglieder" (Spec 6.7, for the first import) and writes
 * the audit entry. Everything happens in one transaction that starts by marking the setup as
 * done, so of two concurrent attempts exactly one succeeds.
 *
 * @param db The database.
 * @param input The setup form and the configured token, see `SetupInput`.
 * @returns The id of the admin.
 * @throws {SetupDisabledError} When `SETUP_TOKEN` is not set.
 * @throws {SetupTokenInvalidError} When the token is wrong.
 * @throws {SetupAlreadyDoneError} When the setup is already done.
 */
async function completeSetup(
	db: Db,
	input: Readonly<SetupInput>,
): Promise<{ adminUserId: string }> {
	if (input.expectedToken === null) throw new SetupDisabledError();
	if (!(await tokensMatch(input.token, input.expectedToken))) throw new SetupTokenInvalidError();

	const at = new Date().toISOString();
	return db.transaction(async (tx) => {
		await markSetupDone(tx, at);
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
		const marker: SetupMarker = { adminUserId, at };
		await setState(tx, SETUP_DONE_KEY, marker);
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

/**
 * Completes the setup, or, when it is done but its session was never opened, finds its admin.
 *
 * @param db The database.
 * @param input The setup form and the configured token.
 * @returns The id of the admin who gets the session.
 * @throws {SetupAlreadyDoneError} When the setup is done and no session can be opened by it.
 */
async function setUpOrFindAdminWithoutSession(
	db: Db,
	input: Readonly<SetupInput>,
): Promise<string> {
	try {
		const { adminUserId } = await completeSetup(db, input);
		return adminUserId;
	} catch (error) {
		// Disabled and invalid-token errors come before this one: only the token holder gets here.
		if (!(error instanceof SetupAlreadyDoneError)) throw error;
		const pending = await adminWithoutSession(db, input.adminEmail);
		if (pending === null) throw error;
		return pending;
	}
}

/**
 * Completes the setup and opens the admin's first session, the only way into a new instance
 * when no mail transport and no Microsoft login are set up.
 *
 * Opening the session happens after the setup's transaction. If it fails, the setup stays done,
 * but the way to the session stays open: a later submission with the right token and the
 * admin's address opens it then, instead of failing with `SetupAlreadyDoneError`. Once a
 * session was opened, that way is closed for good. The token is checked before, so only its
 * holder gets that far.
 *
 * @param db The database.
 * @param input The setup form and the configured token, see `SetupInput`.
 * @param openSession Opens a session for the admin and puts its cookie on the response; it
 *   throws when that fails.
 * @returns The id of the admin.
 * @throws {SetupDisabledError} When `SETUP_TOKEN` is not set.
 * @throws {SetupTokenInvalidError} When the token is wrong.
 * @throws {SetupAlreadyDoneError} When the setup is done and no session can be opened by it.
 */
async function completeSetupAndSignIn(
	db: Db,
	input: Readonly<SetupInput>,
	openSession: (adminUserId: string) => Promise<void>,
): Promise<{ adminUserId: string }> {
	const adminUserId = await setUpOrFindAdminWithoutSession(db, input);
	await openSession(adminUserId);
	await markSessionOpened(db);
	return { adminUserId };
}

export {
	SetupAlreadyDoneError,
	SetupDisabledError,
	SetupTokenInvalidError,
	completeSetup,
	completeSetupAndSignIn,
	hasSetupSession,
	isSetupDone,
};
export type { SetupInput };
