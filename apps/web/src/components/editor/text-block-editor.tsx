import { ClientOnly } from '@tanstack/react-router';
import { lazy, Suspense, useMemo } from 'react';
import type { ComponentProps, ReactNode } from 'react';

import { EditorFieldPlaceholder } from './editor-field-placeholder';
import type { TextBlockField } from './text-block-field';

// Tiptap is a browser library: the import runs on the client only, and `import.meta.env.SSR`
// keeps it out of the server bundle (the CI bundle check looks for it there).
const LoadedField = lazy(async () => {
	if (import.meta.env.SSR) throw new Error('Tiptap loads in the browser only');
	const { TextBlockField: field } = await import('./text-block-field');
	return { default: field };
});

/**
 * The editor of a text block. Tiptap loads in the browser only; the server and the first client
 * render show an empty field of the same size.
 *
 * @param props The props of `TextBlockField`.
 * @returns The field.
 */
export function TextBlockEditor(props: Readonly<ComponentProps<typeof TextBlockField>>): ReactNode {
	const { label } = props;
	const fallback = useMemo(() => <EditorFieldPlaceholder label={label} multiline />, [label]);
	return (
		<ClientOnly fallback={fallback}>
			<Suspense fallback={fallback}>
				<LoadedField {...props} />
			</Suspense>
		</ClientOnly>
	);
}
