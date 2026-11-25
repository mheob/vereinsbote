import type { ComponentProps, ReactNode } from 'react';

import type { InlineField } from './inline-field';
import { LazyEditorField } from './lazy-editor-field';
import { retryableLazy } from './retryable-lazy';

// Tiptap is a browser library: the import runs on the client only, and `import.meta.env.SSR`
// keeps it out of the server bundle (the CI bundle check looks for it there).
const loadedField = retryableLazy(async () => {
	if (import.meta.env.SSR) throw new Error('Tiptap loads in the browser only');
	const { InlineField: field } = await import('./inline-field');
	return field;
});

/**
 * A one-line editor for a heading, a button label, the subject, the preview text or a salutation
 * text. Tiptap loads in the browser only; the server and the first client render show an empty
 * field of the same size, and a failed load shows its error at the field.
 *
 * @param props The props of `InlineField`.
 * @returns The field.
 */
export function InlineEditor(props: Readonly<ComponentProps<typeof InlineField>>): ReactNode {
	return <LazyEditorField field={loadedField} fieldProps={props} multiline={false} />;
}
