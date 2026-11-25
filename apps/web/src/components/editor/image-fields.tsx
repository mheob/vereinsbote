import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	CheckboxButton,
	CheckboxField,
	FieldError,
	Input,
	Label,
	Text,
	TextField,
} from 'react-aria-components';

import { CheckIcon } from '@/components/icons';
import { ImagePickerDialog } from '@/components/images/image-picker-dialog';
import {
	checkboxBoxClass,
	checkboxClass,
	inputClass,
	secondaryButtonClass,
} from '@/components/styles';
import { useT } from '@/i18n/use-t';
import type { ImageBlock } from '@/mail/blocks/block-schema';
import { mediaPath } from '@/server/media/ids';
import type { MediaRecord } from '@/server/media/media';

import type { EditorView } from './editor-view';
import { HrefField } from './href-field';

const MAX_ALT_LENGTH = 500;

/**
 * The fields of an image: the image of the area's library, its alt text or „dekorativ“, and an
 * optional link.
 *
 * @param props The props.
 * @param props.block The image block.
 * @param props.view The editor's state and actions.
 * @returns The fields.
 */
export function ImageFields({
	block,
	view,
}: Readonly<{ block: ImageBlock; view: EditorView }>): ReactNode {
	const t = useT();
	const { actions } = view;
	const [isOpen, setIsOpen] = useState(false);
	const media = block.mediaId === null ? undefined : view.media.get(block.mediaId);
	const open = useCallback(() => {
		setIsOpen(true);
	}, []);
	const choose = useCallback(
		(chosen: Readonly<MediaRecord>) => {
			const { height, id, name, type, width } = chosen;
			actions.addMedia(id, { height, name, type, width });
			actions.update({ ...block, mediaId: id });
		},
		[actions, block],
	);
	const changeAlt = useCallback(
		(alt: string) => {
			actions.update({ ...block, alt });
		},
		[actions, block],
	);
	const changeDecorative = useCallback(
		(decorative: boolean) => {
			actions.update({ ...block, decorative });
		},
		[actions, block],
	);
	const changeHref = useCallback(
		(href: string) => {
			actions.update({ ...block, href: href === '' ? null : href });
		},
		[actions, block],
	);
	const mediaError = view.problems.byField.get(`media.${block.id}`) ?? null;
	const altError = view.problems.byField.get(`alt.${block.id}`) ?? null;
	return (
		<>
			<div className="flex flex-col gap-2">
				{media === undefined || block.mediaId === null ? (
					<p>{t('editor.imageNone')}</p>
				) : (
					<div className="flex items-center gap-3">
						<img
							alt=""
							className="h-24 w-32 rounded-sm bg-gray-100 object-contain"
							height={media.height}
							src={mediaPath(block.mediaId, media.type)}
							width={media.width}
						/>
						<p>{t('editor.imageChosen', { name: media.name })}</p>
					</div>
				)}
				{view.isReadOnly ? null : (
					<Button
						className={`self-start ${secondaryButtonClass}`}
						data-problem-focus={`media.${block.id}`}
						onPress={open}
					>
						{t('imagePicker.open')}
					</Button>
				)}
				{mediaError === null ? null : <p className="text-sm text-red-700">{mediaError}</p>}
			</div>
			<TextField
				autoComplete="off"
				className="flex flex-col gap-1"
				isDisabled={block.decorative}
				isInvalid={altError !== null}
				isReadOnly={view.isReadOnly}
				maxLength={MAX_ALT_LENGTH}
				onChange={changeAlt}
				validationBehavior="aria"
				value={block.alt}
			>
				<Label className="font-semibold">{t('editor.alt')}</Label>
				<Input className={inputClass} data-problem-focus={`alt.${block.id}`} />
				<Text className="text-sm text-gray-700" slot="description">
					{t('editor.altHelp')}
				</Text>
				<FieldError className="text-sm text-red-700">{altError}</FieldError>
			</TextField>
			<CheckboxField
				isReadOnly={view.isReadOnly}
				isSelected={block.decorative}
				onChange={changeDecorative}
			>
				<CheckboxButton className={checkboxClass}>
					{({ isSelected }) => (
						<>
							<span className={checkboxBoxClass}>{isSelected ? <CheckIcon /> : null}</span>
							{t('editor.decorative')}
						</>
					)}
				</CheckboxButton>
			</CheckboxField>
			<HrefField
				error={null}
				focusKey={`href.${block.id}`}
				isReadOnly={view.isReadOnly}
				isRequired={false}
				label={t('editor.imageHref')}
				onChange={changeHref}
				value={block.href ?? ''}
			/>
			{view.isReadOnly ? null : (
				<ImagePickerDialog
					areaId={view.areaId}
					isOpen={isOpen}
					onOpenChange={setIsOpen}
					onSelect={choose}
				/>
			)}
		</>
	);
}
