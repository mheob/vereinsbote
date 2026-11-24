/** Workers bindings: variables and secrets are strings, other bindings (R2, D1, …) are objects. */
type Bindings = Readonly<Record<string, unknown>>;

/**
 * Keeps the string bindings, the variables and secrets that `parseEnv` reads. It trims every
 * value, which an object binding (the R2 bucket) would crash, so only strings pass.
 *
 * @param bindings The Worker's bindings.
 * @returns The variables by name.
 */
function variablesOf(bindings: Bindings): Record<string, string> {
	const variables: Record<string, string> = {};
	for (const [name, value] of Object.entries(bindings)) {
		if (typeof value === 'string') variables[name] = value;
	}
	return variables;
}

export { variablesOf };
export type { Bindings };
