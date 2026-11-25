import type { ReactNode } from 'react';
import { FieldError, Input, Label, NumberField, Text } from 'react-aria-components';

import { inputClass } from '@/components/styles';

const WHOLE_NUMBER: Intl.NumberFormatOptions = { maximumFractionDigits: 0, useGrouping: false };

/**
 * A field for a limit: a whole number from 1, read in the language of the page (so „1.000“ is not
 * taken for 1). The form sends the plain number; an empty optional field sends nothing.
 *
 * @param props The props.
 * @param props.name The field name.
 * @param props.label The label.
 * @param props.defaultValue The stored value, or undefined.
 * @param props.maxValue The largest allowed value.
 * @param props.isRequired Whether a value is needed.
 * @param props.help A description, or null.
 * @returns The field.
 */
export function LimitField({
	defaultValue,
	help = null,
	isRequired = false,
	label,
	maxValue,
	name,
}: Readonly<{
	name: string;
	label: string;
	maxValue: number;
	defaultValue?: number;
	isRequired?: boolean;
	help?: string | null;
}>): ReactNode {
	return (
		<NumberField
			className="flex max-w-xl flex-col gap-1"
			// Out of range stays as typed and is shown as an error, never clamped silently.
			commitBehavior="validate"
			defaultValue={defaultValue}
			formatOptions={WHOLE_NUMBER}
			isRequired={isRequired}
			maxValue={maxValue}
			minValue={1}
			name={name}
		>
			<Label className="font-semibold">{label}</Label>
			<Input className={`w-40 ${inputClass}`} />
			{help === null ? null : (
				<Text className="text-sm" slot="description">
					{help}
				</Text>
			)}
			<FieldError className="text-sm text-red-700" />
		</NumberField>
	);
}
