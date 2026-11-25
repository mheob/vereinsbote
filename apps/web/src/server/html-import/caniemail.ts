/*
 * The CSS that classic Outlook for Windows does not support, read from caniemail's public data
 * (MIT). `scripts/update-caniemail.ts` fetches the data and writes `caniemail-outlook.json` with
 * this function; nothing here runs in a build or at runtime, the import only reads the JSON.
 */
import { z } from 'zod';

import { compareCodePoints } from '@/server/compare-code-points';

/** What the import needs to know about the CSS classic Outlook ignores. */
interface OutlookCssData {
	/** Properties Outlook ignores whatever the value is. */
	readonly properties: readonly string[];
	/** Properties it ignores only for some values (`display: flex`), lower case. */
	readonly propertyValues: Readonly<Record<string, readonly string[]>>;
	/** Functions it does not know, with their parentheses (`linear-gradient()`). */
	readonly functions: readonly string[];
}

const versionsSchema = z.record(z.string(), z.string());
const platformsSchema = z.record(z.string(), versionsSchema);
const statsSchema = z.record(z.string(), platformsSchema);

const featureSchema = z.object({
	category: z.string(),
	stats: statsSchema,
	title: z.string(),
});

const caniemailSchema = z.object({
	data: z.array(featureSchema),
	last_update_date: z.string(),
});

type CaniemailData = z.infer<typeof caniemailSchema>;
type Stats = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>;
const NEWEST = -1;

const PROPERTY = /^[a-z][a-z-]*$/u;
const PROPERTY_VALUE = /^(?<property>[a-z][a-z-]*): ?(?<value>[a-z][a-z-]*)$/u;
const FUNCTION = /^[a-z][a-z-]*\(\)$/u;
/** Words behind the name in a title (`min-width property`). */
const TITLE_SUFFIX = / (?:css )?propert(?:y|ies)$/u;
const SEPARATOR = /\s*(?:,|&)\s*/u;

/**
 * Whether the newest test of classic Outlook for Windows says "not supported".
 *
 * @param stats The results of a feature per client family and platform, version by version.
 * @returns True when the last result for `outlook` on `windows` starts with `n`.
 */
function unsupportedInOutlook(stats: Stats): boolean {
	const versions = Object.values(stats.outlook?.windows ?? {});
	return versions.at(NEWEST)?.startsWith('n') ?? false;
}

/**
 * Sorts a list by code point, each entry once.
 *
 * @param values The values.
 * @returns The sorted list.
 */
function sortedUnique(values: Iterable<string>): string[] {
	return [...new Set(values)].toSorted(compareCodePoints);
}

/**
 * The names a title lists: a property (`float`), a property with a value (`display:flex`), a
 * function (`clamp()`) or several of them (`gap, column-gap, row-gap`).
 *
 * @param title The title of a feature.
 * @returns The tokens, lower case.
 */
function tokensOf(title: string): string[] {
	return title.trim().toLowerCase().replace(TITLE_SUFFIX, '').split(SEPARATOR);
}

/**
 * Collects the values of properties that Outlook ignores only for some values.
 *
 * @param tokens The tokens of the unsupported features.
 * @returns The values per property, sorted.
 */
function propertyValuesOf(tokens: readonly string[]): Record<string, string[]> {
	const values = new Map<string, string[]>();
	for (const token of tokens) {
		const pair = PROPERTY_VALUE.exec(token)?.groups;
		if (pair?.property !== undefined && pair.value !== undefined) {
			values.set(pair.property, [...(values.get(pair.property) ?? []), pair.value]);
		}
	}
	return Object.fromEntries(
		[...values]
			.toSorted(([a], [b]) => compareCodePoints(a, b))
			.map(([property, list]) => [property, sortedUnique(list)]),
	);
}

/**
 * Reads the CSS features classic Outlook does not support. A title names a property, a property
 * with a value, a function or several of them; at-rules, selectors and prose are left out.
 *
 * @param input The data of `https://www.caniemail.com/api/data.json`.
 * @returns The properties, the property values and the functions.
 * @throws {z.ZodError} When the data does not have the expected shape.
 */
function extractOutlookCss(input: unknown): OutlookCssData {
	const { data } = caniemailSchema.parse(input);
	const tokens = data
		.filter((feature) => feature.category === 'css' && unsupportedInOutlook(feature.stats))
		.flatMap((feature) => tokensOf(feature.title));
	return {
		functions: sortedUnique(tokens.filter((token) => FUNCTION.test(token))),
		properties: sortedUnique(tokens.filter((token) => PROPERTY.test(token))),
		propertyValues: propertyValuesOf(tokens),
	};
}

export { caniemailSchema, extractOutlookCss };
export type { CaniemailData, OutlookCssData };
