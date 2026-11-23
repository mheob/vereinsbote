// Checks that every package.json takes its external versions from the pnpm catalog and its
// internal packages from the workspace. Prints one line per violation and exits with code 1.

import { readdir, readFile } from 'node:fs/promises';

type JsonObject = Readonly<Record<string, unknown>>;

const DEPENDENCY_FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
] as const;

/** `catalog:`, a named catalog like `catalog:react`, or `workspace:*`. */
const ALLOWED_SPEC = /^(?:catalog:[\w.-]*|workspace:\*)$/u;

const rootUrl = new URL('../', import.meta.url);

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
	return (
		error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR'].includes(String(error.code))
	);
}

/**
 * Reads a package.json relative to the repository root.
 *
 * @param path The path of the package.json.
 * @returns The parsed file, or `null` when it does not exist.
 */
async function readPackageJson(path: string): Promise<JsonObject | null> {
	try {
		const json: unknown = JSON.parse(await readFile(new URL(path, rootUrl), 'utf8'));
		if (!isJsonObject(json)) throw new TypeError(`${path} is not a JSON object.`);
		return json;
	} catch (error) {
		if (isMissingFile(error)) return null;
		throw error;
	}
}

/**
 * Lists the dependencies whose version does not come from the catalog or the workspace.
 *
 * @param path The path of the package.json, used when the package has no name.
 * @param packageJson The parsed package.json.
 * @returns One `<package>: <dependency> = <spec>` line per violation.
 */
function findViolations(path: string, packageJson: JsonObject): string[] {
	const packageName = typeof packageJson.name === 'string' ? packageJson.name : path;

	return DEPENDENCY_FIELDS.flatMap((field) => {
		const dependencies = packageJson[field];
		if (!isJsonObject(dependencies)) return [];

		return Object.entries(dependencies)
			.filter(
				([, spec]: readonly [string, unknown]) =>
					typeof spec !== 'string' || !ALLOWED_SPEC.test(spec),
			)
			.map(
				([name, spec]: readonly [string, unknown]) => `${packageName}: ${name} = ${String(spec)}`,
			);
	});
}

const apps = await readdir(new URL('apps/', rootUrl));
const paths = ['package.json', ...apps.map((app) => `apps/${app}/package.json`)];
const packageJsons = await Promise.all(paths.map(async (path) => readPackageJson(path)));
const violations = paths.flatMap((path, index) => {
	const packageJson = packageJsons[index];
	return packageJson === null || packageJson === undefined ? [] : findViolations(path, packageJson);
});

if (violations.length > 0) {
	console.error(violations.join('\n'));
	process.exitCode = 1;
}
