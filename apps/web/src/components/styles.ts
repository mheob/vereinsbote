/*
 * Class lists of the links and form controls the pages share. Focus rings use `data-focus-visible`
 * (React Aria) or `data-focused` for text inputs; borders are dark enough for 3:1 contrast.
 */

export const linkClass =
	'font-semibold text-blue-700 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

export const inputClass =
	'rounded-md border border-gray-600 px-3 py-2 data-focused:outline-2 data-focused:outline-offset-2 data-focused:outline-blue-700 data-invalid:border-red-700';

export const secondaryButtonClass =
	'rounded-md border border-gray-600 px-3 py-1.5 font-semibold data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-hovered:bg-gray-100 data-pending:opacity-70';

export const dangerButtonClass =
	'rounded-md bg-red-700 px-3 py-1.5 font-semibold text-white data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-red-700 data-hovered:bg-red-800 data-pending:opacity-70';

export const selectButtonClass =
	'flex w-full items-center justify-between gap-2 rounded-md border border-gray-600 bg-white px-3 py-1.5 text-left data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-pressed:bg-gray-100';

export const popoverClass =
	'min-w-(--trigger-width) rounded-md border border-gray-600 bg-white py-1 shadow-lg';

export const optionClass =
	'cursor-default px-3 py-1.5 outline-none data-focused:bg-blue-700 data-focused:text-white data-selected:font-semibold';

export const checkboxClass = 'group flex items-center gap-2';

export const checkboxBoxClass =
	'flex size-5 items-center justify-center rounded border-2 border-gray-600 text-white group-data-focus-visible:outline-2 group-data-focus-visible:outline-offset-2 group-data-focus-visible:outline-blue-700 group-data-selected:border-blue-700 group-data-selected:bg-blue-700';

export const primaryButtonClass =
	'rounded-md bg-blue-700 px-4 py-2 font-semibold text-white data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-hovered:bg-blue-800 data-pending:opacity-70';

export const segmentedButtonClass =
	'border border-gray-600 px-3 py-1.5 font-semibold first:rounded-l-md last:rounded-r-md data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-hovered:bg-gray-100 data-selected:border-blue-700 data-selected:bg-blue-700 data-selected:text-white';
