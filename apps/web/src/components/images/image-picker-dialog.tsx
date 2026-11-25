import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	Dialog,
	GridList,
	GridListItem,
	Heading,
	Modal,
	ModalOverlay,
} from 'react-aria-components';
import type { Selection } from 'react-aria-components';

import { Announcements, useAnnouncer } from '@/components/announcements';
import { primaryButtonClass, secondaryButtonClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import type { MediaRecord } from '@/server/media/media';

import { imageGridClass, ImageSummary, imageItemClass } from './image-summary';
import { ImageUpload } from './image-upload';
import { useLibrary } from './use-library';

const NO_IMAGES: readonly never[] = [];

/**
 * The content of the open dialog. It loads the area's library once and chooses one image; a
 * fresh upload is chosen at once.
 *
 * @param props The props.
 * @param props.areaId The area whose library is shown.
 * @param props.onCancel Called by "Abbrechen".
 * @param props.onSelect Called with the chosen image.
 * @returns The dialog.
 */
function PickerBody({
	areaId,
	onCancel,
	onSelect,
}: Readonly<{
	areaId: string;
	onCancel: () => void;
	onSelect: (media: Readonly<MediaRecord>) => void;
}>): ReactNode {
	const t = useT();
	const { failed, page, reload } = useLibrary(null);
	const [announcement, announce] = useAnnouncer();
	const [selected, setSelected] = useState<string | null>(null);
	useEffect(() => {
		startTransition(async () => reload(areaId));
	}, [areaId, reload]);
	const images = page?.areaId === areaId ? page.images : NO_IMAGES;
	const area = page?.areas.find(({ id }) => id === areaId);
	const onSelectionChange = useCallback((keys: Selection) => {
		const [first] = keys === 'all' ? [] : [...keys];
		setSelected(typeof first === 'string' ? first : null);
	}, []);
	const onUploaded = useCallback(
		(uploaded: Readonly<MediaRecord>) => {
			setSelected(uploaded.id);
			announce(t('images.loaded', { count: images.length + 1 }), 'status');
			startTransition(async () => reload(areaId));
		},
		[announce, areaId, images.length, reload, t],
	);
	const target = useMemo(() => ({ areaId, purpose: 'library' as const }), [areaId]);
	const selectedKeys = useMemo(() => (selected === null ? [] : [selected]), [selected]);
	const emptyState = useCallback(
		() => <p>{page === null ? t('images.loading') : t('images.empty')}</p>,
		[page, t],
	);
	const choose = useCallback(() => {
		const image = images.find(({ id }) => id === selected);
		if (image !== undefined) onSelect(image);
	}, [images, onSelect, selected]);
	return (
		<Dialog className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto outline-none">
			<Heading className="text-xl font-bold" slot="title">
				{t('imagePicker.title')}
			</Heading>
			{page !== null && !page.storageReady ? <p role="note">{t('images.storageMissing')}</p> : null}
			{area?.canEdit === true && page?.storageReady === true ? (
				<section aria-labelledby="picker-upload" className="flex flex-col gap-2">
					<h3 className="font-semibold" id="picker-upload">
						{t('imagePicker.uploadHeading')}
					</h3>
					<ImageUpload allowSvg={false} onUploaded={onUploaded} target={target} />
				</section>
			) : null}
			<Announcements announcement={announcement} />
			{failed ? (
				<p className="text-red-700" role="alert">
					{t('auth.requestFailed')}
				</p>
			) : null}
			<GridList
				aria-label={t('imagePicker.listLabel')}
				className={imageGridClass}
				onSelectionChange={onSelectionChange}
				renderEmptyState={emptyState}
				selectedKeys={selectedKeys}
				selectionMode="single"
			>
				{images.map((image) => (
					<GridListItem
						className={imageItemClass}
						id={image.id}
						key={image.id}
						textValue={image.name}
					>
						<ImageSummary image={image} />
					</GridListItem>
				))}
			</GridList>
			<div className="flex justify-end gap-3">
				<Button className={secondaryButtonClass} onPress={onCancel}>
					{t('imagePicker.cancel')}
				</Button>
				<Button className={primaryButtonClass} isDisabled={selected === null} onPress={choose}>
					{t('imagePicker.choose')}
				</Button>
			</div>
		</Dialog>
	);
}

/**
 * The dialog the editor opens to choose an image of an area's library, or to upload one. It
 * returns the chosen image; closing it (Escape, Cancel, a click outside) returns nothing. React
 * Aria keeps the focus inside and gives it back to the element that opened the dialog.
 *
 * @param props The props.
 * @param props.areaId The area whose library is shown.
 * @param props.isOpen Whether the dialog is open.
 * @param props.onOpenChange Called when the dialog wants to open or close.
 * @param props.onSelect Called with the chosen image; the dialog has asked to close then.
 * @returns The dialog.
 */
export function ImagePickerDialog({
	areaId,
	isOpen,
	onOpenChange,
	onSelect,
}: Readonly<{
	areaId: string;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onSelect: (media: Readonly<MediaRecord>) => void;
}>): ReactNode {
	const close = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);
	const select = useCallback(
		(media: Readonly<MediaRecord>) => {
			onSelect(media);
			onOpenChange(false);
		},
		[onOpenChange, onSelect],
	);
	return (
		<ModalOverlay
			className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
			isDismissable
			isOpen={isOpen}
			onOpenChange={onOpenChange}
		>
			<Modal className="w-full max-w-4xl rounded-md bg-white p-6 shadow-lg">
				<PickerBody areaId={areaId} onCancel={close} onSelect={select} />
			</Modal>
		</ModalOverlay>
	);
}
