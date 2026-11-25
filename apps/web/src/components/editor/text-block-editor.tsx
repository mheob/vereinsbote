import type { ComponentProps, ReactNode } from 'react';

import { LazyEditorField } from './lazy-editor-field';
import { retryableLazy } from './retryable-lazy';
import type { TextBlockField } from './text-block-field';

// Tiptap is a browser library: the import runs on the client only, and `import.meta.env.SSR`
// keeps it out of the server bundle (the CI bundle check looks for it there).
const loadedField = retryableLazy(async () => {
	if (import.meta.env.SSR) throw new Error('Tiptap loads in the browser only');
	const { TextBlockField: field } = await import('./text-block-field');
	return field;
});

/**
 * The editor of a text block. Tiptap loads in the browser only; the server and the first client
 * render show an empty field of the same size, and a failed load shows its error at the field.
 *
 * @param props The props of `TextBlockField`.
 * @returns The field.
 */
export function TextBlockEditor(props: Readonly<ComponentProps<typeof TextBlockField>>): ReactNode {
	return <LazyEditorField field={loadedField} fieldProps={props} multiline />;
}
