import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { useFormStatus } from 'react-dom';

const buttonClass =
	'rounded-md bg-blue-700 px-4 py-2 font-semibold text-white data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-hovered:bg-blue-800 data-pending:opacity-70';

/**
 * The submit button of a form with a React form action. It shows the pending state of its own
 * form only, so two forms that share one action each show their own.
 *
 * @param props The button's props.
 * @param props.children The label.
 * @returns The button.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- ReactNode cannot be made deeply readonly.
export function SubmitButton({ children }: Readonly<{ children: ReactNode }>): ReactNode {
	const { pending } = useFormStatus();
	return (
		<Button className={buttonClass} isPending={pending} type="submit">
			{children}
		</Button>
	);
}
