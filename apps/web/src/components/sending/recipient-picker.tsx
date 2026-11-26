import { useServerFn } from '@tanstack/react-start';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ComboBox, Input, Label, ListBox, ListBoxItem, Popover, Text } from 'react-aria-components';
import type { Key } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { inputClass, optionClass, popoverClass } from '@/components/styles';
import { useDebouncedValue } from '@/components/use-debounced-value';
import { searchRecipients } from '@/functions/waves';
import { useT } from '@/i18n/use-t';
import { MAX_SEARCH_LENGTH } from '@/server/contacts/list-query';
import type { RecipientChoice } from '@/server/waves/recipient-search';
import type { RecipientSelection } from '@/server/waves/recipients';

import { selectionRequest } from './selection';

/** How long the search waits after the last key. */
const SEARCH_DELAY_MS = 300;

const KIND_LABELS = {
	member: 'send.contactKind.member',
	partner: 'send.contactKind.partner',
} as const;

/**
 * The contacts a search found, with the picked one kept in the list, so that the box can show it
 * while a new search is on its way.
 *
 * @param found What the search found.
 * @param picked The picked contact.
 * @returns The contacts.
 */
function withPicked(
	found: readonly Readonly<RecipientChoice>[],
	picked: Readonly<RecipientChoice> | null,
): readonly Readonly<RecipientChoice>[] {
	if (picked === null || found.some(({ id }) => id === picked.id)) return found;
	return [picked, ...found];
}

/**
 * The search over the contacts of a selection: after a pause in typing the term goes to the server
 * by POST, never into a URL. An answer that a later search overtook is dropped.
 *
 * @param occasionId The occasion.
 * @param selection The selection to search in.
 * @param term The term as typed.
 * @param announce Announces a failed search.
 * @returns The contacts found for the latest term.
 */
// oxlint-disable-next-line max-params -- the occasion, the selection, the term and the announcer
function useRecipientSearch(
	occasionId: string,
	selection: RecipientSelection,
	term: string,
	announce: Announce,
): readonly Readonly<RecipientChoice>[] {
	const t = useT();
	const search = useServerFn(searchRecipients);
	const [found, setFound] = useState<readonly Readonly<RecipientChoice>[]>([]);
	const query = useDebouncedValue(term, SEARCH_DELAY_MS);
	useEffect(() => {
		let current = true;
		async function run(): Promise<void> {
			const data = { occasionId, selection: selectionRequest(selection), term: query };
			const result = await settle(search({ data }));
			if (!current || result === undefined) return;
			if (result === FAILED) announce(t('auth.requestFailed'), 'alert');
			else if (result.ok) setFound(result.contacts);
			else setFound([]);
		}
		// oxlint-disable-next-line no-void -- `run` never rejects: `settle` catches a failed call
		void run();
		return () => {
			current = false;
		};
	}, [announce, occasionId, query, search, selection, t]);
	return found;
}

/**
 * A box that finds a contact of a selection: to pick recipients one by one, or the contact the
 * preview shows. Each option names the contact and its kind.
 *
 * @param props The props.
 * @param props.announce Announces in the page's live region.
 * @param props.help The description below the box.
 * @param props.label The label of the box.
 * @param props.occasionId The occasion.
 * @param props.onPick Called with the contact the user picked.
 * @param props.picked The contact the box shows, or null: it empties after each pick.
 * @param props.selection The selection to search in.
 * @returns The combo box.
 */
export function RecipientPicker({
	announce,
	help,
	label,
	occasionId,
	onPick,
	picked,
	selection,
}: Readonly<{
	announce: Announce;
	help: string;
	label: string;
	occasionId: string;
	onPick: (contact: Readonly<RecipientChoice>) => void;
	picked: Readonly<RecipientChoice> | null;
	selection: RecipientSelection;
}>): ReactNode {
	const t = useT();
	const [input, setInput] = useState(picked?.name ?? '');
	// A picked name in the box is no search term: the list stays as it was.
	const term = input === picked?.name ? '' : input;
	const found = useRecipientSearch(occasionId, selection, term, announce);
	const items = useMemo(() => withPicked(found, picked), [found, picked]);
	const select = useCallback(
		(key: Key | null) => {
			const contact = items.find(({ id }) => id === key);
			if (contact === undefined) return;
			onPick(contact);
			// Without a contact to show the box empties for the next search.
			if (picked === null) setInput('');
		},
		[items, onPick, picked],
	);
	const renderEmpty = useCallback(
		() => <span className="block px-3 py-1.5">{t('send.pickNone')}</span>,
		[t],
	);
	return (
		<ComboBox
			allowsEmptyCollection
			className="flex max-w-md flex-col gap-1"
			inputValue={input}
			items={items}
			menuTrigger="focus"
			onChange={select}
			onInputChange={setInput}
			value={picked?.id ?? null}
		>
			<Label className="font-semibold">{label}</Label>
			<Input autoComplete="off" className={inputClass} maxLength={MAX_SEARCH_LENGTH} />
			<Text className="text-sm text-gray-700" slot="description">
				{help}
			</Text>
			<Popover className={popoverClass}>
				<ListBox className="max-h-60 overflow-auto outline-none" renderEmptyState={renderEmpty}>
					{(item: Readonly<RecipientChoice>) => (
						<ListBoxItem className={optionClass} id={item.id} textValue={item.name}>
							{t('send.pickOption', { kind: t(KIND_LABELS[item.kind]), name: item.name })}
						</ListBoxItem>
					)}
				</ListBox>
			</Popover>
		</ComboBox>
	);
}
