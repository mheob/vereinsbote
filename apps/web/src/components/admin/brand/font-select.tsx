import { useCallback } from 'react';
import type { Key, ReactNode } from 'react';
import {
	Button,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
} from 'react-aria-components';

import { ChevronIcon } from '@/components/icons';
import { optionClass, popoverClass, selectButtonClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import { FONT_STACKS } from '@/mail/brand/brand-schema';
import type { FontStackId } from '@/mail/brand/brand-schema';

function isFontStack(key: Key | null): key is FontStackId {
	return FONT_STACKS.some((stack) => stack === key);
}

/**
 * The choice of one of the font stacks mail clients have.
 *
 * @param props The props.
 * @param props.label The visible label.
 * @param props.value The chosen stack.
 * @param props.onChange Called with the newly chosen stack.
 * @returns The select.
 */
export function FontSelect({
	label,
	onChange,
	value,
}: Readonly<{
	label: string;
	value: FontStackId;
	onChange: (value: FontStackId) => void;
}>): ReactNode {
	const t = useT();
	const change = useCallback(
		(key: Key | null) => {
			if (isFontStack(key)) onChange(key);
		},
		[onChange],
	);
	return (
		<Select className="flex flex-col gap-1" onChange={change} value={value}>
			<Label className="font-semibold">{label}</Label>
			<Button className={selectButtonClass}>
				<SelectValue />
				<ChevronIcon />
			</Button>
			<Popover className={popoverClass}>
				<ListBox className="outline-none">
					{FONT_STACKS.map((stack) => (
						<ListBoxItem
							className={optionClass}
							id={stack}
							key={stack}
							textValue={t(`brand.font.${stack}`)}
						>
							{t(`brand.font.${stack}`)}
						</ListBoxItem>
					))}
				</ListBox>
			</Popover>
		</Select>
	);
}
