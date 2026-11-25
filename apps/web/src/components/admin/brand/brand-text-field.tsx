import type { ReactNode } from 'react';
import { FieldError, Input, Label, Text, TextArea, TextField } from 'react-aria-components';

import { inputClass } from '@/components/styles';

/**
 * A text field of the brand form, controlled by the form's draft. A refusal arrives through the
 * form's `validationErrors` under `name` and shows at the field.
 *
 * @param props The props.
 * @param props.name The field name, which refused values are reported under.
 * @param props.label The visible label.
 * @param props.value The text.
 * @param props.onChange Called with the new text.
 * @param props.help A hint below the field.
 * @param props.multiline Whether the field has several lines.
 * @param props.maxLength The most characters; the server's limit.
 * @returns The field.
 */
export function BrandTextField({
	help,
	label,
	maxLength,
	multiline = false,
	name,
	onChange,
	value,
}: Readonly<{
	name: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	help?: string;
	multiline?: boolean;
	maxLength?: number;
}>): ReactNode {
	return (
		<TextField
			autoComplete="off"
			className="flex flex-col gap-1"
			maxLength={maxLength}
			name={name}
			onChange={onChange}
			value={value}
		>
			<Label className="font-semibold">{label}</Label>
			{multiline ? <TextArea className={inputClass} rows={3} /> : <Input className={inputClass} />}
			{help === undefined ? null : (
				<Text className="text-sm text-gray-700" slot="description">
					{help}
				</Text>
			)}
			<FieldError className="text-sm text-red-700" />
		</TextField>
	);
}
