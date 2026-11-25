/*
 * Writes `src/server/html-import/caniemail-outlook.json`: the CSS that classic Outlook for Windows
 * does not support, from caniemail's public data (https://www.caniemail.com/api/data.json, the
 * repository https://github.com/hteumeuleu/caniemail is MIT licensed, Copyright (c) 2019 Remi
 * Parmentier). Run by hand with `vp run --filter web caniemail:update` and commit the file; the
 * import only reads the JSON, no build or test fetches anything.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { caniemailSchema, extractOutlookCss } from '@/server/html-import/caniemail';

const ISO_DATE_LENGTH = 10;
const SOURCE = 'https://www.caniemail.com/api/data.json';
const OUT_FILE = path.join(
	import.meta.dirname,
	'..',
	'src',
	'server',
	'html-import',
	'caniemail-outlook.json',
);

const response = await fetch(SOURCE);
if (!response.ok)
	throw new Error(`Fetching ${SOURCE} failed with status ${String(response.status)}.`);
const data: unknown = await response.json();
const { last_update_date: dataDate } = caniemailSchema.parse(data);

const result = {
	client: 'Outlook for Windows (classic), newest test of caniemail',
	copyright: 'Copyright (c) 2019 Remi Parmentier',
	dataDate,
	license: 'MIT',
	licenseUrl: 'https://github.com/hteumeuleu/caniemail/blob/main/LICENSE',
	retrieved: new Date().toISOString().slice(0, ISO_DATE_LENGTH),
	source: SOURCE,
	...extractOutlookCss(data),
};
await writeFile(OUT_FILE, `${JSON.stringify(result, undefined, '\t')}\n`);
console.info(`Wrote ${OUT_FILE}`);
