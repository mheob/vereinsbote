/*
 * The files of the send flow. They start as the files the occasion holds for its next wave, and
 * start again from them whenever the page loads anew (after a file was gone, say): the server's
 * list is the truth.
 */
import { useCallback, useState } from 'react';

import type { AttachmentRecord } from '@/server/attachments/attachments';

type Files = readonly Readonly<AttachmentRecord>[];

/** The files of the flow and the functions that change them. */
interface FlowAttachments {
	readonly attachments: Files;
	readonly add: (attachment: Readonly<AttachmentRecord>) => void;
	readonly remove: (id: string) => void;
}

/** The flow's files, with the load they started from. */
interface Kept {
	readonly from: Files;
	readonly files: Files;
}

/**
 * Adds a file to the list, or replaces it there.
 *
 * @param list The files.
 * @param attachment The file.
 * @returns The files with it last.
 */
function withAttachment(list: Files, attachment: Readonly<AttachmentRecord>): Files {
	return [...list.filter(({ id }) => id !== attachment.id), attachment];
}

/**
 * The files as of the current load: what the flow kept, unless the page loaded anew since.
 *
 * @param kept What the flow kept.
 * @param loaded The files of the current load.
 * @returns The files.
 */
function filesOf(kept: Kept, loaded: Files): Files {
	return kept.from === loaded ? kept.files : loaded;
}

/**
 * Keeps the files of the flow.
 *
 * @param loaded The files the page loaded.
 * @returns The files, and the functions that add and remove one.
 */
function useFlowAttachments(loaded: Files): FlowAttachments {
	const [kept, setKept] = useState<Kept>({ files: loaded, from: loaded });
	const add = useCallback(
		(attachment: Readonly<AttachmentRecord>) => {
			setKept((previous) => ({
				files: withAttachment(filesOf(previous, loaded), attachment),
				from: loaded,
			}));
		},
		[loaded],
	);
	const remove = useCallback(
		(id: string) => {
			setKept((previous) => ({
				files: filesOf(previous, loaded).filter((attachment) => attachment.id !== id),
				from: loaded,
			}));
		},
		[loaded],
	);
	return { add, attachments: filesOf(kept, loaded), remove };
}

export { useFlowAttachments, withAttachment };
