import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { FieldError, Input, Label, Text, TextField } from 'react-aria-components';

import { inputClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import { isAllowedHref } from '@/mail/blocks/text-doc';

/** The longest link the schema allows. */
const MAX_HREF_LENGTH = 2000;

/**
 * A link field of a block. The template only takes an address it may use (`https:`, `mailto:`,
 * `tel:`) or none; anything else stays in the field with a message once the field is left, so
 * the editor never holds a link the server would refuse.
 *
 * @param props The props.
 * @param props.label The visible label.
 * @param props.value The stored address, `''` for none.
 * @param props.onChange Called with a usable address, or `''` when the field is empty.
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
	const [invalid, setInvalid] = useState(false);
	const change = useCallback(
		(text: string) => {
			setDraft(text);
			const trimmed = text.trim();
			if (trimmed === '') {
				setInvalid(false);
				onChange('');
			} else if (isAllowedHref(trimmed)) {
				setInvalid(false);
				onChange(trimmed);
			}
		},
		[onChange],
	);
	const blur = useCallback(() => {
		const trimmed = draft.trim();
		setInvalid(trimmed !== '' && !isAllowedHref(trimmed));
	}, [draft]);
	const message = invalid ? t('editor.hrefInvalid') : error;
	return (
		<TextField
			autoComplete="off"
			className="flex flex-col gap-1"
			isInvalid={message !== null}
			isReadOnly={isReadOnly}
			isRequired={isRequired}
			maxLength={MAX_HREF_LENGTH}
			onBlur={blur}
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
