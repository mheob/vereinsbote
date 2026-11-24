import { eq, sql } from 'drizzle-orm';

import type { Db } from '@/server/db/client';
import { importState } from '@/server/db/schema';

import type { ContactKind } from './fields';

/** What the import knows about the stock of one kind. */
interface ImportStateRecord {
	kind: ContactKind;
	/** Counts every change of the stock; a confirmed import compares it to the one it previewed. */
	stockVersion: number;
	lastConfirmedAt: Date | null;
	/** The column mapping of the last confirmed import. */
	mapping: unknown;
}

/**
 * The state of a kind without a row yet.
 *
 * @param kind The kind.
 * @returns Version 0, no import, no mapping.
 */
function initialState(kind: ContactKind): ImportStateRecord {
	return { kind, lastConfirmedAt: null, mapping: null, stockVersion: 0 };
}

/**
 * Reads the import state of a kind.
 *
 * @param db The database or a transaction.
 * @param kind The kind.
 * @returns The state; version 0 when no row exists.
 */
async function getImportState(db: Db, kind: ContactKind): Promise<ImportStateRecord> {
	const [row] = await db.select().from(importState).where(eq(importState.kind, kind));
	return row ?? initialState(kind);
}

/**
 * Reads the import state of a kind and locks its row until the transaction ends, so two imports
 * of one kind exclude each other. The row is created when needed.
 *
 * @param tx The transaction.
 * @param kind The kind.
 * @returns The locked state.
 */
async function lockImportState(tx: Db, kind: ContactKind): Promise<ImportStateRecord> {
	await tx.insert(importState).values({ kind }).onConflictDoNothing();
	const [row] = await tx.select().from(importState).where(eq(importState.kind, kind)).for('update');
	if (row === undefined) throw new Error('The import state row is missing after creating it.');
	return row;
}

/**
 * Counts one change of the stock of a kind (a suppression, an opt-out, a partner edit).
 *
 * @param tx The database or a transaction.
 * @param kind The kind.
 */
async function bumpStockVersion(tx: Db, kind: ContactKind): Promise<void> {
	await tx
		.insert(importState)
		.values({ kind, stockVersion: 1 })
		.onConflictDoUpdate({
			set: { stockVersion: sql`${importState.stockVersion} + 1` },
			target: importState.kind,
		});
}

/**
 * Records a confirmed import: when it happened and the mapping it used. It counts as a change
 * of the stock.
 *
 * @param tx The database or a transaction.
 * @param kind The kind.
 * @param input The time of the import and the mapping to remember.
 */
async function recordConfirmedImport(
	tx: Db,
	kind: ContactKind,
	input: Readonly<{ at: Date; mapping: unknown }>,
): Promise<void> {
	await tx
		.insert(importState)
		.values({ kind, lastConfirmedAt: input.at, mapping: input.mapping, stockVersion: 1 })
		.onConflictDoUpdate({
			set: {
				lastConfirmedAt: input.at,
				mapping: input.mapping,
				stockVersion: sql`${importState.stockVersion} + 1`,
			},
			target: importState.kind,
		});
}

export { bumpStockVersion, getImportState, lockImportState, recordConfirmedImport };
export type { ImportStateRecord };
