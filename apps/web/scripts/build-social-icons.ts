/* oxlint-disable no-magic-numbers -- the numbers are the specification of the PNG format */
/* oxlint-disable typescript/prefer-readonly-parameter-types -- Playwright's page and Node's buffers are mutable handles */
/*
 * Makes the social icons of the mail footer: every platform of `SOCIAL_PLATFORMS` in three
 * variants (`dark`, `light`, `brand`) as 48 x 48 px PNG in `public/social`. The icons come from
 * `simple-icons` (CC0) and are rasterized with Playwright's Chromium (a canvas gives the coverage
 * of every pixel). An icon has one colour, so the file is an indexed PNG whose palette steps the
 * opacity in `ALPHA_LEVELS` levels; that keeps each file well under 2 KB. Run by hand with
 * `vp run --filter web icons:social` after `simple-icons` or the platform list changed, and commit
 * the files; they are product assets.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { crc32, deflate } from 'node:zlib';

import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
	siBluesky,
	siFacebook,
	siInstagram,
	siMastodon,
	siThreads,
	siTiktok,
	siWhatsapp,
	siX,
	siYoutube,
} from 'simple-icons';
import type { SimpleIcon } from 'simple-icons';

import { ICON_VARIANTS, SOCIAL_PLATFORMS } from '@/mail/brand/brand-schema';
import type { IconVariant, SocialPlatform } from '@/mail/brand/brand-schema';

const SIZE = 48;
const OUT_DIR = path.join(import.meta.dirname, '..', 'public', 'social');
const FIXED_COLORS = { dark: '#1f2937', light: '#ffffff' } as const;
const ALPHA_LEVELS = 32;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const COLOR_TYPE_INDEXED = 3;
const BIT_DEPTH = 8;
const BYTE = 255;
const HEX_RADIX = 16;

/** A platform missing here is a type error, a platform missing from `simple-icons` an import error. */
const ICONS: Readonly<Record<SocialPlatform, SimpleIcon>> = {
	bluesky: siBluesky,
	facebook: siFacebook,
	instagram: siInstagram,
	mastodon: siMastodon,
	threads: siThreads,
	tiktok: siTiktok,
	whatsapp: siWhatsapp,
	x: siX,
	youtube: siYoutube,
};

const deflateAsync = promisify(deflate);

function colorOf(icon: Readonly<SimpleIcon>, variant: IconVariant): string {
	return variant === 'brand' ? `#${icon.hex}` : FIXED_COLORS[variant];
}

function svgOf(icon: Readonly<SimpleIcon>): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${SIZE}" height="${SIZE}"><path fill="#000000" d="${icon.path}"/></svg>`;
}

/**
 * One PNG chunk: length, type, data and CRC.
 *
 * @param type The four-letter type.
 * @param data The data.
 * @returns The chunk.
 */
function chunk(type: string, data: Readonly<Uint8Array>): Buffer {
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, checksum]);
}

/**
 * The palette index of every pixel, a filter byte (0, none) in front of each row.
 *
 * @param coverage The opacity (0 to 255) of every pixel, row by row.
 * @returns The raw image data.
 */
function indexedRows(coverage: readonly number[]): Buffer {
	const rows = Buffer.alloc(SIZE * (SIZE + 1));
	for (let y = 0; y < SIZE; y += 1) {
		for (let x = 0; x < SIZE; x += 1) {
			const opacity = coverage[y * SIZE + x] ?? 0;
			rows[y * (SIZE + 1) + 1 + x] = Math.round((opacity * (ALPHA_LEVELS - 1)) / BYTE);
		}
	}
	return rows;
}

function imageHeader(): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(SIZE, 0);
	header.writeUInt32BE(SIZE, 4);
	header[8] = BIT_DEPTH;
	header[9] = COLOR_TYPE_INDEXED;
	return header;
}

/**
 * An indexed PNG of one colour.
 *
 * @param color The `#rrggbb` colour.
 * @param coverage The opacity (0 to 255) of every pixel, row by row.
 * @returns The file.
 */
async function encodePng(color: string, coverage: readonly number[]): Promise<Buffer> {
	const rgb = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), HEX_RADIX));
	const levels = Array.from({ length: ALPHA_LEVELS }, (_, level) => level);
	const alpha = levels.map((level) => Math.round((level * BYTE) / (ALPHA_LEVELS - 1)));
	const pixels = await deflateAsync(indexedRows(coverage), { level: 9 });
	const palette = Buffer.from(levels.flatMap(() => rgb));
	return Buffer.concat([
		PNG_SIGNATURE,
		chunk('IHDR', imageHeader()),
		chunk('PLTE', palette),
		chunk('tRNS', Buffer.from(alpha)),
		chunk('IDAT', pixels),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

/**
 * The page draws the icon in black on a canvas; the alpha channel is the coverage.
 *
 * @param page A browser page.
 * @param icon The icon.
 * @returns The opacity (0 to 255) of every pixel, row by row.
 */
async function coverageOf(page: Page, icon: Readonly<SimpleIcon>): Promise<number[]> {
	return page.evaluate(
		// oxlint-disable-next-line max-statements -- one sequence of canvas calls
		async ({ size, source }) => {
			const image = new Image();
			image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			const context = canvas.getContext('2d');
			if (context === null) throw new Error('No 2D canvas.');
			context.drawImage(image, 0, 0, size, size);
			const { data } = context.getImageData(0, 0, size, size);
			return Array.from({ length: size * size }, (_, index) => data[index * 4 + 3] ?? 0);
		},
		{ size: SIZE, source: svgOf(icon) },
	);
}

/**
 * Writes the three variants of a platform.
 *
 * @param page A browser page.
 * @param platform The platform.
 */
async function writePlatform(page: Page, platform: SocialPlatform): Promise<void> {
	const icon = ICONS[platform];
	const coverage = await coverageOf(page, icon);
	await Promise.all(
		ICON_VARIANTS.map(async (variant) => {
			const png = await encodePng(colorOf(icon, variant), coverage);
			await writeFile(path.join(OUT_DIR, `${platform}-${variant}.png`), png);
		}),
	);
}

const browser = await chromium.launch();
try {
	await mkdir(OUT_DIR, { recursive: true });
	// One page per platform: they rasterize one after the other in the browser anyway.
	await Promise.all(
		SOCIAL_PLATFORMS.map(async (platform) => writePlatform(await browser.newPage(), platform)),
	);
} finally {
	await browser.close();
}
