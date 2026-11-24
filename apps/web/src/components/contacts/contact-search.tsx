import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	CheckboxButton,
	CheckboxField,
	Input,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
	TextField,
} from 'react-aria-components';
import type { FormProps, Key } from 'react-aria-components';

import { CheckIcon, ChevronIcon } from '@/components/icons';
import { PostForm } from '@/components/post-form';
import {
	checkboxBoxClass,
	checkboxClass,
	inputClass,
	optionClass,
	popoverClass,
	selectButtonClass,
} from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { useT } from '@/i18n/use-t';
import type { ContactFilters } from '@/server/contacts/contacts';
import type { ContactKind } from '@/server/contacts/fields';
import { MAX_SEARCH_LENGTH } from '@/server/contacts/list-query';

/** What the user searches for: the text and the filters. */
type ContactSearchCriteria = Readonly<{ query: string; filters: ContactFilters }>;

type ExitFilter = NonNullable<ContactFilters['exit']>;

/** The option „all“ of a select; the others are `value:<value>`, so no value can clash with it. */
const ANY = 'any';

const EXIT_FILTERS: readonly ExitFilter[] = ['reached', 'planned'];

const fieldClass = 'flex min-w-48 flex-col gap-1';

/**
 * The key of a group or tag in its select.
 *
 * @param value The group or tag.
 * @returns The key.
 */
function choiceKey(value: string): string {
	return `value:${value}`;
}

/**
 * A select with the option „all“ first, then one option per value.
 *
 * @param props The props.
 * @param props.all The label of „all“.
 * @param props.label The label of the select.
 * @param props.onChange Called with the chosen key.
 * @param props.options The values, with their key and label.
 * @param props.value The key of the chosen option.
 * @returns The select.
 */
function FilterSelect({
	all,
	label,
	onChange,
	options,
	value,
}: Readonly<{
	all: string;
	label: string;
	onChange: (key: Key | null) => void;
	options: readonly Readonly<{ key: string; label: string }>[];
	value: string;
}>): ReactNode {
	return (
		<Select className={fieldClass} onChange={onChange} value={value}>
			<Label className="font-semibold">{label}</Label>
			<Button className={selectButtonClass}>
				<SelectValue />
				<ChevronIcon />
			</Button>
			<Popover className={popoverClass}>
				<ListBox className="max-h-80 overflow-auto outline-none">
					<ListBoxItem className={optionClass} id={ANY}>
						{all}
					</ListBoxItem>
					{options.map((option) => (
						<ListBoxItem className={optionClass} id={option.key} key={option.key}>
							{option.label}
						</ListBoxItem>
					))}
				</ListBox>
			</Popover>
		</Select>
	);
}

/**
 * A filter checkbox with its label.
 *
 * @param props The props.
 * @param props.isSelected Whether the filter is on.
 * @param props.label The label.
 * @param props.onChange Called with the new state.
 * @returns The checkbox.
 */
function FilterCheckbox({
	isSelected,
	label,
	onChange,
}: Readonly<{
	isSelected: boolean;
	label: string;
	onChange: (isSelected: boolean) => void;
}>): ReactNode {
	return (
		<CheckboxField isSelected={isSelected} onChange={onChange}>
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

/**
 * The search over the contacts of a kind: the text (names, organization, e-mail, number) and the
 * filters, sent with „Suchen“ or Enter. The values stay in the form and go to the server by POST
 * only, never into the URL. Members filter by group, partners by tag; the exit filter shows only
 * to users who see the members' exit date.
 *
 * @param props The props.
 * @param props.canFilterExit Whether the exit filter shows.
 * @param props.choices The groups (members) or tags (partners) to filter by.
 * @param props.isPending Whether a search is running.
 * @param props.kind The kind of the list.
 * @param props.onSearch Called with the search and filters.
 * @returns The form.
 */
export function ContactSearch({
	canFilterExit,
	choices,
	isPending,
	kind,
	onSearch,
}: Readonly<{
	canFilterExit: boolean;
	choices: readonly string[];
	isPending: boolean;
	kind: ContactKind;
	onSearch: (criteria: ContactSearchCriteria) => void;
}>): ReactNode {
	const t = useT();
	const [query, setQuery] = useState('');
	const [choice, setChoice] = useState<string | undefined>();
	const [withoutEmail, setWithoutEmail] = useState(false);
	const [suppressed, setSuppressed] = useState(false);
	const [exit, setExit] = useState<ExitFilter | undefined>();
	const onChoice = useCallback(
		(key: Key | null) => {
			setChoice(choices.find((value) => choiceKey(value) === key));
		},
		[choices],
	);
	const onExit = useCallback((key: Key | null) => {
		setExit(EXIT_FILTERS.find((value) => value === key));
	}, []);
	const choiceOptions = useMemo(
		() => choices.map((value) => ({ key: choiceKey(value), label: value })),
		[choices],
	);
	const exitOptions = useMemo(
		() => [
			{ key: 'reached', label: t('contacts.exitReached') },
			{ key: 'planned', label: t('contacts.exitPlanned') },
		],
		[t],
	);
	const onSubmit = useCallback<NonNullable<FormProps['onSubmit']>>(
		(event) => {
			event.preventDefault();
			const filters: ContactFilters = {
				exit: canFilterExit ? exit : undefined,
				suppressed,
				withoutEmail,
				...(kind === 'member' ? { group: choice } : { tag: choice }),
			};
			onSearch({ filters, query });
		},
		[canFilterExit, choice, exit, kind, onSearch, query, suppressed, withoutEmail],
	);
	return (
		<PostForm className="flex flex-col gap-4" onSubmit={onSubmit}>
			<TextField
				autoComplete="off"
				className="flex max-w-md flex-col gap-1"
				maxLength={MAX_SEARCH_LENGTH}
				onChange={setQuery}
				type="search"
				value={query}
			>
				<Label className="font-semibold">{t('contacts.search')}</Label>
				<Input className={inputClass} />
			</TextField>
			<fieldset className="flex flex-wrap items-end gap-x-6 gap-y-4">
				<legend className="mb-2 font-semibold">{t('contacts.filters')}</legend>
				<FilterSelect
					all={t(kind === 'member' ? 'contacts.allGroups' : 'contacts.allTags')}
					label={t(kind === 'member' ? 'contacts.groupFilter' : 'contacts.tagFilter')}
					onChange={onChoice}
					options={choiceOptions}
					value={choice === undefined ? ANY : choiceKey(choice)}
				/>
				{canFilterExit ? (
					<FilterSelect
						all={t('contacts.exitAny')}
						label={t('contacts.exitFilter')}
						onChange={onExit}
						options={exitOptions}
						value={exit ?? ANY}
					/>
				) : null}
				<FilterCheckbox
					isSelected={withoutEmail}
					label={t('contacts.withoutEmail')}
					onChange={setWithoutEmail}
				/>
				<FilterCheckbox
					isSelected={suppressed}
					label={t('contacts.suppressedFilter')}
					onChange={setSuppressed}
				/>
			</fieldset>
			<div>
				<SubmitButton isPending={isPending}>{t('contacts.searchSubmit')}</SubmitButton>
			</div>
		</PostForm>
	);
}

export type { ContactSearchCriteria };
