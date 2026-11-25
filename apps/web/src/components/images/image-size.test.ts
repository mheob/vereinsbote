import { describe, expect, it } from 'vite-plus/test';

import { JPEG_QUALITY, chooseOutputType, fitWidth, formatBytes, svgRasterSize } from './image-size';

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

describe(svgRasterSize, () => {
	it('draws a small logo at 480 px, twice the width of the header logo, in its proportions', () => {
		expect(svgRasterSize({ height: 96, width: 240 })).toStrictEqual({ height: 192, width: 480 });
		expect(svgRasterSize({ height: 24, width: 60 })).toStrictEqual({ height: 192, width: 480 });
	});

	it('uses the proportions the browser gives an SVG with a viewBox only (300 px wide)', () => {
		expect(svgRasterSize({ height: 120, width: 300 })).toStrictEqual({ height: 192, width: 480 });
	});

	it('keeps a wider logo at its own width, up to 1200 px', () => {
		expect(svgRasterSize({ height: 200, width: 800 })).toStrictEqual({ height: 200, width: 800 });
		expect(svgRasterSize({ height: 1000, width: 3000 })).toStrictEqual({
			height: 400,
			width: 1200,
		});
	});

	it('never rounds a height down to zero', () => {
		expect(svgRasterSize({ height: 1, width: 100_000 })).toStrictEqual({ height: 1, width: 1200 });
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
