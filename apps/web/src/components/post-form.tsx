import type { ReactNode, Ref } from 'react';
import { Form } from 'react-aria-components';
import type { FormProps } from 'react-aria-components';

import { useHydrated } from './use-hydrated';

/**
 * React Aria's `Form` for forms that submit through `onSubmit`. Until the page is hydrated their
 * handler is missing, and a browser would submit the form itself. Two guards keep that from
 * happening:
 * - `method="post"`: a native submission never puts field values (a setup token, an address)
 *   into the URL, where history and server logs would keep them.
 * - A hidden, disabled submit button comes first until hydration. It is the form's default
 *   button, so pressing Enter in a field submits nothing; the visible submit buttons are pending
 *   until then (`SubmitButton`), so a click does nothing and the input stays.
 *
 * @param props React Aria's form props and the form's `ref`.
 * @param props.children The fields and buttons.
 * @param props.method The method of a native submission; `post` unless given.
 * @returns The form.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- React Aria's props hold refs and handlers, which are mutable by design
export function PostForm({
	children,
	method = 'post',
	...props
}: FormProps & { readonly ref?: Ref<HTMLFormElement> }): ReactNode {
	const hydrated = useHydrated();
	return (
		<Form {...props} method={method}>
			{hydrated ? null : (
				// oxlint-disable-next-line jsx-a11y/control-has-associated-label -- hidden and disabled, never reachable; it only blocks Enter
				<button disabled hidden type="submit" />
			)}
			{children}
		</Form>
	);
}
