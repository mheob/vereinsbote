import { useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	ComboBox,
	FieldError,
	Input,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Tag,
	TagGroup,
	TagList,
	Text,
} from 'react-aria-components';
import type { Key } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { CloseIcon } from '@/components/icons';
import { inputClass, optionClass, popoverClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import { MAX_TAG_LENGTH } from '@/server/contacts/partner-form';

import { tagSuggestionsFor, withTag } from './partner-input';

const tagClass =
	'flex items-center gap-1 rounded-full border border-gray-600 py-0.5 pr-1 pl-3 outline-none data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700';
const removeClass =
	'flex size-6 items-center justify-center rounded-full data-focus-visible:outline-2 data-focus-visible:outline-blue-700 data-hovered:bg-gray-100';

/**
 * The tags of a partner: the list with a remove button per tag and the input „Schlagwort
 * hinzufügen“ with suggestions from the tags of all partners. Enter takes the typed text or the
 * chosen suggestion; a tag matching an existing one ignoring case takes its spelling. Each change
 * is announced, and when the last tag goes the focus moves to the input.
 *
 * @param props The props.
 * @param props.announce Announces a change in the page's live region.
 * @param props.errorMessage The message of a refused tag list, if any.
 * @param props.input The typed text.
 * @param props.onChange Called with the new tags.
 * @param props.onInputChange Called with the typed text.
 * @param props.suggestions The tags of all partners, in the spelling that counts.
 * @param props.tags The tags.
 * @returns The field.
 */
export function TagField({
	announce,
	errorMessage,
	input,
	onChange,
	onInputChange,
	suggestions,
	tags,
}: Readonly<{
	announce: Announce;
	errorMessage: string | undefined;
	input: string;
	onChange: (tags: readonly string[]) => void;
	onInputChange: (input: string) => void;
	suggestions: readonly string[];
	tags: readonly string[];
}>): ReactNode {
	const t = useT();
	// Set while a suggestion is being picked: when Enter picked it, the same key press must not
	// add the typed text as well. React Aria picks it before this field's key handler runs.
	const picked = useRef(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const items = useMemo(
		() => tagSuggestionsFor(suggestions, tags, input).map((tag) => ({ id: tag })),
		[input, suggestions, tags],
	);
	const tagItems = useMemo(() => tags.map((tag) => ({ id: tag })), [tags]);
	const add = useCallback(
		(text: string) => {
			const next = withTag(tags, text, suggestions);
			onInputChange('');
			const added = next.find(
				(tag) => !tags.some((old) => old.toLowerCase() === tag.toLowerCase()),
			);
			if (added === undefined) return;
			onChange(next);
			announce(t('partner.tagAdded', { tag: added }), 'status');
		},
		[announce, onChange, onInputChange, suggestions, t, tags],
	);
	const onPick = useCallback(
		(key: Key | null) => {
			if (key === null) return;
			picked.current = true;
			queueMicrotask(() => {
				picked.current = false;
			});
			add(String(key));
		},
		[add],
	);
	const onKeyDown = useCallback(
		(event: Readonly<{ key: string; preventDefault: () => void }>) => {
			if (event.key !== 'Enter') return;
			// Enter in this input adds a tag; it never submits the form.
			event.preventDefault();
			if (!picked.current) add(input);
		},
		[add, input],
	);
	const onRemove = useCallback(
		(keys: ReadonlySet<Key>) => {
			const next = tags.filter((tag) => !keys.has(tag));
			onChange(next);
			for (const tag of tags.filter((old) => keys.has(old))) {
				announce(t('partner.tagRemoved', { tag }), 'status');
			}
			if (next.length === 0) inputRef.current?.focus();
		},
		[announce, onChange, t, tags],
	);
	const renderEmptyState = useCallback(
		() => <span className="text-gray-700">{t('partner.noTags')}</span>,
		[t],
	);
	return (
		<div className="flex flex-col gap-3">
			<TagGroup className="flex flex-col gap-1" onRemove={onRemove}>
				<Label className="font-semibold">{t('partner.tags')}</Label>
				<TagList
					className="flex flex-wrap gap-2"
					items={tagItems}
					renderEmptyState={renderEmptyState}
				>
					{(item) => (
						<Tag className={tagClass} id={item.id} textValue={item.id}>
							{item.id}
							<Button className={removeClass} slot="remove">
								<CloseIcon />
							</Button>
						</Tag>
					)}
				</TagList>
			</TagGroup>
			<ComboBox
				allowsCustomValue
				className="flex flex-col gap-1"
				data-field="tags"
				inputValue={input}
				isInvalid={errorMessage !== undefined}
				items={items}
				onInputChange={onInputChange}
				onChange={onPick}
				onKeyDown={onKeyDown}
				// Nothing stays picked: a picked suggestion becomes a tag, and the input is empty again.
				value={null}
			>
				<Label className="font-semibold">{t('partner.addTag')}</Label>
				<Input className={inputClass} maxLength={MAX_TAG_LENGTH} ref={inputRef} />
				<Text className="text-sm text-gray-700" slot="description">
					{t('partner.addTagHelp')}
				</Text>
				<FieldError className="text-sm text-red-700">{errorMessage}</FieldError>
				<Popover className={popoverClass}>
					<ListBox className="max-h-60 overflow-auto outline-none">
						{(item: Readonly<{ id: string }>) => (
							<ListBoxItem className={optionClass} id={item.id}>
								{item.id}
							</ListBoxItem>
						)}
					</ListBox>
				</Popover>
			</ComboBox>
		</div>
	);
}
