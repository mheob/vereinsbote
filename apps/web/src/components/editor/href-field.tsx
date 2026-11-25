import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { FieldError, Input, Label, Text, TextField } from 'react-aria-components';

import { inputClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';

import { hrefDraft } from './href-draft';

/** The longest link the schema allows. */
const MAX_HREF_LENGTH = 2000;

/**
 * A link field of a block. The template only takes an address it may use (`https:`, `mailto:`,
 * `tel:`) or none; anything else stays in the field with a message at once and clears the block's
 * link, so the editor never holds a link the server would refuse nor a stale one.
 *
 * @param props The props.
 * @param props.label The visible label.
 * @param props.value The stored address, `''` for none.
 * @param props.onChange Called with a usable address, or `''` when the field is empty or its text is no usable address.
 * @param props.isRequired Whether the block needs a link.
 * @param props.isReadOnly Whether the field is read-only.
 * @param props.error The message of a refusal of the save checks, or null.
 * @param props.focusKey The key of the editor's problem jump.
 * @returns The field.
 */
export function HrefField({
	error,
	focusKey,
	isReadOnly,
	isRequired,
	label,
	onChange,
	value,
}: Readonly<{
	label: string;
	value: string;
	onChange: (href: string) => void;
	isRequired: boolean;
	isReadOnly: boolean;
	error: string | null;
	focusKey: string;
}>): ReactNode {
	const t = useT();
	const [draft, setDraft] = useState(value);
	const { invalid } = hrefDraft(draft);
	const change = useCallback(
		(text: string) => {
			setDraft(text);
			// Text that is no usable address clears the block's link: the block never keeps the
			// previous valid address behind a field that shows something else.
			onChange(hrefDraft(text).href);
		},
		[onChange],
	);
	const message = invalid ? t('editor.hrefInvalid') : error;
	return (
		<TextField
			autoComplete="off"
			className="flex flex-col gap-1"
			isInvalid={message !== null}
			isReadOnly={isReadOnly}
			isRequired={isRequired}
			maxLength={MAX_HREF_LENGTH}
			onChange={change}
			type="url"
			validationBehavior="aria"
			value={draft}
		>
			<Label className="font-semibold">{label}</Label>
			<Input className={inputClass} data-problem-focus={focusKey} />
			<Text className="text-sm text-gray-700" slot="description">
				{t('editor.hrefHelp')}
			</Text>
			<FieldError className="text-sm text-red-700">{message}</FieldError>
		</TextField>
	);
}
