import { describe, expect, it } from 'vite-plus/test';

import { mediaFileName, mediaPath, newMediaId, parseMediaFileName } from './ids';

describe('media ids', () => {
	it('makes 22 characters of base64url that never repeat', () => {
		const ids = new Set<string>();
		for (let index = 0; index < 1000; index += 1) {
			const id = newMediaId();
			expect(id).toMatch(/^[\w-]{22}$/u);
			ids.add(id);
		}
		expect(ids.size).toBe(1000);
	});

	it('names files and paths by type', () => {
		const id = newMediaId();
		expect(mediaFileName(id, 'jpeg')).toBe(`${id}.jpg`);
		expect(mediaFileName(id, 'png')).toBe(`${id}.png`);
		expect(mediaPath(id, 'png')).toBe(`/media/${id}.png`);
	});

	it('reads back what it wrote', () => {
		const id = newMediaId();
		expect(parseMediaFileName(`${id}.jpg`)).toStrictEqual({ id, type: 'jpeg' });
		expect(parseMediaFileName(`${id}.png`)).toStrictEqual({ id, type: 'png' });
	});

	it('refuses anything else', () => {
		const id = newMediaId();
		expect(parseMediaFileName('x.gif')).toBeNull();
		expect(parseMediaFileName('../a.png')).toBeNull();
		expect(parseMediaFileName(`${id}.png.png`)).toBeNull();
		expect(parseMediaFileName(`${id}.jpeg`)).toBeNull();
		expect(parseMediaFileName(`${id}x.png`)).toBeNull();
	});
});
