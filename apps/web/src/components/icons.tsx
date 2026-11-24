import type { ReactNode } from 'react';

/**
 * The arrow of a select: decoration, the select announces itself.
 *
 * @returns The icon.
 */
export function ChevronIcon(): ReactNode {
	return (
		<svg aria-hidden="true" className="size-4 shrink-0" fill="none" viewBox="0 0 16 16">
			<path d="m4 6 4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
		</svg>
	);
}

/**
 * The mark of a selected checkbox: decoration, the checkbox announces its state.
 *
 * @returns The icon.
 */
export function CheckIcon(): ReactNode {
	return (
		<svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16">
			<path
				d="m3 8.5 3.5 3.5L13 4.5"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="2.5"
			/>
		</svg>
	);
}
