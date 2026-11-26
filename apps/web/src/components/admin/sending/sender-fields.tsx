import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	CheckboxGroup,
	FieldError,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
	Text,
} from 'react-aria-components';
import type { Key } from 'react-aria-components';

import { LimitField } from '@/components/admin/sending/limit-field';
import { SenderTextField } from '@/components/admin/sending/sender-text-field';
import { LabelledCheckbox } from '@/components/contacts/import/labelled-checkbox';
import { ChevronIcon } from '@/components/icons';
import { optionClass, popoverClass, selectButtonClass } from '@/components/styles';
import type { SenderPage } from '@/functions/sending';
import { useT } from '@/i18n/use-t';
import type { ConnectionKind } from '@/server/sending/connections';
import {
	DEFAULT_GRAPH_PER_MINUTE,
	MAX_ADDRESS_LENGTH,
	MAX_DAILY_LIMIT,
	MAX_PER_MINUTE,
} from '@/server/sending/limits';

const fieldClass = 'flex max-w-xl flex-col gap-1';
const errorClass = 'text-sm text-red-700';

/**
 * The choice of the connection of a sender.
 *
 * @param props The props.
 * @param props.connections The connections to choose from.
 * @param props.value The chosen connection.
 * @param props.error The message of a refusal, or undefined.
 * @param props.onChange Called with the chosen connection.
 * @returns The select.
 */
export function ConnectionSelect({
	connections,
	error,
	onChange,
	value,
}: Readonly<{
	connections: SenderPage['connections'];
	value: string;
	error: string | undefined;
	onChange: (id: string) => void;
}>): ReactNode {
	const t = useT();
	const change = useCallback(
		(key: Key | null) => {
			if (typeof key === 'string') onChange(key);
		},
		[onChange],
	);
	return (
		<Select className={fieldClass} isInvalid={error !== undefined} onChange={change} value={value}>
			<Label className="font-semibold">{t('sending.connectionLabel')}</Label>
			<Button className={selectButtonClass}>
				<SelectValue />
				<ChevronIcon />
			</Button>
			<FieldError className={errorClass}>{error}</FieldError>
			<Popover className={popoverClass}>
				<ListBox className="outline-none">
					{connections.map((connection) => (
						<ListBoxItem className={optionClass} id={connection.id} key={connection.id}>
							{connection.name}
						</ListBoxItem>
					))}
				</ListBox>
			</Popover>
		</Select>
	);
}

/**
 * The checkboxes of the areas a sender is released to.
 *
 * @param props The props.
 * @param props.areas The areas to choose from.
 * @param props.value The ids of the released areas.
 * @param props.error The message of a refusal, or undefined.
 * @param props.onChange Called with the released areas.
 * @returns The group.
 */
export function AreasField({
	areas,
	error,
	onChange,
	value,
}: Readonly<{
	areas: SenderPage['areas'];
	value: readonly string[];
	error: string | undefined;
	onChange: (ids: readonly string[]) => void;
}>): ReactNode {
	const t = useT();
	const selected = useMemo(() => [...value], [value]);
	const change = useCallback(
		(ids: readonly string[]) => {
			onChange(ids);
		},
		[onChange],
	);
	return (
		<CheckboxGroup
			className="flex flex-col gap-2"
			isInvalid={error !== undefined}
			onChange={change}
			value={selected}
		>
			<Label className="font-semibold">{t('sending.areasLabel')}</Label>
			<Text className="text-sm" slot="description">
				{t('sending.areasHelp')}
			</Text>
			{areas.length === 0 ? <p>{t('sending.noAreasExist')}</p> : null}
			{areas.map((area) => (
				<LabelledCheckbox key={area.id} label={area.name} value={area.id} />
			))}
			<FieldError className={errorClass}>{error}</FieldError>
		</CheckboxGroup>
	);
}

/**
 * The fields that depend on the kind of the connection: the limits of a Graph sender, or the
 * archive copy of a Resend sender.
 *
 * @param props The props.
 * @param props.kind The kind of the chosen connection.
 * @param props.sender The sender to change, or null for a new one.
 * @returns The fields.
 */
export function KindFields({
	kind,
	sender,
}: Readonly<{ kind: ConnectionKind; sender: SenderPage['sender'] }>): ReactNode {
	const t = useT();
	const dailyLimit = sender?.dailyLimit ?? null;
	if (kind === 'resend') {
		return (
			<>
				<p className="text-sm">{t('sending.inheritedLimits')}</p>
				<SenderTextField
					defaultValue={sender?.archiveBcc ?? ''}
					help={t('sending.archiveBccHelp')}
					label={t('sending.archiveBccLabel')}
					maxLength={MAX_ADDRESS_LENGTH}
					name="archiveBcc"
					type="email"
				/>
			</>
		);
	}
	return (
		<>
			<p className="text-sm">{t('sending.senderLimitsHelp')}</p>
			<LimitField
				defaultValue={sender?.perMinute ?? DEFAULT_GRAPH_PER_MINUTE}
				isRequired
				label={t('sending.perMinuteLabel')}
				maxValue={MAX_PER_MINUTE}
				name="perMinute"
			/>
			<LimitField
				defaultValue={dailyLimit ?? undefined}
				help={t('sending.dailyLimitHelp')}
				label={t('sending.dailyLimitLabel')}
				maxValue={MAX_DAILY_LIMIT}
				name="dailyLimit"
			/>
		</>
	);
}
