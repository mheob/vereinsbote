/* oxlint-disable max-classes-per-file -- the plan's interface defines both errors in this module */
import { eq, inArray } from 'drizzle-orm';

import { brandSchema, DEFAULT_BRAND } from '@/mail/brand/brand-schema';
import type { Brand, BrandLogo } from '@/mail/brand/brand-schema';
import { writeAudit } from '@/server/audit/audit';
import type { Db } from '@/server/db/client';
import { brandSettings, media } from '@/server/db/schema';
import { assertAdmin } from '@/server/permissions/principal';
import type { Principal } from '@/server/permissions/principal';

const SINGLETON_ID = 1;

interface BrandState {
	brand: Brand;
	/** 0 until the first save. */
	version: number;
	/** False until an admin saved the brand once (the start page offers "set up the brand"). */
	configured: boolean;
}

/** Another admin saved first: the version does not match. The message names nothing. */
class BrandChangedError extends Error {
	public constructor() {
		super('The brand was changed in the meantime.');
		this.name = 'BrandChangedError';
	}
}

/** A logo is no (longer a) brand image. The message names nothing. */
class UnknownLogoError extends Error {
	public constructor() {
		super('Unknown logo.');
		this.name = 'UnknownLogoError';
	}
}

/**
 * The brand of the club.
 *
 * @param db The database.
 * @returns The saved brand, or the default brand with `configured: false` and version 0. Stored
 * settings that no longer pass the schema give the default brand with the stored version.
 */
async function getBrand(db: Db): Promise<BrandState> {
	const [row] = await db.select().from(brandSettings).where(eq(brandSettings.id, SINGLETON_ID));
	if (row === undefined) return { brand: DEFAULT_BRAND, configured: false, version: 0 };
	const parsed = brandSchema.safeParse(row.settings);
	return {
		brand: parsed.success ? parsed.data : DEFAULT_BRAND,
		configured: true,
		version: row.version,
	};
}

interface StoredLogo {
	readonly height: number;
	readonly id: string;
	readonly purpose: 'brand' | 'library';
	readonly type: 'jpeg' | 'png';
	readonly width: number;
}

function resolveLogo(
	stored: ReadonlyMap<string, StoredLogo>,
	logo: BrandLogo | null,
): BrandLogo | null {
	if (logo === null) return null;
	const row = stored.get(logo.mediaId);
	if (row === undefined) throw new UnknownLogoError();
	return {
		alt: logo.alt,
		height: row.height,
		mediaId: logo.mediaId,
		type: row.type,
		width: row.width,
	};
}

/**
 * Checks that every logo is a brand image and takes type and size from the stored image, not from
 * the input.
 *
 * @param db The database or transaction.
 * @param brand The brand as submitted.
 * @returns The brand with the logos as stored.
 * @throws {UnknownLogoError} When a logo is missing or no brand image.
 */
async function withStoredLogos(db: Db, brand: Brand): Promise<Brand> {
	const ids = [brand.headerLogo, brand.footerLogo].flatMap((logo) =>
		logo === null ? [] : [logo.mediaId],
	);
	if (ids.length === 0) return brand;
	const rows = await db
		.select({
			height: media.height,
			id: media.id,
			purpose: media.purpose,
			type: media.type,
			width: media.width,
		})
		.from(media)
		.where(inArray(media.id, ids));
	const stored = new Map(rows.filter((row) => row.purpose === 'brand').map((row) => [row.id, row]));
	return {
		...brand,
		footerLogo: resolveLogo(stored, brand.footerLogo),
		headerLogo: resolveLogo(stored, brand.headerLogo),
	};
}

interface RowValues {
	readonly settings: Brand;
	readonly updatedAt: Date;
	readonly updatedByUserId: string;
	readonly version: number;
}

async function writeRow(db: Db, loadedVersion: number, values: Readonly<RowValues>): Promise<void> {
	if (loadedVersion === 0) {
		const inserted = await db
			.insert(brandSettings)
			.values({ ...values, id: SINGLETON_ID })
			.onConflictDoNothing()
			.returning({ id: brandSettings.id });
		if (inserted.length === 0) throw new BrandChangedError();
		return;
	}
	const [current] = await db
		.select({ version: brandSettings.version })
		.from(brandSettings)
		.where(eq(brandSettings.id, SINGLETON_ID))
		.for('update');
	if (current?.version !== loadedVersion) throw new BrandChangedError();
	await db.update(brandSettings).set(values).where(eq(brandSettings.id, SINGLETON_ID));
}

/**
 * Saves the brand. In one transaction the singleton row is locked (`FOR UPDATE`) or, for the
 * first save, inserted; a version that does not match is refused, so of two concurrent saves the
 * second fails and nothing is lost. A replaced logo stays as file and row (Design 7).
 *
 * @param db The database.
 * @param actor Who saves; must be an admin.
 * @param input The brand (already parsed with `brandSchema`) and the version the form was
 * loaded with (0 before the first save).
 * @param input.brand The brand.
 * @param input.version The version the form was loaded with.
 * @returns The new version.
 * @throws {BrandChangedError} When the stored version differs from `input.version`.
 * @throws {UnknownLogoError} When a logo is no brand image.
 * @throws {z.ZodError} When the brand does not pass `brandSchema` (callers validate first).
 */
async function saveBrand(
	db: Db,
	actor: Principal,
	input: Readonly<{ brand: Brand; version: number }>,
): Promise<{ version: number }> {
	assertAdmin(actor);
	const brand = brandSchema.parse(input.brand);
	return db.transaction(async (tx) => {
		const settings = await withStoredLogos(tx, brand);
		const version = input.version + 1;
		await writeRow(tx, input.version, {
			settings,
			updatedAt: new Date(),
			updatedByUserId: actor.userId,
			version,
		});
		await writeAudit(tx, {
			action: 'brand.changed',
			actorUserId: actor.userId,
			details: { version },
			target: 'brand',
		});
		return { version };
	});
}

export { BrandChangedError, getBrand, saveBrand, UnknownLogoError };
export type { BrandState };
