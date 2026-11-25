import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import type { InlineNode } from '@/mail/blocks/text-doc';
import type { EditorPlaceholder } from '@/server/templates/editor-placeholders';

import { inlineFromSyntax, syntaxFromInline } from './editor-content';
import { InlineEditor } from './inline-editor';

/**
 * A one-line editor for a text stored with placeholder syntax: the subject, the preview text or a
 * salutation text. The user sees marks, never `{{…}}`. What was typed stays as it is, even when it
 * does not read back as syntax (the save checks report that); a change from outside (a reset)
 * replaces it.
 *
 * @param props The props.
 * @param props.label The visible label.
 * @param props.value The text with placeholder syntax.
 * @param props.onChange Called with the new text.
 * @param props.placeholders The placeholders the button offers.
 * @param props.labels The placeholders whose names the marks show.
 * @param props.isReadOnly Whether the field is read-only.
 * @param props.error The message of a refusal, or null.
 * @param props.description A hint below the field, or null.
 * @param props.focusKey The key of the editor's problem jump.
 * @returns The field.
 */
export function SyntaxEditor({
	description,
	error,
	focusKey,
	isReadOnly,
	label,
	labels,
	onChange,
	placeholders,
	value,
}: Readonly<{
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholders: readonly EditorPlaceholder[];
	labels: readonly EditorPlaceholder[];
	isReadOnly: boolean;
	error: string | null;
	description: string | null;
	focusKey: string;
}>): ReactNode {
	const [nodes, setNodes] = useState<readonly InlineNode[]>(() => inlineFromSyntax(value));
	const [seen, setSeen] = useState(value);
	// Derived state, set while rendering: a text changed from outside replaces the nodes.
	if (value !== seen) {
		setSeen(value);
		if (syntaxFromInline(nodes) !== value) setNodes(inlineFromSyntax(value));
	}
	const change = useCallback(
		(next: readonly InlineNode[]) => {
			const text = syntaxFromInline(next);
			setNodes(next);
			setSeen(text);
			onChange(text);
		},
		[onChange],
	);
	return (
		<InlineEditor
			description={description}
			error={error}
			focusKey={focusKey}
			isReadOnly={isReadOnly}
			label={label}
			labels={labels}
			onChange={change}
			placeholders={placeholders}
			value={nodes}
		/>
	);
}
