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

/**
 * The cross of a remove button: decoration, the button names itself.
 *
 * @returns The icon.
 */
export function CloseIcon(): ReactNode {
	return (
		<svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16">
			<path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
		</svg>
	);
}

/**
 * The grip of a drag handle: decoration, the handle names itself.
 *
 * @returns The icon.
 */
export function DragIcon(): ReactNode {
	return (
		<svg aria-hidden="true" className="size-4 shrink-0" fill="currentColor" viewBox="0 0 16 16">
			<circle cx="5.5" cy="3.5" r="1.5" />
			<circle cx="10.5" cy="3.5" r="1.5" />
			<circle cx="5.5" cy="8" r="1.5" />
			<circle cx="10.5" cy="8" r="1.5" />
			<circle cx="5.5" cy="12.5" r="1.5" />
			<circle cx="10.5" cy="12.5" r="1.5" />
		</svg>
	);
}

/**
 * The dots of a menu button: decoration, the button names itself.
 *
 * @returns The icon.
 */
export function MoreIcon(): ReactNode {
	return (
		<svg aria-hidden="true" className="size-4 shrink-0" fill="currentColor" viewBox="0 0 16 16">
			<circle cx="3" cy="8" r="1.5" />
			<circle cx="8" cy="8" r="1.5" />
			<circle cx="13" cy="8" r="1.5" />
		</svg>
	);
}
