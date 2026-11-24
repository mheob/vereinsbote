import { useServerFn } from '@tanstack/react-start';
import { useCallback, useId, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button, DropZone, FileTrigger, Text } from 'react-aria-components';
import type { FileDropItem, FileTriggerProps } from 'react-aria-components';

import { Announcements, useAnnouncer } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { primaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { uploadImage } from '@/functions/media';
import { useLocale, useT } from '@/i18n/use-t';
import type { MediaRecord } from '@/server/media/media';

import { formatBytes } from './image-size';
import { processImage } from './process-image';

type UploadTarget = Readonly<{ purpose: 'brand' } | { purpose: 'library'; areaId: string }>;

/** What the file chooser offers; the processing checks what really arrives (a drop is not filtered). */
const ACCEPTED_FILE_TYPES = ['image/*'];

const dropZoneClass =
	'flex flex-col items-start gap-3 rounded-md border-2 border-dashed border-gray-600 p-6 data-drop-target:border-blue-700 data-drop-target:bg-blue-50 data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700';

/**
 * Builds the upload form the server function reads.
 *
 * @param file The image to upload.
 * @param target The brand, or the library of an area.
 * @returns The form data: file, purpose and, for the library, the area.
 */
function uploadForm(file: File, target: UploadTarget): FormData {
	const form = new FormData();
	form.set('file', file);
	form.set('purpose', target.purpose);
	if (target.purpose === 'library') form.set('areaId', target.areaId);
	return form;
}

/**
 * Chooses or receives one image, scales it down in the browser (at most 1200 px wide, EXIF
 * rotation applied, metadata removed) and uploads it. Both the button and the drop zone work
 * with the keyboard; what happens is announced in a live region, a refusal as an alert.
 *
 * @param props The props.
 * @param props.target A brand logo (admin) or an image of an area's library.
 * @param props.allowSvg Whether an SVG is accepted (the brand's logo).
 * @param props.onUploaded Called with the stored image.
 * @returns The upload field.
 */
export function ImageUpload({
	allowSvg,
	onUploaded,
	target,
}: Readonly<{
	target: UploadTarget;
	allowSvg: boolean;
	onUploaded: (media: Readonly<MediaRecord>) => void;
}>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const helpId = useId();
	const upload = useServerFn(uploadImage);
	const [announcement, announce] = useAnnouncer();
	const [isPending, startPending] = useTransition();
	// Until hydration a press would open no file chooser: the button is pending, like `SubmitButton`.
	const hydrated = useHydrated();
	const targetPurpose = target.purpose;
	const targetAreaId = target.purpose === 'library' ? target.areaId : null;

	const handle = useCallback(
		async (file: File) => {
			announce(t('imageUpload.processing'), 'status');
			const result = await processImage(file, { allowSvg });
			if (!result.ok) {
				announce(t(`imageUpload.${result.reason}`), 'alert');
				return;
			}
			const stored = new File([result.blob], result.name, { type: result.blob.type });
			const form = uploadForm(
				stored,
				targetPurpose === 'brand'
					? { purpose: 'brand' }
					: { areaId: targetAreaId ?? '', purpose: 'library' },
			);
			const outcome = await settle(upload({ data: form }));
			if (outcome === undefined) return;
			if (outcome === FAILED) {
				announce(t('imageUpload.failed'), 'alert');
				return;
			}
			if (!outcome.ok) {
				announce(t(`imageUpload.${outcome.failure}`), 'alert');
				return;
			}
			const parts = [
				t('imageUpload.resized', {
					after: formatBytes(result.after, locale),
					before: formatBytes(result.before, locale),
				}),
				...(result.flattenedGif ? [t('imageUpload.flattenedGif')] : []),
				t('imageUpload.uploaded'),
			];
			announce(parts.join('. '), 'status');
			onUploaded(outcome.media);
		},
		[allowSvg, announce, locale, onUploaded, t, targetAreaId, targetPurpose, upload],
	);

	const onSelect = useCallback<NonNullable<FileTriggerProps['onSelect']>>(
		(files) => {
			const file = files?.item(0);
			if (file !== null && file !== undefined) startPending(async () => handle(file));
		},
		[handle],
	);
	const onDrop = useCallback(
		(event: Readonly<{ items: readonly Readonly<{ kind: string }>[] }>) => {
			const item = event.items.find((entry): entry is FileDropItem => entry.kind === 'file');
			if (item !== undefined) startPending(async () => handle(await item.getFile()));
		},
		[handle],
	);
	const getDropOperation = useCallback(() => 'copy' as const, []);
	return (
		<div className="flex flex-col gap-3">
			<DropZone className={dropZoneClass} getDropOperation={getDropOperation} onDrop={onDrop}>
				<Text slot="label">{t('imageUpload.dropZone')}</Text>
				<FileTrigger acceptedFileTypes={ACCEPTED_FILE_TYPES} onSelect={onSelect}>
					<Button
						aria-describedby={helpId}
						className={primaryButtonClass}
						isPending={!hydrated || isPending}
					>
						{t('imageUpload.chooseFile')}
					</Button>
				</FileTrigger>
				<p className="text-sm text-gray-700" id={helpId}>
					{t(allowSvg ? 'imageUpload.helpSvg' : 'imageUpload.help')}
				</p>
			</DropZone>
			<Announcements announcement={announcement} />
		</div>
	);
}
