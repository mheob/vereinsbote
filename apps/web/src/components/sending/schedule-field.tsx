/* oxlint-disable typescript/prefer-readonly-parameter-types -- a date of @internationalized/date is an immutable value whose class the rule cannot see into */
import { toCalendarDateTime } from '@internationalized/date';
import type { CalendarDateTime } from '@internationalized/date';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import {
	DateField,
	DateInput,
	DateSegment,
	FieldError,
	Label,
	RadioGroup,
	Text,
} from 'react-aria-components';
import type { DateValue } from 'react-aria-components';

import { Choice } from '@/components/admin/brand/choice';
import { useT } from '@/i18n/use-t';

import { scheduleBounds } from './schedule';
import type { When } from './schedule';

const dateInputClass =
	'flex w-fit rounded-md border border-gray-600 px-3 py-2 data-focus-within:outline-2 data-focus-within:outline-offset-2 data-focus-within:outline-blue-700 data-invalid:border-red-700';
const WHEN: readonly When[] = ['now', 'later'];

const segmentClass =
	'rounded-sm px-0.5 tabular-nums outline-none data-focused:bg-blue-700 data-focused:text-white data-placeholder:text-gray-600';

/**
 * The date and time of a planned start, on the club's clock (Europe/Berlin): React Aria's date
 * field to the minute, from the next minute to a year ahead as of when it appeared. The error at
 * the field names the range, also when the server refused the start.
 *
 * @param props The props.
 * @param props.isInvalid Whether the server refused the start.
 * @param props.onChange Called with the new date and time, or null while it is incomplete.
 * @param props.value The date and time, or null.
 * @returns The field.
 */
function ScheduleField({
	isInvalid,
	onChange,
	value,
}: Readonly<{
	isInvalid: boolean;
	onChange: (value: CalendarDateTime | null) => void;
	value: CalendarDateTime | null;
}>): ReactNode {
	const t = useT();
	// oxlint-disable-next-line react/hook-use-state -- kept from the first render, never set: the range as of when the field appeared
	const [bounds] = useState(() => scheduleBounds(new Date()));
	const change = useCallback(
		(changed: DateValue | null) => {
			onChange(changed === null ? null : toCalendarDateTime(changed));
		},
		[onChange],
	);
	return (
		<DateField
			className="flex flex-col gap-1"
			granularity="minute"
			isInvalid={isInvalid}
			isRequired
			maxValue={bounds.max}
			minValue={bounds.min}
			name="notBefore"
			onChange={change}
			value={value}
		>
			<Label className="font-semibold">{t('send.atLabel')}</Label>
			<DateInput className={dateInputClass}>
				{(segment) => <DateSegment className={segmentClass} segment={segment} />}
			</DateInput>
			<Text className="text-sm text-gray-700" slot="description">
				{t('send.atHelp')}
			</Text>
			<FieldError className="text-sm text-red-700">{t('send.scheduleOutOfRange')}</FieldError>
		</DateField>
	);
}

/**
 * When the wave starts (Design 8.7): „Sofort“, or „Geplant“ with a date and a time.
 *
 * @param props The props.
 * @param props.at The planned date and time, or null.
 * @param props.isInvalid Whether the server refused the start.
 * @param props.onAt Called with a changed date and time.
 * @param props.onWhen Called with a changed choice.
 * @param props.when The choice.
 * @returns The fields.
 */
export function StartFields({
	at,
	isInvalid,
	onAt,
	onWhen,
	when,
}: Readonly<{
	at: CalendarDateTime | null;
	isInvalid: boolean;
	onAt: (value: CalendarDateTime | null) => void;
	onWhen: (when: When) => void;
	when: When;
}>): ReactNode {
	const t = useT();
	const change = useCallback(
		(value: string) => {
			onWhen(value === 'later' ? 'later' : 'now');
		},
		[onWhen],
	);
	return (
		<>
			<RadioGroup className="flex flex-col gap-2" onChange={change} value={when}>
				<Label className="font-semibold">{t('send.whenLabel')}</Label>
				{WHEN.map((choice) => (
					<Choice key={choice} label={t(`send.when.${choice}`)} value={choice} />
				))}
			</RadioGroup>
			{when === 'later' ? <ScheduleField isInvalid={isInvalid} onChange={onAt} value={at} /> : null}
		</>
	);
}
