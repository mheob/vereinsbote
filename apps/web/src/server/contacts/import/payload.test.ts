import { describe, expect, it } from 'vite-plus/test';

import {
	DEFAULT_IMPORT_OPTIONS,
	MAX_COLUMNS,
	MAX_EMPTY_MARKERS,
	MAX_HEADER_LENGTH,
	savedMappingSchema,
} from './mapping';
import {
	decodeImportPayload,
	encodeImportPayload,
	ImportPayloadError,
	MAX_COMPRESSED_PAYLOAD_BYTES,
	MAX_IMPORT_ROWS,
	MAX_PAYLOAD_BYTES,
	toSavedMapping,
} from './payload';
import type { ImportPayload } from './payload';
import { partnerPayload } from './testing';

const PAYLOAD: ImportPayload = {
	columns: [
		{ header: 'Nr.', target: { field: 'memberNumber', type: 'field' } },
		{ header: 'Abteilungen', target: { type: 'groups' } },
		{ header: 'Spind', target: { name: 'Spind', type: 'newCustomField', valueType: 'text' } },
	],
	discardedHeaders: ['Typ', 'Notiz'],
	filters: [{ column: 'Typ', operator: 'is', value: 'Mitglied' }],
	kind: 'member',
	options: { ...DEFAULT_IMPORT_OPTIONS, genderValues: { weiblich: 'female' } },
	rows: [
		{ cells: ['0042', 'Fußball, Danceaerobic', null], line: 2 },
		{ cells: ['43', '-', 'B12'], line: 4 },
	],
};

const PARTNER_ROW = ['100001', 'Bäckerei Körner GmbH', '-', '-', 'keine Angabe'];
const PARTNER = partnerPayload([PARTNER_ROW]);

/**
 * Distinct short labels.
 *
 * @param count The number of labels.
 * @returns `c0`, `c1`, …
 */
function labels(count: number): string[] {
	return Array.from({ length: count }, (_label, index) => `c${index}`);
}

/** As many discarded headers as fit beside the mapped columns of `PAYLOAD`. */
const DISCARDED_AT_LIMIT = labels(MAX_COLUMNS - PAYLOAD.columns.length);
const TOO_MANY_MARKERS = labels(MAX_EMPTY_MARKERS + 1);

/** JSON the schema refuses, each case built from a valid payload. */
const INVALID_JSON: [string, unknown][] = [
	['an unknown kind', { ...PAYLOAD, kind: 'sponsor' }],
	[
		'memberNumber target in a partner payload',
		{
			...PARTNER,
			columns: [
				{ header: 'Nr.', target: { field: 'memberNumber', type: 'field' } },
				...PARTNER.columns.slice(1),
			],
		},
	],
	[
		'groups in a partner payload',
		{
			...PARTNER,
			columns: [...PARTNER.columns, { header: 'Status', target: { type: 'groups' } }],
			rows: [{ cells: [...PARTNER_ROW, 'Aktiv'], line: 2 }],
		},
	],
	['fewer cells than columns', { ...PAYLOAD, rows: [{ cells: ['0042', null], line: 2 }] }],
	[
		'more cells than columns',
		{ ...PAYLOAD, rows: [{ cells: ['0042', null, null, 'x'], line: 2 }] },
	],
	['a header twice', { ...PAYLOAD, discardedHeaders: ['Typ', 'Nr.'] }],
	['a line number below 1', { ...PAYLOAD, rows: [{ cells: ['0042', null, null], line: 0 }] }],
	[
		'too many empty markers',
		{ ...PAYLOAD, options: { ...PAYLOAD.options, emptyMarkers: TOO_MANY_MARKERS } },
	],
	[
		'more columns than the limit with the discarded ones',
		{ ...PAYLOAD, discardedHeaders: [...DISCARDED_AT_LIMIT, 'extra'] },
	],
	[
		'a header over the limit',
		{ ...PAYLOAD, discardedHeaders: ['x'.repeat(MAX_HEADER_LENGTH + 1)] },
	],
	[
		'a discard target among the columns',
		{
			...PAYLOAD,
			columns: [...PAYLOAD.columns.slice(0, 2), { header: 'Spind', target: { type: 'discard' } }],
		},
	],
];

/**
 * Compresses bytes with gzip, as the browser does.
 *
 * @param body The bytes or text.
 * @returns The compressed blob.
 */
async function gzip(body: string | Uint8Array<ArrayBuffer>): Promise<Blob> {
	return new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

/**
 * Text that gzip cannot shrink much: random characters from 64 printable ones.
 *
 * @param length The number of characters.
 * @returns The text.
 */
function noise(length: number): string {
	const bytes = new Uint8Array(length);
	const chunk = 65_536;
	for (let offset = 0; offset < length; offset += chunk) {
		crypto.getRandomValues(bytes.subarray(offset, offset + chunk));
	}
	const firstPrintable = 0x30;
	const alphabetSize = 64;
	return new TextDecoder().decode(bytes.map((byte) => firstPrintable + (byte % alphabetSize)));
}

describe('limits', () => {
	it('uses the limits of decision 1', () => {
		expect(MAX_IMPORT_ROWS).toBe(10_000);
		expect(MAX_COMPRESSED_PAYLOAD_BYTES).toBe(4_000_000);
		expect(MAX_PAYLOAD_BYTES).toBe(16 * 1024 * 1024);
	});
});

describe(decodeImportPayload, () => {
	it('round-trips a payload through gzip', async () => {
		await expect(decodeImportPayload(await encodeImportPayload(PAYLOAD))).resolves.toStrictEqual(
			PAYLOAD,
		);
		await expect(decodeImportPayload(await encodeImportPayload(PARTNER))).resolves.toStrictEqual(
			PARTNER,
		);
	});

	it('refuses a compressed payload above 4 000 000 bytes without unpacking', async () => {
		const above = new Blob([new Uint8Array(4_000_001)]);
		await expect(decodeImportPayload(above)).rejects.toMatchObject({ reason: 'tooLarge' });
		// At the limit the size passes; the zeros are no gzip.
		const atLimit = new Blob([new Uint8Array(4_000_000)]);
		await expect(decodeImportPayload(atLimit)).rejects.toMatchObject({ reason: 'invalid' });
	});

	it('stops unpacking above 16 MiB', async () => {
		const bomb = await gzip(new Uint8Array(17 * 1024 * 1024));
		expect(bomb.size).toBeLessThan(MAX_COMPRESSED_PAYLOAD_BYTES);
		await expect(decodeImportPayload(bomb)).rejects.toMatchObject({ reason: 'tooLarge' });
	});

	it.each([
		['not gzip', new Blob(['not gzip'])],
		['an empty body', new Blob([])],
	])('refuses %s as invalid', async (_name, body) => {
		await expect(decodeImportPayload(body)).rejects.toMatchObject({ reason: 'invalid' });
	});

	it.each<[string, string | Uint8Array<ArrayBuffer>]>([
		['not JSON', '{"kind":'],
		// A quote, two bytes that are no UTF-8, a quote.
		['not UTF-8', new Uint8Array([34, 255, 254, 34])],
	])('refuses gzip with %s as invalid', async (_name, content) => {
		const body = await gzip(content);
		await expect(decodeImportPayload(body)).rejects.toMatchObject({ reason: 'invalid' });
	});

	it.each(INVALID_JSON)('refuses %s as invalid', async (_name, value) => {
		const body = await gzip(JSON.stringify(value));
		const refusal = decodeImportPayload(body);
		await expect(refusal).rejects.toBeInstanceOf(ImportPayloadError);
		await expect(refusal).rejects.toMatchObject({ reason: 'invalid' });
	});

	it('reads a payload at the column limit and saves a mapping the schema reads back', async () => {
		const wide = { ...PAYLOAD, discardedHeaders: DISCARDED_AT_LIMIT };
		const decoded = await decodeImportPayload(await encodeImportPayload(wide));
		expect(decoded).toStrictEqual(wide);
		expect(savedMappingSchema.safeParse(toSavedMapping(decoded)).success).toBe(true);
	});

	it('cleans the names of new custom fields', async () => {
		const target = { name: ' Spind\t', type: 'newCustomField', valueType: 'text' };
		const columns = [...PAYLOAD.columns.slice(0, 2), { header: 'Spind', target }];
		const body = await gzip(JSON.stringify({ ...PAYLOAD, columns }));
		const decoded = await decodeImportPayload(body);
		expect(decoded.columns[2]?.target).toStrictEqual({
			name: 'Spind',
			type: 'newCustomField',
			valueType: 'text',
		});
	});
});

describe(encodeImportPayload, () => {
	it('refuses a payload above 16 MiB', async () => {
		const huge = {
			...PAYLOAD,
			rows: [{ cells: ['1', 'x'.repeat(MAX_PAYLOAD_BYTES), null], line: 2 }],
		};
		await expect(encodeImportPayload(huge)).rejects.toMatchObject({ reason: 'tooLarge' });
	});

	it('refuses a payload that stays above 4 000 000 bytes compressed', async () => {
		const dense = { ...PAYLOAD, rows: [{ cells: ['1', noise(6_000_000), null], line: 2 }] };
		await expect(encodeImportPayload(dense)).rejects.toMatchObject({ reason: 'tooLarge' });
	});
});

describe(ImportPayloadError, () => {
	it('names the reason only', () => {
		const error = new ImportPayloadError('invalid');
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('ImportPayloadError');
		expect(error.reason).toBe('invalid');
	});
});

describe(toSavedMapping, () => {
	it('remembers the mapped and the discarded columns, the filters and the options', () => {
		expect(toSavedMapping(PAYLOAD)).toStrictEqual({
			columns: {
				Abteilungen: { type: 'groups' },
				Notiz: { type: 'discard' },
				'Nr.': { field: 'memberNumber', type: 'field' },
				Spind: { name: 'Spind', type: 'newCustomField', valueType: 'text' },
				Typ: { type: 'discard' },
			},
			filters: [{ column: 'Typ', operator: 'is', value: 'Mitglied' }],
			options: PAYLOAD.options,
		});
	});
});
