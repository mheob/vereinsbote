/*
 * The rows the browser sends for an import: JSON, compressed with gzip, with limits on both
 * sizes. No server imports: the browser encodes, the server decodes.
 */
import { z } from 'zod';

import { CONTACT_KINDS } from '@/server/contacts/fields';
import type { ContactKind } from '@/server/contacts/fields';

import {
	filterRuleSchema,
	headerSchema,
	importOptionsSchema,
	isTargetOfKind,
	mappedTargetSchema,
	MAX_COLUMNS,
} from './mapping';
import type {
	ColumnTarget,
	FilterRule,
	ImportOptions,
	MappedTarget,
	SavedMapping,
} from './mapping';

/** At most this many rows per import (design 3). */
const MAX_IMPORT_ROWS = 10_000;
/** The compressed payload stays below Vercel's limit of 4.5 MB per request. */
const MAX_COMPRESSED_PAYLOAD_BYTES = 4_000_000;
/** Unpacking stops at 16 MiB, so a small payload cannot fill the server's memory. */
const MAX_PAYLOAD_BYTES = 16_777_216;

/** The mapped columns and rows of a file, and the mapping that produced them. */
interface ImportPayload {
	readonly kind: ContactKind;
	readonly columns: readonly { readonly header: string; readonly target: MappedTarget }[];
	/** Only the names of the discarded columns, for the saved mapping; never their values. */
	readonly discardedHeaders: readonly string[];
	readonly filters: readonly FilterRule[];
	readonly options: ImportOptions;
	/** `cells` in the order of `columns`; `line` is the row's line in the file. */
	readonly rows: readonly { readonly line: number; readonly cells: readonly (string | null)[] }[];
}

type ImportPayloadErrorReason = 'invalid' | 'tooLarge';

/** A payload the server does not read: above a size limit, or not a valid payload. */
class ImportPayloadError extends Error {
	public readonly reason: ImportPayloadErrorReason;

	public constructor(reason: ImportPayloadErrorReason) {
		super(
			reason === 'tooLarge' ? 'The import payload is too large.' : 'The import payload is invalid.',
		);
		this.name = 'ImportPayloadError';
		this.reason = reason;
	}
}

/** A problem the shape of a payload cannot express: messages name the rule, never a value. */
interface PayloadProblem {
	readonly message: string;
	readonly path: readonly (number | string)[];
}

/**
 * Tells whether every column header of a payload, mapped or discarded, is unique.
 *
 * @param payload The payload.
 * @returns True without repeated headers.
 */
function hasUniqueHeaders(payload: ImportPayload): boolean {
	const headers = [...payload.columns.map(({ header }) => header), ...payload.discardedHeaders];
	return new Set(headers).size === headers.length;
}

/**
 * The rules across fields: targets of the payload's kind, unique headers, one cell per column.
 *
 * @param payload The payload.
 * @returns The problems.
 */
function payloadProblems(payload: ImportPayload): PayloadProblem[] {
	const otherKind = payload.columns.flatMap(({ target }, index): PayloadProblem[] =>
		isTargetOfKind(target, payload.kind)
			? []
			: [{ message: 'The kind has no such target.', path: ['columns', index, 'target'] }],
	);
	const unevenRows = payload.rows.flatMap(({ cells }, index): PayloadProblem[] =>
		cells.length === payload.columns.length
			? []
			: [{ message: 'A row needs one cell per column.', path: ['rows', index, 'cells'] }],
	);
	const repeatedHeaders: PayloadProblem[] = hasUniqueHeaders(payload)
		? []
		: [{ message: 'A header appears twice.', path: ['columns'] }];
	const tooWide: PayloadProblem[] =
		payload.columns.length + payload.discardedHeaders.length > MAX_COLUMNS
			? [{ message: 'The file has too many columns.', path: ['discardedHeaders'] }]
			: [];
	return [...otherKind, ...repeatedHeaders, ...tooWide, ...unevenRows];
}

/**
 * Adds the problems across fields to the validation.
 *
 * @param payload The payload.
 * @param context The refinement context of zod.
 */
function refinePayload(payload: ImportPayload, context: z.RefinementCtx): void {
	for (const { message, path } of payloadProblems(payload)) {
		context.addIssue({ code: 'custom', message, path: [...path] });
	}
}

const columnSchema = z.object({ header: headerSchema, target: mappedTargetSchema });
const cellSchema = z.string().nullable();
const rowSchema = z.object({ cells: z.array(cellSchema), line: z.int().min(1) });

const importPayloadSchema: z.ZodType<ImportPayload> = z
	.object({
		columns: z.array(columnSchema).max(MAX_COLUMNS),
		discardedHeaders: z.array(headerSchema).max(MAX_COLUMNS),
		filters: z.array(filterRuleSchema),
		kind: z.enum(CONTACT_KINDS),
		options: importOptionsSchema,
		rows: z.array(rowSchema),
	})
	.superRefine(refinePayload);

/**
 * Compresses a payload for the request. Refuses what the server would refuse for its size.
 *
 * @param payload The payload.
 * @returns The JSON, compressed with gzip.
 * @throws {ImportPayloadError} `tooLarge` above one of the limits.
 */
async function encodeImportPayload(payload: ImportPayload): Promise<Blob> {
	const json = new Blob([JSON.stringify(payload)]);
	if (json.size > MAX_PAYLOAD_BYTES) throw new ImportPayloadError('tooLarge');
	const compressed = await new Response(
		json.stream().pipeThrough(new CompressionStream('gzip')),
	).blob();
	if (compressed.size > MAX_COMPRESSED_PAYLOAD_BYTES) throw new ImportPayloadError('tooLarge');
	return compressed;
}

/**
 * Unpacks a gzip body and stops above `MAX_PAYLOAD_BYTES`.
 *
 * @param blob The compressed body.
 * @returns The unpacked bytes, or the reason they were refused.
 */
async function inflate(blob: Blob): Promise<ArrayBuffer | ImportPayloadErrorReason> {
	const count = { bytes: 0, exceeded: false };
	const limit = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			count.bytes += chunk.byteLength;
			if (count.bytes <= MAX_PAYLOAD_BYTES) {
				controller.enqueue(chunk);
				return;
			}
			count.exceeded = true;
			// Erroring the stream cancels the decompression upstream.
			controller.error(new ImportPayloadError('tooLarge'));
		},
	});
	const unpacked = blob.stream().pipeThrough(new DecompressionStream('gzip')).pipeThrough(limit);
	try {
		return await new Response(unpacked).arrayBuffer();
	} catch {
		return count.exceeded ? 'tooLarge' : 'invalid';
	}
}

/**
 * Reads unpacked bytes as JSON.
 *
 * @param bytes The bytes.
 * @returns The value, or undefined when the bytes are no UTF-8 JSON.
 */
function parseJson(bytes: ArrayBuffer): unknown {
	try {
		// A parse error quotes the input, so it is dropped here and never logged.
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
	} catch {
		return undefined;
	}
}

/**
 * Reads a payload the browser sent: checks the sizes, unpacks and validates it.
 *
 * @param blob The compressed payload.
 * @returns The payload.
 * @throws {ImportPayloadError} `tooLarge` above a size limit (the compressed one before
 *   unpacking); `invalid` for no gzip, no JSON or a payload the schema refuses.
 */
async function decodeImportPayload(blob: Blob): Promise<ImportPayload> {
	if (blob.size > MAX_COMPRESSED_PAYLOAD_BYTES) throw new ImportPayloadError('tooLarge');
	const bytes = await inflate(blob);
	if (typeof bytes === 'string') throw new ImportPayloadError(bytes);
	const parsed = importPayloadSchema.safeParse(parseJson(bytes));
	if (!parsed.success) throw new ImportPayloadError('invalid');
	return parsed.data;
}

/**
 * The mapping a confirmed import saves: the targets of the mapped and discarded columns, the
 * filters and the options.
 *
 * @param payload The confirmed payload.
 * @returns The mapping to save.
 */
function toSavedMapping(payload: ImportPayload): SavedMapping {
	const discard: ColumnTarget = { type: 'discard' };
	return {
		columns: Object.fromEntries([
			...payload.columns.map((column): [string, ColumnTarget] => [column.header, column.target]),
			...payload.discardedHeaders.map((header): [string, ColumnTarget] => [header, discard]),
		]),
		filters: payload.filters,
		options: payload.options,
	};
}

export {
	decodeImportPayload,
	encodeImportPayload,
	ImportPayloadError,
	importPayloadSchema,
	MAX_COMPRESSED_PAYLOAD_BYTES,
	MAX_IMPORT_ROWS,
	MAX_PAYLOAD_BYTES,
	toSavedMapping,
};
export type { ImportPayload, ImportPayloadErrorReason };
