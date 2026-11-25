import { useCallback } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
} from 'react-aria-components';
import type { Key } from 'react-aria-components';

import { ChevronIcon } from '@/components/icons';
import { optionClass, popoverClass, selectButtonClass } from '@/components/styles';

/** An area to choose. */
interface AreaChoice {
	readonly id: string;
	readonly name: string;
}

/**
 * A select of areas with a visible label.
 *
 * @param props The props.
 * @param props.areas The areas to offer, in order.
 * @param props.label The label.
 * @param props.onChange Called with the id of the chosen area.
 * @param props.value The id of the area shown.
 * @returns The select.
 */
export function AreaSelect({
	areas,
	label,
	onChange,
	value,
}: Readonly<{
	areas: readonly AreaChoice[];
	label: string;
	onChange: (id: string) => void;
	value: string;
}>): ReactNode {
	const change = useCallback(
		(key: Key | null) => {
			if (typeof key === 'string') onChange(key);
		},
		[onChange],
	);
	return (
		<Select className="flex max-w-sm flex-col gap-1" onChange={change} value={value}>
			<Label className="font-semibold">{label}</Label>
			<Button className={selectButtonClass}>
				<SelectValue />
				<ChevronIcon />
			</Button>
			<Popover className={popoverClass}>
				<ListBox className="outline-none">
					{areas.map(({ id, name }) => (
						<ListBoxItem className={optionClass} id={id} key={id}>
							{name}
						</ListBoxItem>
					))}
				</ListBox>
			</Popover>
		</Select>
	);
}

export type { AreaChoice };
