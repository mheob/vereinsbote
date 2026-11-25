/* oxlint-disable no-script-url, typescript/prefer-readonly-parameter-types -- the oracle names the schemes it looks for; hast nodes are mutable */
/*
 * Helpers of the import tests: reading a result without a conditional in the test, and the oracle
 * that reads cleaned HTML the way a browser does and lists what could still run or load something.
 * An empty list is what every import must give.
 */
import type { Nodes } from 'hast';
import { fromHtml } from 'hast-util-from-html';

import type { ImportFinding, ImportRefusal, ImportResult } from './import-html';

type Imported = Extract<ImportResult, { ok: true }>;

/**
 * A result that must be a success.
 *
 * @param result The result.
 * @returns The success.
 * @throws {Error} When the import was refused.
 */
function imported(result: ImportResult): Imported {
	if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.refusals)}`);
	return result;
}

/**
 * The cleaned HTML of a result that must be a success.
 *
 * @param result The result.
 * @returns The HTML.
 */
function htmlOf(result: ImportResult): string {
	return imported(result).html;
}

/**
 * The findings of a result that must be a success.
 *
 * @param result The result.
 * @returns The findings.
 */
function findingsOf(result: ImportResult): readonly ImportFinding[] {
	return imported(result).findings;
}

/**
 * The refusals of a result; none for a success.
 *
 * @param result The result.
 * @returns The refusals.
 */
function refusalsOf(result: ImportResult): readonly ImportRefusal[] {
	return result.ok ? [] : result.refusals;
}

const FORBIDDEN_ELEMENTS: ReadonlySet<string> = new Set([
	'applet',
	'base',
	'embed',
	'form',
	'frame',
	'iframe',
	'input',
	'math',
	'noscript',
	'object',
	'script',
	'svg',
	'template',
]);
const FORBIDDEN_URL_START = ['data:', 'javascript:', 'vbscript:'];
const FORBIDDEN_CSS = ['-moz-binding', '@import', 'behavior', 'expression(', 'javascript:'];
const FORBIDDEN_IN_COMMENT = ['<script', '<iframe', '<object', '<embed', 'javascript:', 'onerror='];
const SPACE = 32;

/**
 * What a browser compares: no white space or control characters, lower case.
 *
 * @param value A URL or CSS text.
 * @returns The text.
 */
function squash(value: string): string {
	let result = '';
	for (const character of value.toLowerCase()) {
		if ((character.codePointAt(0) ?? 0) > SPACE && character.trim() !== '') result += character;
	}
	return result;
}

/**
 * The CSS problems of a text.
 *
 * @param css A style sheet or the declarations of an attribute.
 * @returns The forbidden words in it.
 */
function cssProblems(css: string): string[] {
	const text = squash(css);
	return FORBIDDEN_CSS.filter((word) => text.includes(word)).map((word) => `css:${word}`);
}

/**
 * The problems of one attribute.
 *
 * @param name The property name.
 * @param value Its value.
 * @returns The problems.
 */
function attributeProblems(name: string, value: string): string[] {
	const found: string[] = [];
	if (name.toLowerCase().startsWith('on')) found.push(`attribute:${name}`);
	if (
		(name === 'href' || name === 'src') &&
		FORBIDDEN_URL_START.some((start) => squash(value).startsWith(start))
	) {
		found.push(`url:${value}`);
	}
	return name === 'style' ? [...found, ...cssProblems(value)] : found;
}

/**
 * Lists the dangerous things in one node.
 *
 * @param node The node.
 * @returns The problems of the node itself.
 */
function problemsOf(node: Nodes): string[] {
	if (node.type === 'comment') {
		const value = node.value.toLowerCase();
		return FORBIDDEN_IN_COMMENT.filter((word) => value.includes(word)).map(
			(word) => `comment:${word}`,
		);
	}
	if (node.type !== 'element') return [];
	const attributes = Object.entries(node.properties).flatMap(([name, value]) =>
		attributeProblems(name, Array.isArray(value) ? value.join(' ') : String(value)),
	);
	const styleText = node.children
		.map((child) => (child.type === 'text' ? child.value : ''))
		.join('');
	return [
		...(FORBIDDEN_ELEMENTS.has(node.tagName) ? [`element:${node.tagName}`] : []),
		...attributes,
		...(node.tagName === 'style' ? cssProblems(styleText) : []),
	];
}

/**
 * Lists everything in a cleaned mail that could run code or load something.
 *
 * @param html The cleaned HTML.
 * @returns The problems; empty when the HTML is clean.
 */
function findUnsafe(html: string): string[] {
	const found: string[] = [];
	const visit = (node: Nodes): void => {
		found.push(...problemsOf(node));
		if ('children' in node) for (const child of node.children) visit(child);
	};
	visit(fromHtml(html));
	return found;
}

/**
 * How many comments a document has, as a browser counts them.
 *
 * @param html The HTML.
 * @returns The number of comment nodes.
 */
function commentCount(html: string): number {
	const count = (node: Nodes): number =>
		('children' in node ? node.children.reduce((sum, child) => sum + count(child), 0) : 0) +
		(node.type === 'comment' ? 1 : 0);
	return count(fromHtml(html));
}

export { commentCount, findingsOf, findUnsafe, htmlOf, imported, refusalsOf };
export type { Imported };
