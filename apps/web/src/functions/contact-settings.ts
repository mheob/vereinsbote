import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { protectedFieldRows } from '@/components/admin/contact-settings/field-areas';
import type {
	ProtectedFieldRow,
	SettingsArea,
} from '@/components/admin/contact-settings/field-areas';
import { BUILTIN_PROTECTED_FIELD_KEYS, CONTACT_KINDS, PROTECTIONS } from '@/server/contacts/fields';
import type { ContactKind } from '@/server/contacts/fields';
import type { ContactSettings, CustomFieldRecord } from '@/server/contacts/settings';

/*
 * The server functions of the contact settings. Server modules are imported inside the handlers,
 * so they stay out of the client bundle. Each handler checks the session itself, the domain
 * functions check the admin role: server functions are reachable without their page.
 */

/** What the settings page shows. */
interface ContactSettingsPage {
	/** All areas, by name. */
	areas: SettingsArea[];
	settings: ContactSettings;
	/** The protected fields of each kind with the areas that see them. */
	fields: Record<ContactKind, ProtectedFieldRow[]>;
	/** The custom fields of both kinds, members first, each kind oldest first. */
	customFields: CustomFieldRecord[];
}

/** A saved setting; distinct from `undefined`, which `useServerFn` gives after a redirect. */
type SavedResult = Readonly<{ ok: true }>;

/** The areas of a field; the last area cannot go. */
type FieldAreasResult = SavedResult | Readonly<{ ok: false; failure: 'noArea' }>;

/** The weeks; the server refuses what is no whole number from 1 to 52. */
type StaleImportWeeksResult = SavedResult | Readonly<{ ok: false; failure: 'invalid' }>;

/** More areas than any club has; bounds the request. */
const MAX_AREA_IDS = 1000;

const SAVED: SavedResult = { ok: true };

const contactAreasRequest = z.object({ membersAreaId: z.uuid(), partnersAreaId: z.uuid() });

const fieldKeySchema = z.union([
	z.enum(BUILTIN_PROTECTED_FIELD_KEYS),
	z.templateLiteral(['custom:', z.uuid()]),
]);

const fieldAreasRequest = z.object({
	areaIds: z.array(z.uuid()).max(MAX_AREA_IDS),
	fieldKey: fieldKeySchema,
	kind: z.enum(CONTACT_KINDS),
});

const customFieldProtectionRequest = z.object({
	customFieldId: z.uuid(),
	protection: z.enum(PROTECTIONS),
});

/** Any finite number: the domain refuses what is out of range, as a result. */
const staleImportWeeksRequest = z.object({ weeks: z.number() });

/** The settings, the areas, the protected fields of both kinds and the custom fields. */
const loadContactSettingsPage = createServerFn({ method: 'GET' }).handler(
	async (): Promise<ContactSettingsPage> => {
		const [{ requireRequestPrincipal }, { assertAdmin }, { listAreas }, settings] =
			await Promise.all([
				import('@/platform/request-principal'),
				import('@/server/permissions/principal'),
				import('@/server/areas/areas'),
				import('@/server/contacts/settings'),
			]);
		const { context, principal } = await requireRequestPrincipal();
		// The readers of the settings do not check the role; the page is for admins only.
		assertAdmin(principal);
		const { db } = context;
		const [areas, current, memberCustom, partnerCustom, memberFields, partnerFields] =
			await Promise.all([
				listAreas(db, principal),
				settings.getContactSettings(db),
				settings.listCustomFields(db, 'member'),
				settings.listCustomFields(db, 'partner'),
				settings.getFieldAreas(db, 'member'),
				settings.getFieldAreas(db, 'partner'),
			]);
		return {
			areas: areas.map(({ id, name }) => ({ id, name })),
			customFields: [...memberCustom, ...partnerCustom],
			fields: {
				member: protectedFieldRows(memberFields, memberCustom),
				partner: protectedFieldRows(partnerFields, partnerCustom),
			},
			settings: current,
		};
	},
);

/** Changes the members and partners area. */
const submitContactAreas = createServerFn({ method: 'POST' })
	.validator(contactAreasRequest)
	.handler(async ({ data }): Promise<SavedResult> => {
		const [{ requireRequestPrincipal }, { setContactAreas }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/contacts/settings'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		await setContactAreas(context.db, principal, data);
		return SAVED;
	});

/** Sets the areas that see one protected field of one kind; without an area it is refused. */
const submitFieldAreas = createServerFn({ method: 'POST' })
	.validator(fieldAreasRequest)
	.handler(async ({ data }): Promise<FieldAreasResult> => {
		const [{ requireRequestPrincipal }, settings] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/contacts/settings'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await settings.setFieldAreas(context.db, principal, data);
			return SAVED;
		} catch (error) {
			if (error instanceof settings.FieldAreasEmptyError) return { failure: 'noArea', ok: false };
			throw error;
		}
	});

/** Switches a custom field between base field and protected field. */
const submitCustomFieldProtection = createServerFn({ method: 'POST' })
	.validator(customFieldProtectionRequest)
	.handler(async ({ data }): Promise<SavedResult> => {
		const [{ requireRequestPrincipal }, { setCustomFieldProtection }] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/contacts/settings'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		await setCustomFieldProtection(context.db, principal, data);
		return SAVED;
	});

/** Sets the weeks after which the member data counts as old; refused weeks come back. */
const submitStaleImportWeeks = createServerFn({ method: 'POST' })
	.validator(staleImportWeeksRequest)
	.handler(async ({ data }): Promise<StaleImportWeeksResult> => {
		const [{ requireRequestPrincipal }, settings] = await Promise.all([
			import('@/platform/request-principal'),
			import('@/server/contacts/settings'),
		]);
		const { context, principal } = await requireRequestPrincipal();
		try {
			await settings.setStaleImportWeeks(context.db, principal, data.weeks);
			return SAVED;
		} catch (error) {
			if (error instanceof settings.StaleImportWeeksInvalidError) {
				return { failure: 'invalid', ok: false };
			}
			throw error;
		}
	});

export {
	loadContactSettingsPage,
	submitContactAreas,
	submitCustomFieldProtection,
	submitFieldAreas,
	submitStaleImportWeeks,
};
export type { ContactSettingsPage };
