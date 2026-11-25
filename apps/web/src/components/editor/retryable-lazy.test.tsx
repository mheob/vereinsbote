import type { ComponentType, ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it, vi } from 'vite-plus/test';

import { retryableLazy } from './retryable-lazy';

/**
 * Renders on the server and waits for every lazy component, as the browser would.
 *
 * @param node What to render.
 * @returns The HTML.
 */
async function rendered(node: ReactNode): Promise<string> {
	// A failed load rejects the render; React reports it here instead of printing it.
	const reported: unknown[] = [];
	const { prelude } = await prerender(node, {
		onError: (error) => {
			reported.push(error);
		},
	});
	return new Response(prelude).text();
}

function Field({ label }: Readonly<{ label: string }>): ReactNode {
	return <p>{label}</p>;
}

/** The load of the field's module. */
type Load = () => Promise<ComponentType<{ label: string }>>;

describe(retryableLazy, () => {
	it('renders the component once it has loaded', async () => {
		const load = vi.fn<Load>().mockResolvedValue(Field);
		const field = retryableLazy(load);
		const Loaded = field.current();
		await expect(rendered(<Loaded label="Betreff" />)).resolves.toBe('<p>Betreff</p>');
		expect(load).toHaveBeenCalledOnce();
	});

	it('loads again after a failed load when asked to', async () => {
		const load = vi.fn<Load>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Field);
		const field = retryableLazy(load);
		const First = field.current();
		await expect(rendered(<First label="Betreff" />)).rejects.toThrow('offline');
		// React keeps a failed lazy component failed: only a new one loads again.
		field.retry();
		const Second = field.current();
		expect(Second).not.toBe(First);
		await expect(rendered(<Second label="Betreff" />)).resolves.toBe('<p>Betreff</p>');
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('keeps a component that loaded, so another field does not load it again', async () => {
		const load = vi.fn<Load>().mockResolvedValue(Field);
		const field = retryableLazy(load);
		const Loaded = field.current();
		await rendered(<Loaded label="Betreff" />);
		field.retry();
		expect(field.current()).toBe(Loaded);
		await expect(rendered(<Loaded label="Vorschautext" />)).resolves.toBe('<p>Vorschautext</p>');
		expect(load).toHaveBeenCalledOnce();
	});

	it('keeps a component whose load runs, so a second retry does not start another', async () => {
		const running = Promise.withResolvers<ComponentType<{ label: string }>>();
		const load = vi
			.fn<Load>()
			.mockRejectedValueOnce(new Error('offline'))
			.mockImplementationOnce(async () => running.promise);
		const field = retryableLazy(load);
		const First = field.current();
		await expect(rendered(<First label="Betreff" />)).rejects.toThrow('offline');
		field.retry();
		const Second = field.current();
		const html = rendered(<Second label="Betreff" />);
		await vi.waitFor(() => {
			expect(load).toHaveBeenCalledTimes(2);
		});
		// The other field's retry while the new load runs.
		field.retry();
		expect(field.current()).toBe(Second);
		running.resolve(Field);
		await expect(html).resolves.toBe('<p>Betreff</p>');
		expect(load).toHaveBeenCalledTimes(2);
	});
});
