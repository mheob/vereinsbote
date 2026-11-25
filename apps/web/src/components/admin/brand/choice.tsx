import type { ReactNode } from 'react';
import { RadioButton, RadioField } from 'react-aria-components';

const radioClass = 'flex items-center gap-2 data-disabled:text-gray-700';

/**
 * One choice of a radio group: a ring that fills when selected.
 *
 * @param props The props.
 * @param props.value The value of the choice.
 * @param props.label The visible label.
 * @param props.isDisabled Whether the choice is unavailable.
 * @returns The radio.
 */
export function Choice({
	isDisabled = false,
	label,
	value,
}: Readonly<{ value: string; label: string; isDisabled?: boolean }>): ReactNode {
	return (
		<RadioField isDisabled={isDisabled} value={value}>
			<RadioButton className={radioClass}>
				{({ isFocusVisible, isSelected }) => (
					<>
						<span
							className={`size-5 rounded-full border-2 ${isSelected ? 'border-blue-700 bg-blue-700 shadow-[inset_0_0_0_3px_white]' : 'border-gray-600'} ${isFocusVisible ? 'outline-2 outline-offset-2 outline-blue-700' : ''}`}
						/>
						{label}
					</>
				)}
			</RadioButton>
		</RadioField>
	);
}
