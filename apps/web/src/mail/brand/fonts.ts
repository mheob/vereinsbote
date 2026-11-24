/*
 * The font stacks of the brand: a fixed list of stacks mail clients have, and an optional wish
 * font in front of them. Nothing is ever loaded.
 */
import type { FontStackId } from './brand-schema';

const STACKS: Readonly<Record<FontStackId, string>> = {
	arial: 'Arial, Helvetica, sans-serif',
	georgia: 'Georgia, "Times New Roman", serif',
	tahoma: 'Tahoma, Geneva, sans-serif',
	times: '"Times New Roman", Times, serif',
	trebuchet: '"Trebuchet MS", Helvetica, sans-serif',
	verdana: 'Verdana, Geneva, sans-serif',
};

/**
 * The CSS `font-family` value.
 *
 * @param stack The stack.
 * @param wish A wish font that passed the brand schema (letters, digits, spaces, hyphens), or null.
 * @returns The value, e.g. `"Open Sans", Arial, Helvetica, sans-serif`.
 */
function fontFamilyCss(stack: FontStackId, wish: string | null): string {
	return wish === null ? STACKS[stack] : `"${wish}", ${STACKS[stack]}`;
}

export { fontFamilyCss };
