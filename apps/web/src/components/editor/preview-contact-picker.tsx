import { useServerFn } from '@tanstack/react-start';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ComboBox, Input, Label, ListBox, ListBoxItem, Popover, Text } from 'react-aria-components';
import type { Key } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { inputClass, optionClass, popoverClass } from '@/components/styles';
import { useDebouncedValue } from '@/components/use-debounced-value';
import { searchPreviewContacts } from '@/functions/templates';
import { useT } from '@/i18n/use-t';
import type { PreviewContact } from '@/server/templates/preview-values';

/** How long the search waits after the last key. */
const SEARCH_DELAY_MS = 300;

const KIND_LABELS = {
	member: 'editor.previewContactKind.member',
	partner: 'editor.previewContactKind.partner',
} as const;

/**
 * The contacts a search found, with the picked one kept in the list so that the box can show it
 * while a new search is on its way.
 *
 * @param found What the search found.
 * @param picked The picked contact.
 * @returns The contacts.
 */
function withPicked(
	found: readonly Readonly<PreviewContact>[],
	picked: Readonly<PreviewContact> | null,
): readonly Readonly<PreviewContact>[] {
	if (picked === null || found.some(({ id }) => id === picked.id)) return found;
	return [picked, ...found];
}

/**
 * The search for the contacts of a template's preview: after a pause in typing the term goes to
 * the server by POST, never into a URL. An answer a later search overtook is dropped.
 *
 * @param templateId The template.
 * @param term The term as typed; empty for the first contacts.
 * @param announce Announces a failed search.
 * @returns The contacts found for the latest term.
 */
function useContactSearch(
	templateId: string,
	term: string,
	announce: Announce,
): readonly Readonly<PreviewContact>[] {
	const t = useT();
	const search = useServerFn(searchPreviewContacts);
	const [found, setFound] = useState<readonly Readonly<PreviewContact>[]>([]);
	const query = useDebouncedValue(term, SEARCH_DELAY_MS);
	useEffect(() => {
		let current = true;
		async function run(): Promise<void> {
			const result = await settle(search({ data: { query, templateId } }));
			if (!current || result === undefined) return;
			if (result === FAILED) announce(t('auth.requestFailed'), 'alert');
			else setFound(result.contacts);
		}
		// oxlint-disable-next-line no-void -- `run` never rejects: `settle` catches a failed call
		void run();
		return () => {
			current = false;
		};
	}, [announce, query, search, t, templateId]);
	return found;
}

/**
 * The box that finds a real contact for the preview.
 *
 * @param props The props.
 * @param props.templateId The template; the search is limited to what its area may see.
 * @param props.picked The picked contact, or null.
 * @param props.onPick Called with the contact the user picked.
 * @param props.announce Announces in the page's live region.
 * @returns The combo box.
 */
export function PreviewContactPicker({
	announce,
	onPick,
	picked,
	templateId,
}: Readonly<{
	templateId: string;
	picked: Readonly<PreviewContact> | null;
	onPick: (contact: Readonly<PreviewContact>) => void;
	announce: Announce;
}>): ReactNode {
	const t = useT();
	const [input, setInput] = useState(picked?.name ?? '');
	// A picked name in the box is no search term: the list stays as it was.
	const term = input === picked?.name ? '' : input;
	const found = useContactSearch(templateId, term, announce);
	const items = useMemo(() => withPicked(found, picked), [found, picked]);
	const select = useCallback(
		(key: Key | null) => {
			const contact = items.find(({ id }) => id === key);
			if (contact !== undefined) onPick(contact);
		},
		[items, onPick],
	);
	const renderEmpty = useCallback(
		() => <span className="block px-3 py-1.5">{t('editor.previewContactNone')}</span>,
		[t],
	);
	return (
		<ComboBox
			allowsEmptyCollection
			className="flex max-w-sm flex-col gap-1"
			inputValue={input}
			items={items}
			menuTrigger="focus"
			onInputChange={setInput}
			onChange={select}
			value={picked?.id ?? null}
		>
			<Label className="font-semibold">{t('editor.previewContactSearch')}</Label>
			<Input className={inputClass} />
			<Text className="text-sm text-gray-700" slot="description">
				{t('editor.previewContactSearchHelp')}
			</Text>
			<Popover className={popoverClass}>
				<ListBox className="max-h-60 overflow-auto outline-none" renderEmptyState={renderEmpty}>
					{(item: Readonly<PreviewContact>) => (
						<ListBoxItem className={optionClass} id={item.id} textValue={item.name}>
							{t('editor.previewContactOption', {
								kind: t(KIND_LABELS[item.kind]),
								name: item.name,
							})}
						</ListBoxItem>
					)}
				</ListBox>
			</Popover>
		</ComboBox>
	);
}
