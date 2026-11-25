/* oxlint-disable typescript/prefer-readonly-parameter-types -- the nodes of the HTML tree and the counters of a scan are mutable by design */
/*
 * What an import tells the user besides "done": what it removed, what classic Outlook ignores and
 * what a good mail does differently (Design 22). A finding is a warning; only a refusal stops an
 * import. This file collects them while the cleaning runs and reads the structure of the cleaned
 * tree for the rest.
 */
import type { Element, Nodes, Root } from 'hast';

import { compareCodePoints } from '@/server/compare-code-points';

import type { CssReport } from './css';
import { hasToken } from './placeholders';

/** What the cleaning removed. */
type RemovedWhat =
	| 'script'
	| 'form'
	| 'frame'
	| 'object'
	| 'base'
	| 'metaRefresh'
	| 'eventHandler'
	| 'unsafeUrl'
	| 'unsafeCss'
	| 'comment';

type ImportFinding =
	| { readonly kind: 'removed'; readonly what: RemovedWhat; readonly count: number }
	| { readonly kind: 'outlookCss'; readonly property: string; readonly count: number }
	| { readonly kind: 'altMissing'; readonly count: number }
	| { readonly kind: 'tablePresentation'; readonly count: number }
	| { readonly kind: 'vagueLink'; readonly text: string }
	| { readonly kind: 'headingOrder'; readonly level: number }
	| { readonly kind: 'externalImage'; readonly host: string }
	| { readonly kind: 'clipped'; readonly bytes: number }
	| { readonly kind: 'langAdded' };

/** The collector the cleaning writes to; it is the CSS report too. */
interface FindingsCollector extends Omit<CssReport, 'mediaUrl'> {
	/** Something was removed. */
	readonly remove: (what: RemovedWhat, count?: number) => void;
	/** An image from another host. */
	readonly externalImage: (host: string) => void;
	/** The language was missing and is set. */
	readonly addedLang: () => void;
	/** All findings, in a fixed order, each kind once per subject. */
	readonly collect: () => ImportFinding[];
}

/** Link texts that say nothing out of context. */
const VAGUE_LINK_TEXTS: ReadonlySet<string> = new Set([
	'click here',
	'here',
	'hier',
	'hier klicken',
	'klicke hier',
	'klicken sie hier',
	'klick hier',
	'link',
	'mehr',
	'mehr erfahren',
	'mehr lesen',
	'more',
	'read more',
	'weiterlesen',
]);
const WHITESPACE = /\s+/gu;
const HEADING = /^h(?<level>[1-6])$/u;
const REMOVED_ORDER: readonly RemovedWhat[] = [
	'script',
	'form',
	'frame',
	'object',
	'base',
	'metaRefresh',
	'eventHandler',
	'unsafeUrl',
	'unsafeCss',
	'comment',
];

/**
 * Counts how often each name was seen.
 *
 * @param counts The counts.
 * @param name The name.
 */
function bump(counts: Map<string, number>, name: string): void {
	counts.set(name, (counts.get(name) ?? 0) + 1);
}

/**
 * Starts the findings of an import.
 *
 * @returns The collector.
 */
function createFindings(): FindingsCollector {
	const removed = new Map<RemovedWhat, number>();
	const outlook = new Map<string, number>();
	const hosts = new Set<string>();
	let langAdded = false;
	const remove = (what: RemovedWhat, count = 1): void => {
		removed.set(what, (removed.get(what) ?? 0) + count);
	};
	return {
		addedLang: () => {
			langAdded = true;
		},
		collect: () => [
			...REMOVED_ORDER.flatMap((what): ImportFinding[] => {
				const count = removed.get(what);
				return count === undefined ? [] : [{ count, kind: 'removed', what }];
			}),
			...[...outlook]
				.toSorted(([a], [b]) => compareCodePoints(a, b))
				.map(([property, count]): ImportFinding => ({ count, kind: 'outlookCss', property })),
			...[...hosts]
				.toSorted(compareCodePoints)
				.map((host): ImportFinding => ({ host, kind: 'externalImage' })),
			...(langAdded ? [{ kind: 'langAdded' } as const] : []),
		],
		externalHost: (host) => {
			hosts.add(host);
		},
		externalImage: (host) => {
			hosts.add(host);
		},
		outlook: (name) => {
			bump(outlook, name);
		},
		remove,
		removed: () => {
			remove('unsafeCss');
		},
	};
}

/**
 * The text of a node, white space collapsed.
 *
 * @param node The node.
 * @returns The text, lower case.
 */
function textOf(node: Nodes): string {
	if (node.type === 'text') return node.value;
	return 'children' in node ? node.children.map((child) => textOf(child)).join('') : '';
}

/** What the structure scan found. */
interface Structure {
	altMissing: number;
	tablePresentation: number;
	vagueLinks: Set<string>;
	headingOrder: Set<number>;
}

/**
 * Reads one element for the structure findings.
 *
 * @param element The element.
 * @param structure What was found so far.
 * @param headings The previous heading level, in an object so the scan can update it.
 * @param headings.level The level.
 */
function scanElement(element: Element, structure: Structure, headings: { level: number }): void {
	const { properties, tagName } = element;
	if (tagName === 'img' && properties.alt === undefined) structure.altMissing += 1;
	if (tagName === 'table' && properties.role !== 'presentation') structure.tablePresentation += 1;
	if (tagName === 'a') {
		const text = textOf(element).replaceAll(WHITESPACE, ' ').trim().toLowerCase();
		if (!hasToken(text) && VAGUE_LINK_TEXTS.has(text)) structure.vagueLinks.add(text);
	}
	const level = Number(HEADING.exec(tagName)?.groups?.level ?? 0);
	if (level > 0) {
		if (headings.level > 0 && level > headings.level + 1) structure.headingOrder.add(level);
		headings.level = level;
	}
}

/**
 * Walks the cleaned tree in document order.
 *
 * @param node The node.
 * @param structure What was found so far.
 * @param headings The previous heading level.
 * @param headings.level The level.
 */
function scan(node: Nodes, structure: Structure, headings: { level: number }): void {
	if (node.type === 'element') scanElement(node, structure, headings);
	if ('children' in node) for (const child of node.children) scan(child, structure, headings);
}

/**
 * The findings the cleaned tree shows: images without `alt`, tables without a presentation role,
 * links that say nothing and headings that skip a level.
 *
 * @param root The cleaned tree.
 * @returns The findings.
 */
function structureFindings(root: Root): ImportFinding[] {
	const structure: Structure = {
		altMissing: 0,
		headingOrder: new Set(),
		tablePresentation: 0,
		vagueLinks: new Set(),
	};
	scan(root, structure, { level: 0 });
	return [
		...(structure.altMissing > 0
			? [{ count: structure.altMissing, kind: 'altMissing' } as const]
			: []),
		...(structure.tablePresentation > 0
			? [{ count: structure.tablePresentation, kind: 'tablePresentation' } as const]
			: []),
		...[...structure.vagueLinks]
			.toSorted(compareCodePoints)
			.map((text): ImportFinding => ({ kind: 'vagueLink', text })),
		...[...structure.headingOrder]
			.toSorted((a, b) => a - b)
			.map((level): ImportFinding => ({ kind: 'headingOrder', level })),
	];
}

export { createFindings, structureFindings };
export type { FindingsCollector, ImportFinding, RemovedWhat };
