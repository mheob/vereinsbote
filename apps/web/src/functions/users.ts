import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { ACCESS_LEVELS } from '@/i18n/levels';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/i18n/locale';
import { invalidInviteFields } from '@/server/users/form';
import type { InviteField } from '@/server/users/form';

/*
 * The server functions of the user management. Server modules are imported inside the handlers,
 * so they stay out of the client bundle. Each handler checks the session itself, the domain
 * functions check the admin role: server functions are reachable without their page.
 */

/** Why the server refused an invitation field: its rules, or the address is taken. */
type InviteFieldError = 'invalid' | 'taken';

type InviteFieldErrors = Readonly<Partial<Record<InviteField, InviteFieldError>>>;

type InviteResult = Readonly<
	{ ok: true; mailSent: boolean } | { ok: false; fields: InviteFieldErrors }
>;

/** The result of a change the last-admin rule can refuse. */
type AdminChangeResult = Readonly<{ ok: true } | { ok: false; failure: 'lastAdmin' }>;

const inviteRequest = z.object({
	email: z.string(),
	isAdmin: z.boolean(),
	locale: z.enum(SUPPORTED_LOCALES),
	name: z.string(),
});

const levelRequest = z.object({
	areaId: z.uuid(),
	level: z.enum(ACCESS_LEVELS).nullable(),
	userId: z.string(),
});

const adminRequest = z.object({ isAdmin: z.boolean(), userId: z.string() });

const disableRequest = z.object({ userId: z.string() });

/** The users with their levels, the areas as columns and the language the invitation proposes. */
const loadUsersPage = createServerFn({ method: 'GET' }).handler(async () => {
	const [{ requireRequestPrincipal }, { listUsersWithLevels }, { listAreas }, { findUserById }] =
		await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/users/users'),
			import('@/server/areas/areas'),
			import('@/server/users/repo'),
		]);
	const { context, principal } = await requireRequestPrincipal();
	const [users, areas, actor] = await Promise.all([
		listUsersWithLevels(context.db, principal),
		listAreas(context.db, principal),
		findUserById(context.db, principal.userId),
	]);
	return {
		areas: areas.map(({ id, name }) => ({ id, name })),
		// The invitation proposes the inviting admin's language.
		inviteLocale: actor?.locale ?? DEFAULT_LOCALE,
		users,
	};
});

/** Invites a user; a refused field comes back with its reason, a taken address as `taken`. */
const submitInvite = createServerFn({ method: 'POST' })
	.validator(inviteRequest)
	.handler(async ({ data }): Promise<InviteResult> => {
		const invalid = invalidInviteFields(data);
		if (invalid.length > 0) {
			return { fields: Object.fromEntries(invalid.map((field) => [field, 'invalid'])), ok: false };
		}
		const [{ requireRequestPrincipal }, users] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/users/users'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const { mailSent } = await users.inviteUser(
				{ appUrl: context.env.appUrl, db: context.db, mailer: context.mailer },
				principal,
				data,
			);
			return { mailSent, ok: true };
		} catch (error) {
			if (error instanceof users.UserExistsError) return { fields: { email: 'taken' }, ok: false };
			throw error;
		}
	});

/** Sets a user's level in an area; null removes the access. */
const submitLevel = createServerFn({ method: 'POST' })
	.validator(levelRequest)
	.handler(async ({ data }) => {
		const [{ requireRequestPrincipal }, { setAreaLevel }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/users/users'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		await setAreaLevel(context.db, principal, data);
	});

/** Gives or takes the admin role; the last admin keeps it. */
const submitAdmin = createServerFn({ method: 'POST' })
	.validator(adminRequest)
	.handler(async ({ data }): Promise<AdminChangeResult> => {
		const [{ requireRequestPrincipal }, users] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/users/users'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await users.setAdmin(context.db, principal, data.userId, data.isAdmin);
			return { ok: true };
		} catch (error) {
			if (error instanceof users.LastAdminError) return { failure: 'lastAdmin', ok: false };
			throw error;
		}
	});

/** Disables a user and ends the user's sessions; the last admin cannot be disabled. */
const submitDisable = createServerFn({ method: 'POST' })
	.validator(disableRequest)
	.handler(async ({ data }): Promise<AdminChangeResult> => {
		const [{ requireRequestPrincipal }, users] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/users/users'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await users.disableUser(context.db, principal, data.userId);
			return { ok: true };
		} catch (error) {
			if (error instanceof users.LastAdminError) return { failure: 'lastAdmin', ok: false };
			throw error;
		}
	});

export { loadUsersPage, submitAdmin, submitDisable, submitInvite, submitLevel };
export type { InviteFieldError, InviteFieldErrors };
