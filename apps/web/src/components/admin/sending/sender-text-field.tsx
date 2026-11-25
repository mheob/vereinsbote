import type { ReactNode } from 'react';
import { FieldError, Input, Label, Text, TextField } from 'react-aria-components';

import { inputClass } from '@/components/styles';

import type { TextFieldName } from './sender-values';

const fieldClass = 'flex max-w-xl flex-col gap-1';
const errorClass = 'text-sm text-red-700';

/**
 * A text field of the form.
 *
 * @param props The props.
 * @param props.name The field name.
 * @param props.label The label.
 * @param props.defaultValue The stored value.
 * @param props.isRequired Whether the browser asks for a value.
 * @param props.help A description, or null.
 * @param props.maxLength The longest value.
 * @param props.type The input type.
 * @returns The field.
 */
export function SenderTextField({
	defaultValue,
	help = null,
	isRequired = false,
	label,
	maxLength,
	name,
	type = 'text',
}: Readonly<{
	name: TextFieldName;
	label: string;
	defaultValue: string;
	maxLength: number;
	isRequired?: boolean;
	help?: string | null;
	type?: 'email' | 'text';
}>): ReactNode {
	return (
		<TextField
			className={fieldClass}
			defaultValue={defaultValue}
			isRequired={isRequired}
			maxLength={maxLength}
			name={name}
			type={type}
		>
			<Label className="font-semibold">{label}</Label>
			<Input className={inputClass} />
			{help === null ? null : (
				<Text className="text-sm" slot="description">
					{help}
				</Text>
			)}
			<FieldError className={errorClass} />
		</TextField>
	);
}
