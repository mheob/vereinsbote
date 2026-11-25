import type { z } from 'zod';

/**
 * Reads the form of a server function that carries HTML: the HTML goes by POST in form data,
 * never into a URL, and the request body limit answers an oversized one before the function runs.
 *
 * @param schema What the form holds.
 * @returns The validator of the server function.
 * @throws {TypeError} For anything but form data.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a zod schema is an object of methods
export function fromForm<T>(schema: z.ZodType<T>): (data: unknown) => T {
	return (data) => {
		if (!(data instanceof FormData)) throw new TypeError('This call takes form data.');
		return schema.parse(Object.fromEntries(data));
	};
}
