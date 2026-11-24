import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

/*
 * The server functions of the area management. Server modules are imported inside the handlers,
 * so they stay out of the client bundle. Each handler checks the session itself, the domain
 * functions check the admin role: server functions are reachable without their page.
 */

/** Why the server refused an area name: its length, or another area has it. */
type AreaNameFailure = 'exists' | 'invalid';

type AreaNameResult = Readonly<{ ok: true } | { ok: false; failure: AreaNameFailure }>;

const createRequest = z.object({ name: z.string() });
const renameRequest = z.object({ areaId: z.uuid(), name: z.string() });

/** All areas, by name. */
const loadAreasPage = createServerFn({ method: 'GET' }).handler(async () => {
	const [{ requireRequestPrincipal }, { listAreas }] = await Promise.all([
		import('@/platform/request-principal'),
		import('@/server/areas/areas'),
	]);
	const { context, principal } = await requireRequestPrincipal();
	const areas = await listAreas(context.db, principal);
	return { areas: areas.map(({ id, name }) => ({ id, name })) };
});

/** Creates an area; a refused name comes back with its reason. */
const submitCreateArea = createServerFn({ method: 'POST' })
	.validator(createRequest)
	.handler(async ({ data }): Promise<AreaNameResult> => {
		const [{ requireRequestPrincipal }, areas] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/areas/areas'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await areas.createArea(context.db, principal, data.name);
			return { ok: true };
		} catch (error) {
			if (error instanceof areas.AreaExistsError) return { failure: 'exists', ok: false };
			if (error instanceof areas.AreaNameInvalidError) return { failure: 'invalid', ok: false };
			throw error;
		}
	});

/** Renames an area; a refused name comes back with its reason. */
const submitRenameArea = createServerFn({ method: 'POST' })
	.validator(renameRequest)
	.handler(async ({ data }): Promise<AreaNameResult> => {
		const [{ requireRequestPrincipal }, areas] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/areas/areas'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await areas.renameArea(context.db, principal, data.areaId, data.name);
			return { ok: true };
		} catch (error) {
			if (error instanceof areas.AreaExistsError) return { failure: 'exists', ok: false };
			if (error instanceof areas.AreaNameInvalidError) return { failure: 'invalid', ok: false };
			throw error;
		}
	});

export { loadAreasPage, submitCreateArea, submitRenameArea };
export type { AreaNameFailure };
