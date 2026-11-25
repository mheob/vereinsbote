/* oxlint-disable typescript/prefer-readonly-parameter-types -- Tiptap's editor and JSON content are mutable handles by design */
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor, Extensions, JSONContent } from '@tiptap/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** The look of the editable area; a refused field gets a red border. */
const contentClass =
	'rounded-md border border-gray-600 bg-white px-3 py-2 focus:outline-2 focus:outline-offset-2 focus:outline-blue-700 aria-invalid:border-red-700 aria-readonly:bg-gray-50';

interface TiptapFieldProps<T> {
	/** The visible label; the editable area is labelled by it. */
	readonly label: string;
	/** The extensions; give the same array while they do not change. */
	readonly extensions: Extensions;
	/** The content as the template stores it. */
	readonly value: T;
	readonly toJson: (value: T) => JSONContent;
	readonly fromJson: (json: JSONContent) => T;
	readonly onChange: (value: T) => void;
	readonly isReadOnly: boolean;
	/** Whether the field has several lines (a text block) or one (a heading). */
	readonly multiline: boolean;
	/** The message of a refusal, shown below the field. */
	readonly error: string | null;
	readonly description: string | null;
	/** Where the editor's problem jump finds the field (`data-problem-focus`). */
	readonly focusKey: string;
	/** Renders what stands above the content, e.g. a toolbar. */
	readonly before?: (editor: Editor) => ReactNode;
	/** Renders what stands beside the content, e.g. the placeholder button. */
	readonly beside?: (editor: Editor) => ReactNode;
	/** Called with the editor once it exists. */
	readonly onEditor?: (editor: Editor) => void;
}

/**
 * The attributes of the editable area: a labelled text box, read-only when the user may not
 * change the template, invalid with a message.
 *
 * @param props The ids and states.
 * @param props.labelId The id of the label.
 * @param props.describedBy The ids of the description and the error.
 * @param props.isReadOnly Whether the field is read-only.
 * @param props.isInvalid Whether the field was refused.
 * @param props.multiline Whether the field has several lines.
 * @param props.focusKey The key of the problem jump.
 * @returns The attributes.
 */
function areaAttributes(
	props: Readonly<{
		labelId: string;
		describedBy: string;
		isReadOnly: boolean;
		isInvalid: boolean;
		multiline: boolean;
		focusKey: string;
	}>,
): Record<string, string> {
	const attributes: Record<string, string> = {
		'aria-labelledby': props.labelId,
		'aria-multiline': String(props.multiline),
		class: `${contentClass} ${props.multiline ? 'min-h-24' : ''}`,
		'data-problem-focus': props.focusKey,
		role: 'textbox',
	};
	if (props.describedBy !== '') attributes['aria-describedby'] = props.describedBy;
	if (props.isInvalid) attributes['aria-invalid'] = 'true';
	if (props.isReadOnly) attributes['aria-readonly'] = 'true';
	return attributes;
}

/**
 * A Tiptap editor as a form field: label, editable area, description and error. Tiptap injects
 * no CSS (`injectCSS: false`, the styles are in `styles.css`), and it renders only in the browser
 * (`immediatelyRender: false`). The content follows `value`: a change from outside (another
 * block, a reset) replaces it, without counting as an edit.
 *
 * @param props The props.
 * @returns The field.
 */
export function TiptapField<T>(props: TiptapFieldProps<T>): ReactNode {
	const {
		before,
		beside,
		description,
		error,
		extensions,
		focusKey,
		fromJson,
		isReadOnly,
		label,
		multiline,
		onChange,
		onEditor,
		toJson,
		value,
	} = props;
	const labelId = useId();
	const descriptionId = useId();
	const errorId = useId();
	const latest = useRef({ fromJson, onChange });
	useEffect(() => {
		latest.current = { fromJson, onChange };
	}, [fromJson, onChange]);
	const describedBy = [description === null ? '' : descriptionId, error === null ? '' : errorId]
		.filter((id) => id !== '')
		.join(' ');
	const attributes = useMemo(
		() =>
			areaAttributes({
				describedBy,
				focusKey,
				isInvalid: error !== null,
				isReadOnly,
				labelId,
				multiline,
			}),
		[describedBy, error, focusKey, isReadOnly, labelId, multiline],
	);
	// The options keep their identity between renders: Tiptap compares them on every render and
	// applies changed ones (here: the attributes of a refused or read-only field).
	// oxlint-disable-next-line react/hook-use-state -- kept from the first render, never set: Tiptap starts from it
	const [content] = useState(() => toJson(value));
	const editorProps = useMemo(() => ({ attributes }), [attributes]);
	const editor = useEditor({
		content,
		editable: !isReadOnly,
		editorProps,
		extensions,
		immediatelyRender: false,
		injectCSS: false,
		onUpdate: ({ editor: changed }) => {
			latest.current.onChange(latest.current.fromJson(changed.getJSON()));
		},
	});
	useEffect(() => {
		if (editor !== null) onEditor?.(editor);
	}, [editor, onEditor]);
	useEffect(() => {
		editor?.setEditable(!isReadOnly, false);
	}, [editor, isReadOnly]);
	useEffect(() => {
		if (editor === null) return;
		const current = JSON.stringify(latest.current.fromJson(editor.getJSON()));
		if (current !== JSON.stringify(value)) {
			editor.commands.setContent(toJson(value), { emitUpdate: false });
		}
	}, [editor, toJson, value]);
	return (
		<div className="flex flex-col gap-1">
			<span className="font-semibold" id={labelId}>
				{label}
			</span>
			{editor === null || before === undefined ? null : before(editor)}
			<div className="flex items-start gap-2">
				<EditorContent className="min-w-0 flex-1" editor={editor} />
				{editor === null || beside === undefined ? null : beside(editor)}
			</div>
			{description === null ? null : (
				<p className="text-sm text-gray-700" id={descriptionId}>
					{description}
				</p>
			)}
			{error === null ? null : (
				<p className="text-sm text-red-700" id={errorId}>
					{error}
				</p>
			)}
		</div>
	);
}
