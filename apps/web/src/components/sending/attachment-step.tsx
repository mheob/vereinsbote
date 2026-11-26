import { useServerFn } from '@tanstack/react-start';
import { useCallback, useId, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button, FileTrigger } from 'react-aria-components';
import type { FileTriggerProps } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { CloseIcon } from '@/components/icons';
import { formatBytes } from '@/components/images/image-size';
import { FAILED, settle } from '@/components/settle';
import { primaryButtonClass, secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { removeAttachment, uploadAttachment } from '@/functions/waves';
import { useLocale, useT } from '@/i18n/use-t';
import type { AttachmentRecord } from '@/server/attachments/attachments';
import { ATTACHMENT_TYPES } from '@/server/attachments/limits';

import { attachmentFailureMessage } from './send-messages';
import type { SummaryState } from './summary-state';

/** What the file chooser offers; the server checks what really arrives by its content. */
const ACCEPTED_FILE_TYPES = [...ATTACHMENT_TYPES];

/** The last refusal of the field, numbered so that the same text is read again. */
type FieldError = Readonly<{ id: number; text: string }> | null;

/**
 * Builds the upload form the server function reads.
 *
 * @param file The file.
 * @param occasionId The occasion.
 * @returns The form data.
 */
function uploadForm(file: File, occasionId: string): FormData {
	const form = new FormData();
	form.set('file', file);
	form.set('occasionId', occasionId);
	return form;
}

/**
 * One file of the mail with its button that removes it.
 *
 * @param props The props.
 * @param props.attachment The file.
 * @param props.isPending Whether a removal is running.
 * @param props.onRemove Called when it is removed.
 * @returns The list item.
 */
function AttachmentItem({
	attachment,
	isPending,
	onRemove,
}: Readonly<{
	attachment: Readonly<AttachmentRecord>;
	isPending: boolean;
	onRemove: (attachment: Readonly<AttachmentRecord>) => void;
}>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const remove = useCallback(() => {
		onRemove(attachment);
	}, [attachment, onRemove]);
	return (
		<li className="flex items-center justify-between gap-4">
			<span>
				{t('send.attachmentItem', {
					name: attachment.name,
					size: formatBytes(attachment.size, locale),
				})}
			</span>
			<Button
				aria-label={t('send.attachmentRemove', { name: attachment.name })}
				className={secondaryButtonClass}
				isPending={isPending}
				onPress={remove}
			>
				<CloseIcon />
			</Button>
		</li>
	);
}

/**
 * The second step of the send flow (Design 10.2): the files every mail of the wave carries. Each
 * file is uploaded when chosen and checked by its content on the server; a refusal shows at the
 * button. With a Graph sender the step says how little fits and warns as soon as the files are too
 * large for a Graph request (Design 6.4).
 *
 * @param props The props.
 * @param props.announce Announces in the page's live region.
 * @param props.attachments The files of the mail.
 * @param props.graph Whether the sender sends through Microsoft Graph.
 * @param props.occasionId The occasion.
 * @param props.onAdded Called with a stored file.
 * @param props.onRemoved Called with the id of a removed (or gone) file.
 * @param props.summary The numbers of the wave, which say whether Graph takes the files.
 * @returns The step.
 */
export function AttachmentStep({
	announce,
	attachments,
	graph,
	occasionId,
	onAdded,
	onRemoved,
	summary,
}: Readonly<{
	announce: Announce;
	attachments: readonly Readonly<AttachmentRecord>[];
	graph: boolean;
	occasionId: string;
	onAdded: (attachment: Readonly<AttachmentRecord>) => void;
	onRemoved: (id: string) => void;
	summary: SummaryState;
}>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const helpId = useId();
	const errorId = useId();
	const upload = useServerFn(uploadAttachment);
	const remove = useServerFn(removeAttachment);
	const [isPending, startPending] = useTransition();
	const [error, setError] = useState<FieldError>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const refuse = useCallback((text: string) => {
		setError((previous) => ({ id: (previous?.id ?? 0) + 1, text }));
	}, []);
	const store = useCallback(
		async (file: File) => {
			announce(t('send.attachmentUploading', { name: file.name }), 'status');
			const result = await settle(upload({ data: uploadForm(file, occasionId) }));
			if (result === undefined) return;
			if (result === FAILED) refuse(t('send.attachmentFailed'));
			else if (result.ok) {
				onAdded(result.attachment);
				announce(t('send.attachmentUploaded', { name: result.attachment.name }), 'status');
			} else refuse(t(attachmentFailureMessage(result)));
		},
		[announce, occasionId, onAdded, refuse, t, upload],
	);
	const onSelect = useCallback<NonNullable<FileTriggerProps['onSelect']>>(
		(files) => {
			const chosen = [...(files ?? [])];
			if (chosen.length === 0) return;
			setError(null);
			startPending(async () => {
				for (const file of chosen) {
					// oxlint-disable-next-line no-await-in-loop -- one upload at a time: the server counts the room
					await store(file);
				}
			});
		},
		[store],
	);
	const onRemove = useCallback(
		(attachment: Readonly<AttachmentRecord>) => {
			setError(null);
			startPending(async () => {
				const result = await settle(remove({ data: { id: attachment.id } }));
				if (result === undefined) return;
				if (result === FAILED) {
					announce(t('auth.requestFailed'), 'alert');
				} else if (result.ok || result.failure === 'gone') {
					onRemoved(attachment.id);
					announce(t('send.attachmentRemoved', { name: attachment.name }), 'status');
					// The pressed button is gone: the focus goes to the list's heading.
					headingRef.current?.focus();
				} else {
					announce(t(attachmentFailureMessage(result)), 'alert');
				}
			});
		},
		[announce, onRemoved, remove, t],
	);
	const tooLarge = summary.status === 'ready' && summary.summary.graphTooLarge;
	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col items-start gap-2">
				<FileTrigger acceptedFileTypes={ACCEPTED_FILE_TYPES} allowsMultiple onSelect={onSelect}>
					<Button
						aria-describedby={error === null ? helpId : `${helpId} ${errorId}`}
						className={primaryButtonClass}
						isPending={!hydrated || isPending}
					>
						{t('send.attachmentAdd')}
					</Button>
				</FileTrigger>
				<p className="max-w-2xl text-sm text-gray-700" id={helpId}>
					{t('send.attachmentsHelp')}
					{graph ? ` ${t('send.attachmentsGraphNote')}` : ''}
				</p>
				{error === null ? null : (
					<p className="text-red-700" id={errorId} key={error.id} role="alert">
						{error.text}
					</p>
				)}
			</div>
			<section aria-labelledby="send-files" className="flex flex-col gap-2">
				<h3 className="font-semibold outline-none" id="send-files" ref={headingRef} tabIndex={-1}>
					{t('send.attachmentsLabel')}
				</h3>
				{attachments.length === 0 ? (
					<p>{t('send.attachmentsEmpty')}</p>
				) : (
					<ul className="flex max-w-xl flex-col gap-2">
						{attachments.map((attachment) => (
							<AttachmentItem
								attachment={attachment}
								isPending={isPending}
								key={attachment.id}
								onRemove={onRemove}
							/>
						))}
					</ul>
				)}
			</section>
			<div aria-live="polite">
				{tooLarge ? (
					<p className="max-w-2xl font-semibold text-red-700">{t('send.graphTooLarge')}</p>
				) : null}
			</div>
		</div>
	);
}
