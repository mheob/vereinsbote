import { describe, expect, it, vi } from 'vite-plus/test';

import { processImage } from './process-image';
import type { DecodedImage, ImageDeps } from './process-image';

type Overrides = Partial<Omit<DecodedImage, 'encode'>>;

function fakeDeps(
	overrides: Overrides = {},
	encoded: Blob = new Blob(['x'.repeat(100)]),
): { deps: ImageDeps; encode: ReturnType<typeof vi.fn<DecodedImage['encode']>> } {
	const encode = vi.fn<DecodedImage['encode']>().mockResolvedValue(encoded);
	const image: DecodedImage = {
		animated: false,
		encode,
		hasAlpha: false,
		height: 3024,
		isSvg: false,
		width: 4032,
		...overrides,
	};
	return { deps: { decode: vi.fn().mockResolvedValue(image) }, encode };
}

function file(name: string, type = 'image/jpeg', size = 10): File {
	return new File(['x'.repeat(size)], name, { type });
}

describe(processImage, () => {
	it('turns a large photo into a JPEG of at most 1200 px', async () => {
		const { deps, encode } = fakeDeps();
		const result = await processImage(file('urlaub.heic'), { allowSvg: false }, deps);
		expect(encode).toHaveBeenCalledWith('image/jpeg', 0.85, 1200, 900);
		expect(result).toMatchObject({
			after: 100,
			before: 10,
			flattenedGif: false,
			height: 900,
			name: 'urlaub.jpg',
			ok: true,
			width: 1200,
		});
	});

	it('keeps transparency as PNG', async () => {
		const { deps, encode } = fakeDeps({ hasAlpha: true, height: 100, width: 200 });
		const result = await processImage(file('logo.png', 'image/png'), { allowSvg: false }, deps);
		expect(encode).toHaveBeenCalledWith('image/png', 0.85, 200, 100);
		expect(result).toMatchObject({ name: 'logo.png', ok: true });
	});

	it('names a file without extension and with several dots', async () => {
		const { deps } = fakeDeps();
		await expect(processImage(file('Foto'), { allowSvg: false }, deps)).resolves.toMatchObject({
			name: 'Foto.jpg',
		});
		await expect(processImage(file('a.b.png'), { allowSvg: false }, deps)).resolves.toMatchObject({
			name: 'a.b.jpg',
		});
		await expect(processImage(file('.jpeg'), { allowSvg: false }, deps)).resolves.toMatchObject({
			name: 'image.jpg',
		});
	});

	it('refuses SVG unless allowed', async () => {
		const svg = { hasAlpha: true, isSvg: true };
		const refused = fakeDeps(svg);
		await expect(
			processImage(file('logo.svg', 'image/svg+xml'), { allowSvg: false }, refused.deps),
		).resolves.toStrictEqual({ ok: false, reason: 'svgNotAllowed' });
		expect(refused.encode).not.toHaveBeenCalled();
		const allowed = fakeDeps(svg);
		await expect(
			processImage(file('logo.svg', 'image/svg+xml'), { allowSvg: true }, allowed.deps),
		).resolves.toMatchObject({ name: 'logo.png', ok: true });
		expect(allowed.encode).toHaveBeenCalledWith('image/png', 0.85, 1200, 900);
	});

	it('refuses an image taller than 4000 px after resizing', async () => {
		const { deps, encode } = fakeDeps({ height: 10_000, width: 1 });
		await expect(
			processImage(file('banner.png'), { allowSvg: false }, deps),
		).resolves.toStrictEqual({
			ok: false,
			reason: 'tooTall',
		});
		expect(encode).not.toHaveBeenCalled();
	});

	it('refuses a result larger than 2 MB', async () => {
		const { deps } = fakeDeps({}, new Blob([new Uint8Array(2 * 1_048_576 + 1)]));
		await expect(processImage(file('big.jpg'), { allowSvg: false }, deps)).resolves.toStrictEqual({
			ok: false,
			reason: 'tooLarge',
		});
	});

	it('flattens an animated GIF and says so', async () => {
		const { deps } = fakeDeps({ animated: true, height: 100, width: 100 });
		await expect(
			processImage(file('tanz.gif', 'image/gif'), { allowSvg: false }, deps),
		).resolves.toMatchObject({
			flattenedGif: true,
			name: 'tanz.jpg',
			ok: true,
		});
	});

	it('reports a file that cannot be decoded', async () => {
		const deps: ImageDeps = { decode: vi.fn().mockResolvedValue(null) };
		await expect(processImage(file('x.png'), { allowSvg: false }, deps)).resolves.toStrictEqual({
			ok: false,
			reason: 'unreadable',
		});
	});

	it('reports an image of no size or a failing encoder as unreadable', async () => {
		await expect(
			processImage(file('x.png'), { allowSvg: false }, fakeDeps({ width: 0 }).deps),
		).resolves.toStrictEqual({ ok: false, reason: 'unreadable' });
		const failing = fakeDeps();
		failing.encode.mockRejectedValue(new Error('canvas'));
		await expect(
			processImage(file('x.png'), { allowSvg: false }, failing.deps),
		).resolves.toStrictEqual({
			ok: false,
			reason: 'unreadable',
		});
	});
});
