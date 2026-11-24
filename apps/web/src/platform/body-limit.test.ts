import type { setResponseHeaders } from '@tanstack/react-start/server';
import { describe, expect, it, vi } from 'vite-plus/test';

import { MAX_COMPRESSED_PAYLOAD_BYTES } from '@/server/contacts/import/payload';
import { startInstance } from '@/start';

import { exceedsBodyLimit, formBodyLimit, MAX_FORM_BODY_BYTES } from './body-limit';

// Start's response helpers need its request context, which the stand-in executor has not.
vi.mock(import('@tanstack/react-start/server'), async (importOriginal) => ({
	...(await importOriginal()),
	setResponseHeaders: vi.fn<typeof setResponseHeaders>(),
}));

const APP_ORIGIN = 'https://bote.example.org';
const SERVER_FN_URL = `${APP_ORIGIN}/_serverFn/preview-import`;
/** The limit of the tests of `exceedsBodyLimit`. */
const LIMIT = 10;
const OK = 200;
const PAYLOAD_TOO_LARGE = 413;

type HandlerType = 'router' | 'serverFn';

interface StepResult {
	response: Response;
}

/** The part of a request middleware's `server` function the tests call. */
type Step = (
	options: Readonly<{
		context: undefined;
		handlerType: HandlerType;
		next: () => Promise<StepResult>;
		pathname: string;
		request: Request;
	}>,
) => Promise<StepResult | Response> | StepResult | Response;

/**
 * Narrows the `server` function of a request middleware to what the tests call.
 *
 * @param server The `server` option of a request middleware.
 * @returns The function, or undefined when the middleware has none.
 */
function asStep(server: unknown): Step | undefined {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Start types `next` generically over the context, which a stand-in executor cannot express
	return server as Step | undefined;
}

/**
 * A body that arrives in chunks, without a declared length (chunked transfer).
 *
 * @param sizes The size of each chunk.
 * @returns The stream.
 */
function chunks(sizes: readonly number[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const size of sizes) controller.enqueue(new Uint8Array(size));
			controller.close();
		},
	});
}

/**
 * A POST of form data to a server function.
 *
 * @param body The body.
 * @param headers Further headers.
 * @returns The request.
 */
function formPost(
	body: ReadableStream<Uint8Array> | string,
	headers: Readonly<Record<string, string>> = {},
): Request {
	return new Request(SERVER_FN_URL, {
		body,
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node's fetch needs `duplex` for a stream body; the DOM types lack it
		...({ duplex: 'half' } as RequestInit),
		headers: { 'content-type': 'multipart/form-data; boundary=x', ...headers },
		method: 'POST',
	});
}

/**
 * Runs requests through request middlewares the way TanStack Start does; the handler reads the
 * body and answers 200.
 *
 * @param steps The `server` functions, outermost first.
 * @param request The request.
 * @param handlerType How Start handles the request.
 * @returns The status, and the body the handler read (null when it did not run).
 */
async function run(
	steps: readonly (Step | undefined)[],
	request: Request,
	handlerType: HandlerType = 'serverFn',
): Promise<{ status: number; read: string | null }> {
	let read: string | null = null;
	const { pathname } = new URL(request.url);
	const step = async (index: number): Promise<StepResult> => {
		if (index === steps.length) {
			read = await request.text();
			return { response: new Response('ok', { status: OK }) };
		}
		const current = steps[index];
		if (current === undefined) return step(index + 1);
		const result = await current({
			context: undefined,
			handlerType,
			next: async () => step(index + 1),
			pathname,
			request,
		});
		return result instanceof Response ? { response: result } : result;
	};
	const { response } = await step(0);
	return { read, status: response.status };
}

const limitStep = asStep(formBodyLimit.options.server);

/** Headers of a same-origin call, which the CSRF check of the app passes. */
const SAME_ORIGIN = { origin: APP_ORIGIN, 'sec-fetch-site': 'same-origin' };

/** A body one byte above the limit of the app. */
const TOO_LARGE = 'x'.repeat(MAX_FORM_BODY_BYTES + 1);

describe(exceedsBodyLimit, () => {
	it('refuses a declared length above the limit or one that is no number', async () => {
		const declaredLarge = formPost('x', { 'content-length': '11' });
		const declaredNonsense = formPost('x', { 'content-length': 'many' });
		await expect(exceedsBodyLimit(declaredLarge, LIMIT)).resolves.toBe(true);
		await expect(exceedsBodyLimit(declaredNonsense, LIMIT)).resolves.toBe(true);
	});

	it('counts a body without declared length', async () => {
		const above = formPost(chunks([4, 4, 3]));
		const within = formPost(chunks([4, 4, 2]));
		await expect(exceedsBodyLimit(above, LIMIT)).resolves.toBe(true);
		await expect(exceedsBodyLimit(within, LIMIT)).resolves.toBe(false);
	});

	it('counts the body even when the declared length is small', async () => {
		const request = formPost(chunks([6, 6]), { 'content-length': '5' });
		await expect(exceedsBodyLimit(request, LIMIT)).resolves.toBe(true);
	});

	it('passes a request without body', async () => {
		await expect(exceedsBodyLimit(new Request(SERVER_FN_URL), LIMIT)).resolves.toBe(false);
	});
});

describe('the form body limit', () => {
	it('answers 413 to form data above the limit, before the handler reads it', async () => {
		await expect(run([limitStep], formPost(TOO_LARGE))).resolves.toStrictEqual({
			read: null,
			status: PAYLOAD_TOO_LARGE,
		});
	});

	it('leaves a body within the limit readable for the handler', async () => {
		const body = 'x'.repeat(LIMIT);
		await expect(run([limitStep], formPost(body))).resolves.toStrictEqual({
			read: body,
			status: OK,
		});
	});

	it('leaves JSON calls and page requests alone', async () => {
		const json = new Request(SERVER_FN_URL, {
			body: TOO_LARGE,
			headers: { 'content-type': 'application/json' },
			method: 'POST',
		});
		await expect(run([limitStep], json)).resolves.toMatchObject({ status: OK });
		await expect(run([limitStep], formPost(TOO_LARGE), 'router')).resolves.toMatchObject({
			status: OK,
		});
	});
});

describe('the body limit of the app', () => {
	it('leaves room for the largest import payload and stays under Vercel’s 4.5 MB', () => {
		expect(MAX_FORM_BODY_BYTES).toBeGreaterThan(MAX_COMPRESSED_PAYLOAD_BYTES);
		expect(MAX_FORM_BODY_BYTES).toBeLessThanOrEqual(4_500_000);
	});

	it('refuses form data above it in the request middlewares of the app', async () => {
		const { requestMiddleware = [] } = await startInstance.getOptions();
		const steps = requestMiddleware.map((middleware) => asStep(middleware.options.server));
		const request = formPost('x', {
			...SAME_ORIGIN,
			'content-length': String(MAX_FORM_BODY_BYTES + 1),
		});
		await expect(run(steps, request)).resolves.toStrictEqual({
			read: null,
			status: PAYLOAD_TOO_LARGE,
		});
	});

	it('passes form data within it to the handler', async () => {
		const { requestMiddleware = [] } = await startInstance.getOptions();
		const steps = requestMiddleware.map((middleware) => asStep(middleware.options.server));
		await expect(run(steps, formPost('payload', SAME_ORIGIN))).resolves.toStrictEqual({
			read: 'payload',
			status: OK,
		});
	});
});
