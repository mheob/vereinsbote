import { describe, expect, it } from 'vite-plus/test';

import { JPEG_QUALITY, chooseOutputType, fitWidth, formatBytes } from './image-size';

describe(fitWidth, () => {
	it('scales a wide image down and keeps the proportions', () => {
		expect(fitWidth({ height: 3000, width: 4000 }, 1200)).toStrictEqual({
			height: 900,
			width: 1200,
		});
	});

	it('never enlarges an image', () => {
		expect(fitWidth({ height: 600, width: 800 }, 1200)).toStrictEqual({ height: 600, width: 800 });
	});

	it('keeps an image of exactly the maximum width', () => {
		expect(fitWidth({ height: 10, width: 1200 }, 1200)).toStrictEqual({ height: 10, width: 1200 });
	});

	it('never rounds a height down to zero', () => {
		expect(fitWidth({ height: 1, width: 100_000 }, 1200)).toStrictEqual({ height: 1, width: 1200 });
	});
});

describe(chooseOutputType, () => {
	it('keeps transparency as PNG', () => {
		expect(chooseOutputType(true)).toBe('image/png');
	});

	it('uses JPEG for an opaque image', () => {
		expect(chooseOutputType(false)).toBe('image/jpeg');
	});
});

describe('the JPEG quality', () => {
	it('is 0.85', () => {
		expect(JPEG_QUALITY).toBe(0.85);
	});
});

describe(formatBytes, () => {
	it('names bytes, kilobytes and megabytes in the language', () => {
		expect(formatBytes(512, 'de')).toBe('512 B');
		expect(formatBytes(2048, 'de')).toBe('2 KB');
		expect(formatBytes(20 * 1_048_576 + 524_288, 'de')).toBe('20,5 MB');
		expect(formatBytes(1_572_864, 'en')).toBe('1.5 MB');
	});
});
