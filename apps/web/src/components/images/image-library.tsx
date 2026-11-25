import { startTransition, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	GridList,
	GridListItem,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
} from 'react-aria-components';
import type { Key } from 'react-aria-components';

import { Announcements, useAnnouncer } from '@/components/announcements';
import { ChevronIcon } from '@/components/icons';
import { optionClass, popoverClass, selectButtonClass } from '@/components/styles';
import type { LibraryPage } from '@/functions/images';
import { useT } from '@/i18n/use-t';

import { DeleteImageDialog } from './delete-image-dialog';
import { imageGridClass, ImageSummary, imageItemClass } from './image-summary';
import { ImageUpload } from './image-upload';
import { RenameImageDialog } from './rename-image-dialog';
import { useLibrary } from './use-library';

/**
 * The image library of the areas a user may read: an area select, the upload for editors and
 * the images as a grid list with rename and delete. Every change reloads the area and is
 * announced in a live region; after a deletion the focus moves to the list's heading.
 *
 * @param props The props.
 * @param props.initial What the route's loader loaded.
 * @returns The library.
 */
export function ImageLibrary({ initial }: Readonly<{ initial: Readonly<LibraryPage> }>): ReactNode {
	const t = useT();
	const { failed, loading, page, reload } = useLibrary(initial);
	const [announcement, announce] = useAnnouncer();
	const headingRef = useRef<HTMLHeadingElement>(null);
	const current = page ?? initial;
	const areaId = current.areaId ?? undefined;
	const area = current.areas.find(({ id }) => id === areaId);
	const target = useMemo(() => ({ areaId: areaId ?? '', purpose: 'library' as const }), [areaId]);
	const emptyState = useCallback(() => <p>{t('images.empty')}</p>, [t]);
	const onAreaChange = useCallback(
		(key: Key | null) => {
			if (typeof key === 'string') startTransition(async () => reload(key));
		},
		[reload],
	);
	const onUploaded = useCallback(() => {
		startTransition(async () => reload(areaId));
	}, [areaId, reload]);
	const onChanged = useCallback(
		(deletedName: string | null) => {
			startTransition(async () => {
				await reload(areaId);
				if (deletedName !== null) headingRef.current?.focus();
			});
		},
		[areaId, reload],
	);
	const onRenamed = useCallback(() => {
		onChanged(null);
	}, [onChanged]);
	if (area === undefined) return <p>{t('images.forbiddenText')}</p>;
	return (
		<div className="flex flex-col gap-6">
			<Select className="flex max-w-sm flex-col gap-1" onChange={onAreaChange} value={area.id}>
				<Label className="font-semibold">{t('images.areaLabel')}</Label>
				<Button className={selectButtonClass}>
					<SelectValue />
					<ChevronIcon />
				</Button>
				<Popover className={popoverClass}>
					<ListBox className="outline-none">
						{current.areas.map(({ id, name }) => (
							<ListBoxItem className={optionClass} id={id} key={id}>
								{name}
							</ListBoxItem>
						))}
					</ListBox>
				</Popover>
			</Select>
			{current.storageReady ? null : (
				<div className="rounded-md border border-gray-600 p-4" role="note">
					<p className="font-semibold">{t('images.storageMissing')}</p>
					<p>{t('images.storageMissingText')}</p>
				</div>
			)}
			{area.canEdit && current.storageReady ? (
				<ImageUpload allowSvg={false} onUploaded={onUploaded} target={target} />
			) : null}
			<Announcements announcement={announcement} />
			{failed ? (
				<p className="text-red-700" role="alert">
					{t('auth.requestFailed')}
				</p>
			) : null}
			<h2 className="text-lg font-semibold outline-none" ref={headingRef} tabIndex={-1}>
				{t('images.listLabel', { area: area.name })}
			</h2>
			<GridList
				aria-busy={loading}
				aria-label={t('images.listLabel', { area: area.name })}
				className={imageGridClass}
				layout="grid"
				renderEmptyState={emptyState}
			>
				{current.images.map((image) => (
					<GridListItem
						className={imageItemClass}
						id={image.id}
						key={image.id}
						textValue={image.name}
					>
						<ImageSummary image={image} />
						{area.canEdit ? (
							<div className="flex flex-wrap gap-3">
								<RenameImageDialog announce={announce} image={image} onChanged={onRenamed} />
								<DeleteImageDialog announce={announce} image={image} onChanged={onChanged} />
							</div>
						) : null}
					</GridListItem>
				))}
			</GridList>
		</div>
	);
}
