import { ClientOnly } from '@tanstack/react-router';
import { lazy, Suspense, useMemo } from 'react';
import type { ComponentProps, ReactNode } from 'react';

import { EditorFieldPlaceholder } from './editor-field-placeholder';
import type { InlineField } from './inline-field';

// Tiptap is a browser library: the import runs on the client only, and `import.meta.env.SSR`
// keeps it out of the server bundle (the CI bundle check looks for it there).
const LoadedField = lazy(async () => {
	if (import.meta.env.SSR) throw new Error('Tiptap loads in the browser only');
	const { InlineField: field } = await import('./inline-field');
	return { default: field };
});

/**
 * A one-line editor for a heading, a button label, the subject, the preview text or a salutation
 * text. Tiptap loads in the browser only; the server and the first client render show an empty
 * field of the same size.
 *
 * @param props The props of `InlineField`.
 * @returns The field.
 */
export function InlineEditor(props: Readonly<ComponentProps<typeof InlineField>>): ReactNode {
	const { label } = props;
	const fallback = useMemo(
		() => <EditorFieldPlaceholder label={label} multiline={false} />,
		[label],
	);
	return (
		<ClientOnly fallback={fallback}>
			<Suspense fallback={fallback}>
				<LoadedField {...props} />
			</Suspense>
		</ClientOnly>
	);
}
