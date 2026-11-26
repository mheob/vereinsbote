import { useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button, Input, Label, RadioGroup, Text, TextField } from 'react-aria-components';

import { Choice } from '@/components/admin/brand/choice';
import type { Announce } from '@/components/announcements';
import { CloseIcon } from '@/components/icons';
import { inputClass, secondaryButtonClass } from '@/components/styles';
import { AreaSelect } from '@/components/templates/area-select';
import { useT } from '@/i18n/use-t';
import { MAX_SEARCH_LENGTH } from '@/server/contacts/list-query';
import type { RecipientChoice } from '@/server/waves/recipient-search';
import type { RecipientSelection } from '@/server/waves/recipients';

import { RecipientPicker } from './recipient-picker';
import { addChosen, removeChosen } from './selection';
import type { SelectionDraft, SelectionMode } from './selection';
import type { SummaryState } from './summary-state';
import { WaveSummaryView } from './wave-summary';

const MODES: readonly SelectionMode[] = ['filter', 'single'];
const KINDS: readonly RecipientSelection['kind'][] = ['member', 'partner', 'both'];

/** The option „all“ of a filter; the others are `value:<value>`, so no value can clash with it. */
const ANY = 'any';
const VALUE_PREFIX = 'value:';

/** Single picks search every contact of both kinds. */
const EVERY_CONTACT: RecipientSelection = {
	contactIds: null,
	filters: {},
	kind: 'both',
	query: '',
};

/**
 * The options of a filter: „all“ first, then each value.
 *
 * @param all The label of „all“.
 * @param values The values.
 * @returns The options.
 */
function filterOptions(
	all: string,
	values: readonly string[],
): readonly Readonly<{ id: string; name: string }>[] {
	return [
		{ id: ANY, name: all },
		...values.map((value) => ({ id: `${VALUE_PREFIX}${value}`, name: value })),
	];
}

/**
 * The value an option of a filter stands for.
 *
 * @param id The option.
 * @returns The value, or null for „all“.
 */
function filterValue(id: string): string | null {
	return id.startsWith(VALUE_PREFIX) ? id.slice(VALUE_PREFIX.length) : null;
}

/**
 * The kind, the search and the group or tag of a selection by filter. The search goes to the
 * server by POST with each count, never into the URL.
 *
 * @param props The props.
 * @param props.draft The step's state.
 * @param props.groups The groups of the members.
 * @param props.onChange Called with the changed state.
 * @param props.tags The tags of the partners.
 * @returns The fields.
 */
function FilterFields({
	draft,
	groups,
	onChange,
	tags,
}: Readonly<{
	draft: SelectionDraft;
	groups: readonly string[];
	onChange: (draft: SelectionDraft) => void;
	tags: readonly string[];
}>): ReactNode {
	const t = useT();
	const groupOptions = useMemo(() => filterOptions(t('send.groupAll'), groups), [groups, t]);
	const tagOptions = useMemo(() => filterOptions(t('send.tagAll'), tags), [tags, t]);
	const changeKind = useCallback(
		(value: string) => {
			const kind = KINDS.find((entry) => entry === value);
			if (kind !== undefined) onChange({ ...draft, kind });
		},
		[draft, onChange],
	);
	const changeQuery = useCallback(
		(query: string) => {
			onChange({ ...draft, query });
		},
		[draft, onChange],
	);
	const changeGroup = useCallback(
		(id: string) => {
			onChange({ ...draft, group: filterValue(id) });
		},
		[draft, onChange],
	);
	const changeTag = useCallback(
		(id: string) => {
			onChange({ ...draft, tag: filterValue(id) });
		},
		[draft, onChange],
	);
	return (
		<>
			<RadioGroup className="flex flex-col gap-2" onChange={changeKind} value={draft.kind}>
				<Label className="font-semibold">{t('send.kindLabel')}</Label>
				{KINDS.map((kind) => (
					<Choice key={kind} label={t(`send.kind.${kind}`)} value={kind} />
				))}
			</RadioGroup>
			<TextField
				autoComplete="off"
				className="flex max-w-md flex-col gap-1"
				maxLength={MAX_SEARCH_LENGTH}
				onChange={changeQuery}
				type="search"
				value={draft.query}
			>
				<Label className="font-semibold">{t('send.searchLabel')}</Label>
				<Input className={inputClass} />
				<Text className="text-sm text-gray-700" slot="description">
					{t('send.searchHelp')}
				</Text>
			</TextField>
			<div className="flex flex-wrap gap-6">
				{draft.kind === 'partner' ? null : (
					<AreaSelect
						areas={groupOptions}
						label={t('send.groupLabel')}
						onChange={changeGroup}
						value={draft.group === null ? ANY : `${VALUE_PREFIX}${draft.group}`}
					/>
				)}
				{draft.kind === 'member' ? null : (
					<AreaSelect
						areas={tagOptions}
						label={t('send.tagLabel')}
						onChange={changeTag}
						value={draft.tag === null ? ANY : `${VALUE_PREFIX}${draft.tag}`}
					/>
				)}
			</div>
		</>
	);
}

/**
 * One picked contact with its button that removes it.
 *
 * @param props The props.
 * @param props.contact The contact.
 * @param props.onRemove Called when it is removed.
 * @returns The list item.
 */
function ChosenContact({
	contact,
	onRemove,
}: Readonly<{
	contact: Readonly<RecipientChoice>;
	onRemove: (contact: Readonly<RecipientChoice>) => void;
}>): ReactNode {
	const t = useT();
	const remove = useCallback(() => {
		onRemove(contact);
	}, [contact, onRemove]);
	return (
		<li className="flex items-center justify-between gap-4">
			<span>
				{t('send.pickOption', {
					kind: t(`send.contactKind.${contact.kind}`),
					name: contact.name,
				})}
			</span>
			<Button
				aria-label={t('send.chosenRemove', { name: contact.name })}
				className={secondaryButtonClass}
				onPress={remove}
			>
				<CloseIcon />
			</Button>
		</li>
	);
}

/**
 * The contacts picked one by one: the search that adds one, and the list with a button per contact
 * that removes it again.
 *
 * @param props The props.
 * @param props.announce Announces in the page's live region.
 * @param props.draft The step's state.
 * @param props.occasionId The occasion.
 * @param props.onChange Called with the changed state.
 * @returns The fields.
 */
function SingleFields({
	announce,
	draft,
	occasionId,
	onChange,
}: Readonly<{
	announce: Announce;
	draft: SelectionDraft;
	occasionId: string;
	onChange: (draft: SelectionDraft) => void;
}>): ReactNode {
	const t = useT();
	const add = useCallback(
		(contact: Readonly<RecipientChoice>) => {
			onChange({ ...draft, chosen: addChosen(draft.chosen, contact) });
			announce(t('send.added', { name: contact.name }), 'status');
		},
		[announce, draft, onChange, t],
	);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const remove = useCallback(
		(contact: Readonly<RecipientChoice>) => {
			onChange({ ...draft, chosen: removeChosen(draft.chosen, contact.id) });
			announce(t('send.removed', { name: contact.name }), 'status');
			// The pressed button is gone: the focus goes to the list's heading.
			headingRef.current?.focus();
		},
		[announce, draft, onChange, t],
	);
	return (
		<>
			<RecipientPicker
				announce={announce}
				help={t('send.pickHelp')}
				label={t('send.pickLabel')}
				occasionId={occasionId}
				onPick={add}
				picked={null}
				selection={EVERY_CONTACT}
			/>
			<section aria-labelledby="send-chosen" className="flex flex-col gap-2">
				<h3 className="font-semibold outline-none" id="send-chosen" ref={headingRef} tabIndex={-1}>
					{t('send.chosenLabel')}
				</h3>
				{draft.chosen.length === 0 ? (
					<p>{t('send.chosenEmpty')}</p>
				) : (
					<ul className="flex max-w-xl flex-col gap-2">
						{draft.chosen.map((contact) => (
							<ChosenContact contact={contact} key={contact.id} onRemove={remove} />
						))}
					</ul>
				)}
			</section>
		</>
	);
}

/**
 * The first step of the send flow (Design 10.1): every contact of a kind that the search and the
 * filters find, or contacts picked one by one. Below, the numbers of the wave as the server counts
 * them, in a live region.
 *
 * @param props The props.
 * @param props.announce Announces in the page's live region.
 * @param props.draft The step's state.
 * @param props.groups The groups of the members.
 * @param props.occasionId The occasion.
 * @param props.onChange Called with the changed state.
 * @param props.summary The numbers of the wave.
 * @param props.tags The tags of the partners.
 * @returns The step.
 */
export function RecipientStep({
	announce,
	draft,
	groups,
	occasionId,
	onChange,
	summary,
	tags,
}: Readonly<{
	announce: Announce;
	draft: SelectionDraft;
	groups: readonly string[];
	occasionId: string;
	onChange: (draft: SelectionDraft) => void;
	summary: SummaryState;
	tags: readonly string[];
}>): ReactNode {
	const t = useT();
	const changeMode = useCallback(
		(value: string) => {
			const mode = MODES.find((entry) => entry === value);
			if (mode !== undefined) onChange({ ...draft, mode });
		},
		[draft, onChange],
	);
	return (
		<div className="flex flex-col gap-6">
			<RadioGroup className="flex flex-col gap-2" onChange={changeMode} value={draft.mode}>
				<Label className="font-semibold">{t('send.modeLabel')}</Label>
				{MODES.map((mode) => (
					<Choice key={mode} label={t(`send.mode.${mode}`)} value={mode} />
				))}
			</RadioGroup>
			{draft.mode === 'filter' ? (
				<FilterFields draft={draft} groups={groups} onChange={onChange} tags={tags} />
			) : (
				<SingleFields
					announce={announce}
					draft={draft}
					occasionId={occasionId}
					onChange={onChange}
				/>
			)}
			<section aria-labelledby="send-summary" className="flex flex-col gap-2">
				<h3 className="font-semibold" id="send-summary">
					{t('send.summary.label')}
				</h3>
				<WaveSummaryView live state={summary} />
			</section>
		</div>
	);
}
