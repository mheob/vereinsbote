import type { ReactNode } from 'react';
import { CheckboxButton, CheckboxField } from 'react-aria-components';

import { CheckIcon } from '@/components/icons';
import { checkboxBoxClass, checkboxClass } from '@/components/styles';

/**
 * A checkbox with its label, alone or in a `CheckboxGroup` (then with `value`).
 *
 * @param props The props.
 * @param props.isSelected Whether it is ticked, outside a group.
 * @param props.label The label.
 * @param props.onChange Called with the new state, outside a group.
 * @param props.value The value in a checkbox group.
 * @returns The checkbox.
 */
export function LabelledCheckbox({
	isSelected,
	label,
	onChange,
	value,
}: Readonly<{
	isSelected?: boolean;
	label: string;
	onChange?: (isSelected: boolean) => void;
	value?: string;
}>): ReactNode {
	return (
		<CheckboxField isSelected={isSelected} onChange={onChange} value={value}>
			<CheckboxButton className={checkboxClass}>
				{({ isSelected: checked }) => (
					<>
						<span className={checkboxBoxClass}>{checked ? <CheckIcon /> : null}</span>
						{label}
					</>
				)}
			</CheckboxButton>
		</CheckboxField>
	);
}
