/*
 * WCAG contrast of the colours of the brand. Pure: runs in the browser form and on the server.
 */
import type { Brand } from './brand-schema';

/** The WCAG AA threshold for normal text. */
const MIN_RATIO = 4.5;

const BLACK = '#000000';
const WHITE = '#ffffff';
const HEX_RADIX = 16;
const CHANNEL_LOW_LIMIT = 0.03928;
const CHANNEL_LOW_DIVISOR = 12.92;
const CHANNEL_OFFSET = 0.055;
const CHANNEL_SCALE = 1.055;
const CHANNEL_EXPONENT = 2.4;
const LUMINANCE_RED = 0.2126;
const LUMINANCE_GREEN = 0.7152;
const LUMINANCE_BLUE = 0.0722;
const FLARE = 0.05;
const MAX_CHANNEL = 255;

type Pair = 'textOnBackground' | 'linkOnBackground' | 'buttonText' | 'footerText';

interface ContrastFinding {
	readonly pair: Pair;
	readonly ratio: number;
}

function channel(hex: string, start: number): number {
	const value = Number.parseInt(hex.slice(start, start + 2), HEX_RADIX) / MAX_CHANNEL;
	return value <= CHANNEL_LOW_LIMIT
		? value / CHANNEL_LOW_DIVISOR
		: ((value + CHANNEL_OFFSET) / CHANNEL_SCALE) ** CHANNEL_EXPONENT;
}

function luminance(hex: string): number {
	return (
		LUMINANCE_RED * channel(hex, 1) +
		LUMINANCE_GREEN * channel(hex, 3) +
		LUMINANCE_BLUE * channel(hex, 5)
	);
}

/**
 * The WCAG contrast ratio of two colours.
 *
 * @param a A `#rrggbb` colour.
 * @param b A `#rrggbb` colour.
 * @returns The ratio, from 1 (equal) to 21 (black on white), the same in both directions.
 */
function contrastRatio(a: string, b: string): number {
	const first = luminance(a);
	const second = luminance(b);
	return (Math.max(first, second) + FLARE) / (Math.min(first, second) + FLARE);
}

/**
 * Black or white, whichever reads better on a background.
 *
 * @param background A `#rrggbb` colour.
 * @returns `#000000` or `#ffffff`.
 */
function readableTextOn(background: string): '#000000' | '#ffffff' {
	return contrastRatio(BLACK, background) >= contrastRatio(WHITE, background) ? BLACK : WHITE;
}

/**
 * The colour pairs of the default layout that fall below 4.5:1. Button text is the readable text
 * on the primary colour, footer text the readable text on the secondary colour.
 *
 * @param colors The colours of the brand.
 * @returns The weak pairs with their ratio; empty when all pass.
 */
function contrastFindings(colors: Readonly<Brand['colors']>): ContrastFinding[] {
	const pairs: [Pair, number][] = [
		['textOnBackground', contrastRatio(colors.text, colors.background)],
		['linkOnBackground', contrastRatio(colors.link, colors.background)],
		['buttonText', contrastRatio(readableTextOn(colors.primary), colors.primary)],
		['footerText', contrastRatio(readableTextOn(colors.secondary), colors.secondary)],
	];
	return pairs.filter(([, ratio]) => ratio < MIN_RATIO).map(([pair, ratio]) => ({ pair, ratio }));
}

export { contrastFindings, contrastRatio, MIN_RATIO, readableTextOn };
export type { ContrastFinding };
