/*
 * The form the browser sends to preview or confirm an import: the compressed payload as a file
 * and a few text fields. No server imports: the browser writes the form, the server functions
 * read it as their validator.
 */
import { z } from 'zod';

import { CONTACT_KINDS } from '@/server/contacts/fields';
import type { ContactKind } from '@/server/contacts/fields';

import { MAX_IMPORT_ROWS } from './payload';

/** A confirm deletes at most as many partners as an import has rows. */
const MAX_DELETE_IDS = MAX_IMPORT_ROWS;

/** What a preview or a confirm sends; a preview has no version, deletions or ids. */
interface ImportFormRequest {
	readonly kind: ContactKind;
	/** The payload, compressed by `encodeImportPayload`. */
	readonly payload: Blob;
	/** The stock version of the preview the user confirms. */
	readonly stockVersion: number | null;
	/** Members: the number of deletions the user confirmed. */
	readonly confirmedDeletions: number | null;
	/** Partners: the partners missing from the export the user ticked. */
	readonly deleteIds: readonly string[];
}

/** An empty field is null, otherwise a whole number that is not negative. */
const countField = z.union([
	z.literal('').transform(() => null),
	z
		.string()
		.regex(/^(?:0|[1-9]\d{0,14})$/u)
		.transform(Number),
]);

const deleteIdsField = z
	.string()
	.transform((text, context): unknown => {
		try {
			return JSON.parse(text) as unknown;
		} catch {
			context.addIssue({ code: 'custom', message: 'The ids are no JSON.' });
			return z.NEVER;
		}
	})
	.pipe(z.array(z.uuid()).max(MAX_DELETE_IDS));

const textFieldsSchema = z.object({
	confirmedDeletions: countField,
	deleteIds: deleteIdsField,
	kind: z.enum(CONTACT_KINDS),
	stockVersion: countField,
});

/**
 * Writes a request as form data: the text fields as text, null as an empty field, the ids as
 * JSON.
 *
 * @param request The request.
 * @returns The form data.
 */
function toImportFormData(request: ImportFormRequest): FormData {
	const form = new FormData();
	form.set('kind', request.kind);
	form.set('payload', request.payload, 'payload.json.gz');
	form.set('stockVersion', request.stockVersion === null ? '' : String(request.stockVersion));
	form.set(
		'confirmedDeletions',
		request.confirmedDeletions === null ? '' : String(request.confirmedDeletions),
	);
	form.set('deleteIds', JSON.stringify(request.deleteIds));
	return form;
}

/**
 * Reads the form of an import request; the validator of the import server functions. The payload
 * stays compressed: the handler decodes it.
 *
 * @param data What the server function received.
 * @returns The request.
 * @throws {Error} For anything else than such a form, or a missing or malformed field.
 */
function parseImportFormData(data: unknown): ImportFormRequest {
	if (!(data instanceof FormData)) throw new TypeError('An import request is form data.');
	const payload = data.get('payload');
	if (!(payload instanceof Blob)) throw new TypeError('An import request has a payload file.');
	const fields = textFieldsSchema.parse({
		confirmedDeletions: data.get('confirmedDeletions'),
		deleteIds: data.get('deleteIds'),
		kind: data.get('kind'),
		stockVersion: data.get('stockVersion'),
	});
	return { ...fields, payload };
}

export { MAX_DELETE_IDS, parseImportFormData, toImportFormData };
export type { ImportFormRequest };
