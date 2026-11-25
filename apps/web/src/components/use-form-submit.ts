import { startTransition, useCallback } from 'react';
import type { FormProps } from 'react-aria-components';

type SubmitHandler = NonNullable<FormProps['onSubmit']>;

/**
 * Submits a form to an action state through `onSubmit`, not as a form action: React resets a
 * form after its action, which would clear the fields after a refusal.
 *
 * @param submitForm The dispatch of the form's action state.
 * @returns The `onSubmit` handler.
 */
export function useFormSubmit(submitForm: (formData: FormData) => void): SubmitHandler {
	return useCallback<SubmitHandler>(
		(event) => {
			event.preventDefault();
			const formData = new FormData(event.currentTarget);
			startTransition(() => {
				submitForm(formData);
			});
		},
		[submitForm],
	);
}

export type { SubmitHandler };
