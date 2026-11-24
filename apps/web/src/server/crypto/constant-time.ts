const encoder = new TextEncoder();

async function sha256(value: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

/**
 * Compares a secret in constant time. Both values are hashed first, so the comparison always
 * runs over 32 bytes and visits every byte: neither the length of a value nor a shared prefix
 * shows in the time it takes.
 *
 * @param given The value from the request.
 * @param expected The configured secret.
 * @returns True when the values are equal.
 */
async function secretsMatch(given: string, expected: string): Promise<boolean> {
	const [givenHash, expectedHash] = await Promise.all([sha256(given), sha256(expected)]);
	let difference = 0;
	for (const [index, byte] of givenHash.entries()) {
		// oxlint-disable-next-line no-bitwise -- XOR and OR keep the comparison free of early exits
		difference |= byte ^ (expectedHash[index] ?? 0);
	}
	return difference === 0;
}

export { secretsMatch };
