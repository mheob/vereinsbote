import { useCallback, useId } from 'react';
import type { ReactNode } from 'react';
import {
	ColorField,
	ColorPicker,
	ColorSwatch,
	FieldError,
	Input,
	Label,
	Text,
} from 'react-aria-components';
import type { Color } from 'react-aria-components';

import { inputClass } from '@/components/styles';

import { ContrastNotice } from './contrast-notice';

/**
 * A colour as a hex value with a swatch beside it. The value only changes when the typed hex is
 * complete and valid (React Aria commits it on blur or Enter); a weak contrast shows below the
 * field and is part of its description.
 *
 * @param props The props.
 * @param props.name The field name, which refused values are reported under.
 * @param props.label The visible label.
 * @param props.help What the colour is used for.
 * @param props.value The colour as `#rrggbb`.
 * @param props.ratio The contrast ratio when the colour's pair is below 4.5:1, else null.
 * @param props.onChange Called with the new `#rrggbb` colour.
 * @returns The field.
 */
export function BrandColorField({
	help,
	label,
	name,
	onChange,
	ratio,
	value,
}: Readonly<{
	name: string;
	label: string;
	help: string;
	value: string;
	ratio: number | null;
	onChange: (value: string) => void;
}>): ReactNode {
	const noticeId = useId();
	const change = useCallback(
		(color: Readonly<Color> | null) => {
			if (color !== null) onChange(color.toString('hex').toLowerCase());
		},
		[onChange],
	);
	return (
		<ColorPicker onChange={change} value={value}>
			<ColorField
				aria-describedby={ratio === null ? undefined : noticeId}
				className="flex flex-col gap-1"
				name={name}
			>
				<Label className="font-semibold">{label}</Label>
				<div className="flex items-center gap-3">
					<ColorSwatch className="size-9 shrink-0 rounded-md border border-gray-600" />
					<Input className={`w-32 ${inputClass}`} />
				</div>
				<Text className="text-sm text-gray-700" slot="description">
					{help}
				</Text>
				{ratio === null ? null : <ContrastNotice id={noticeId} ratio={ratio} />}
				<FieldError className="text-sm text-red-700" />
			</ColorField>
		</ColorPicker>
	);
}
