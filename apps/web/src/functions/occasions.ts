import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import type { AppContext } from '@/platform/context';
import type { OccasionFailure } from '@/server/occasions/failures';
import type { OccasionRecord } from '@/server/occasions/occasions';
import type { Principal } from '@/server/permissions/principal';

/*
 * The server functions of the occasion pages. Server modules are imported inside the handlers,
 * so they stay out of the client bundle. Each handler authorizes itself from the session
 * principal: server functions are reachable without their page. Expected refusals come back as
 * results.
 */

/** An area whose occasions the user may see. */
interface OccasionArea {
	readonly id: string;
	readonly name: string;
	readonly canEdit: boolean;
}

/** A template an occasion of its area can use. */
interface TemplateChoice {
	readonly id: string;
	readonly areaId: string;
	readonly name: string;
}

/** A sender released to an area, as the choice shows it: „Anzeigename <adresse>“. */
interface SenderChoice {
	readonly id: string;
	readonly areaId: string;
	readonly label: string;
}

/** The areas the user may read and what an occasion of each can choose from. */
interface OccasionChoices {
	readonly areas: readonly Readonly<OccasionArea>[];
	readonly templates: readonly Readonly<TemplateChoice>[];
	readonly senders: readonly Readonly<SenderChoice>[];
}

interface OccasionListPage extends OccasionChoices {
	readonly occasions: readonly Readonly<OccasionRecord>[];
}

interface OccasionPage extends OccasionChoices {
	readonly occasion: Readonly<OccasionRecord>;
	/** Whether the user may change the occasion: `edit` in its area, and it is not archived. */
	readonly canEdit: boolean;
	/** Whether the user may send waves of it: `send` in its area, and it is not archived. */
	readonly canSend: boolean;
}

type CreateOccasionResult = Readonly<{ ok: true; id: string }> | OccasionFailure;
type SaveOccasionResult = Readonly<{ ok: true; version: number }> | OccasionFailure;
type RemoveOccasionResult =
	| Readonly<{ ok: true; result: 'archived' | 'deleted' }>
	| OccasionFailure;

/** The longest id the server looks at; ids are 36 characters. */
const MAX_ID_LENGTH = 100;
/** The longest name accepted before the occasion's own limit (100). */
const MAX_TEXT_INPUT = 10_000;

const occasionInput = z.object({
	kind: z.enum(['personal', 'circular']),
	name: z.string().max(MAX_TEXT_INPUT),
	senderId: z.uuid(),
	templateId: z.uuid(),
	unsubscribe: z.boolean(),
});
const createRequest = z.object({ areaId: z.uuid(), input: occasionInput });
const saveRequest = z.object({
	id: z.uuid(),
	input: occasionInput,
	version: z.int().min(1),
});
const removeRequest = z.object({ id: z.uuid(), version: z.int().min(1) });
const pageRequest = z.object({ id: z.string().max(MAX_ID_LENGTH) });

/**
 * The areas the user may read with their templates and released senders.
 *
 * @param context The app context.
 * @param principal Who asks.
 * @returns The choices.
 */
async function loadChoices(
	context: Pick<AppContext, 'db'>,
	principal: Principal,
): Promise<OccasionChoices> {
	const [{ listAreas }, { listTemplates }, { sendersForArea }, { levelAtLeast }] =
		await Promise.all([
			import('@/server/areas/areas'),
			import('@/server/templates/templates'),
			import('@/server/sending/senders'),
			import('@/server/permissions/levels'),
		]);
	const listed = await listAreas(context.db, principal);
	const areas = listed
		.filter(({ level }) => level !== null)
		.map(({ id, level, name }) => ({ canEdit: levelAtLeast(level, 'edit'), id, name }));
	const readable = await listTemplates(context.db, principal);
	const templates = readable.map(({ areaId, id, name }) => ({ areaId, id, name }));
	const perArea = await Promise.all(
		areas.map(async ({ id: areaId }) => {
			const released = await sendersForArea(context.db, areaId);
			return released.map((sender) => ({
				areaId,
				id: sender.id,
				label: `${sender.displayName} <${sender.email}>`,
			}));
		}),
	);
	const senders = perArea.flat();
	return { areas, senders, templates };
}

/** The occasions of the areas the user may read, with the areas and what an occasion can use. */
const loadOccasionList = createServerFn({ method: 'GET' }).handler(
	async (): Promise<OccasionListPage> => {
		const [{ requireRequestPrincipal }, { listOccasions }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/occasions/occasions'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		const choices = await loadChoices(context, principal);
		return { ...choices, occasions: await listOccasions(context.db, principal) };
	},
);

/** What the page „Neuer Anlass“ needs: the areas, their templates and their released senders. */
const loadNewOccasion = createServerFn({ method: 'GET' }).handler(
	async (): Promise<OccasionChoices> => {
		const { requireRequestPrincipal } = await import('@/platform/request-principal');
		const { context, principal } = await requireRequestPrincipal();
		return loadChoices(context, principal);
	},
);

/**
 * Loads the occasion of a page with the choices around it.
 *
 * @param context The app context.
 * @param principal Who asks.
 * @param id The occasion.
 * @returns The page.
 * @throws {OccasionNotFoundError} When no occasion has the id.
 * @throws {ForbiddenError} Without `read` in the occasion's area.
 */
async function readOccasionPage(
	context: Pick<AppContext, 'db'>,
	principal: Principal,
	id: string,
): Promise<OccasionPage> {
	const [{ getOccasion }, { canAccessArea }] = await Promise.all([
		import('@/server/occasions/occasions'),
		import('@/server/permissions/principal'),
	]);
	const occasion = await getOccasion(context.db, principal, id);
	const choices = await loadChoices(context, principal);
	const live = occasion.archivedAt === null;
	const canEdit =
		live &&
		choices.areas.some(({ canEdit: mayEdit, id: areaId }) => areaId === occasion.areaId && mayEdit);
	const canSend = live && canAccessArea(principal, occasion.areaId, 'send');
	return { ...choices, canEdit, canSend, occasion };
}

/**
 * One occasion for its page. An occasion that does not exist, or one in an area the user may not
 * read, is "not found": the page does not tell the two apart.
 */
const loadOccasionPage = createServerFn({ method: 'GET' })
	.validator(pageRequest)
	.handler(async ({ data }): Promise<OccasionPage> => {
		const [{ requireRequestPrincipal }, { ForbiddenError }, { OccasionNotFoundError }] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/permissions/principal'),
				import('@/server/occasions/errors'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		// oxlint-disable-next-line typescript/only-throw-error -- the router shows its not-found page
		if (!z.uuid().safeParse(data.id).success) throw notFound();
		try {
			return await readOccasionPage(context, principal, data.id);
		} catch (error) {
			if (error instanceof OccasionNotFoundError || error instanceof ForbiddenError) {
				// oxlint-disable-next-line typescript/only-throw-error -- see above
				throw notFound();
			}
			throw error;
		}
	});

/** Creates an occasion in an area where the user edits. */
const submitCreateOccasion = createServerFn({ method: 'POST' })
	.validator(createRequest)
	.handler(async ({ data }): Promise<CreateOccasionResult> => {
		const [{ requireRequestPrincipal }, occasions, { occasionFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/occasions/occasions'),
			import('@/server/occasions/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const created = await occasions.createOccasion(
				context.db,
				principal,
				data.areaId,
				data.input,
			);
			return { id: created.id, ok: true };
		} catch (error) {
			const failure = occasionFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/** Saves an occasion with the version the page loaded or last saved. */
const submitUpdateOccasion = createServerFn({ method: 'POST' })
	.validator(saveRequest)
	.handler(async ({ data }): Promise<SaveOccasionResult> => {
		const [{ requireRequestPrincipal }, occasions, { occasionFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/occasions/occasions'),
			import('@/server/occasions/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const saved = await occasions.updateOccasion(
				context.db,
				principal,
				data.id,
				data.input,
				data.version,
			);
			return { ok: true, version: saved.version };
		} catch (error) {
			const failure = occasionFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

/** Deletes an occasion without waves or archives one with waves; a newer version refuses it. */
const submitRemoveOccasion = createServerFn({ method: 'POST' })
	.validator(removeRequest)
	.handler(async ({ data }): Promise<RemoveOccasionResult> => {
		const [{ requireRequestPrincipal }, occasions, { occasionFailure }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/occasions/occasions'),
			import('@/server/occasions/failures'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			const result = await occasions.removeOccasion(context.db, principal, data.id, data.version);
			return { ok: true, result };
		} catch (error) {
			const failure = occasionFailure(error);
			if (failure === null) throw error;
			return failure;
		}
	});

export {
	loadNewOccasion,
	loadOccasionList,
	loadOccasionPage,
	submitCreateOccasion,
	submitRemoveOccasion,
	submitUpdateOccasion,
};
export type {
	CreateOccasionResult,
	OccasionArea,
	OccasionChoices,
	OccasionListPage,
	OccasionPage,
	RemoveOccasionResult,
	SaveOccasionResult,
	SenderChoice,
	TemplateChoice,
};
