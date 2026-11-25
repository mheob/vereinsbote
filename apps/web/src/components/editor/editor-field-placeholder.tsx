import type { ReactNode } from 'react';

/**
 * What stands in the place of a Tiptap field until the editor has loaded in the browser: the
 * label and an empty area of the same look, so the page does not jump. (Tiptap is a browser
 * library, it never loads on the server, see `text-block-editor.tsx`.)
 *
 * @param props The props.
 * @param props.label The visible label of the field.
 * @param props.multiline Whether the field has several lines (a text block) or one.
 * @returns The placeholder.
 */
export function EditorFieldPlaceholder({
	label,
	multiline,
}: Readonly<{ label: string; multiline: boolean }>): ReactNode {
	return (
		<div className="flex flex-col gap-1">
			<span className="font-semibold">{label}</span>
			<div className="flex items-start gap-2">
				<div
					aria-hidden="true"
					className={`min-w-0 flex-1 rounded-md border border-gray-600 bg-white px-3 py-2 ${multiline ? 'min-h-24' : 'min-h-10.5'}`}
				/>
			</div>
		</div>
	);
}
