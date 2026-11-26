/*
 * The files of the send flow. They start as the files the occasion holds for its next wave, and
 * start again from them whenever the page loads anew (after a file was gone, say): the server's
 * list is the truth. The mail carries the chosen ones: at first only the user's own uploads; a file
 * someone else uploaded (a colleague's flow, a flow left unconfirmed) is listed but goes along only
 * when the user ticks it.
 */
import { useCallback, useState } from 'react';

import type { AttachmentRecord, FreeAttachment } from '@/server/attachments/attachments';

type Files = readonly Readonly<FreeAttachment>[];

/** The files of the flow, the chosen ones, and the functions that change them. */
interface FlowAttachments {
	/** Every file the flow lists. */
	readonly attachments: Files;
	/** The ids of the files the mail carries. */
	readonly chosen: ReadonlySet<string>;
	/** Adds an upload of the user, chosen. */
	readonly add: (attachment: Readonly<AttachmentRecord>) => void;
	readonly remove: (id: string) => void;
	/** Ticks or unticks a file. */
	readonly choose: (id: string, chosen: boolean) => void;
}

/** The flow's files and choice, with the load they started from. */
interface Kept {
	readonly from: Files;
	readonly files: Files;
	readonly chosen: ReadonlySet<string>;
}

/**
 * Adds a file to the list, or replaces it there.
 *
 * @param list The files.
 * @param attachment The file.
 * @returns The files with it last.
 */
function withAttachment(list: Files, attachment: Readonly<FreeAttachment>): Files {
	return [...list.filter(({ id }) => id !== attachment.id), attachment];
}

/**
 * The files a flow chooses when it starts: the user's own uploads.
 *
 * @param files The listed files.
 * @returns Their ids.
 */
function chosenAtFirst(files: Files): ReadonlySet<string> {
	return new Set(files.filter(({ own }) => own).map(({ id }) => id));
}

/**
 * The chosen files in the order of the list.
 *
 * @param files The listed files.
 * @param chosen The ids of the chosen ones.
 * @returns Their ids.
 */
function chosenIdsOf(files: Files, chosen: ReadonlySet<string>): string[] {
	return files.filter(({ id }) => chosen.has(id)).map(({ id }) => id);
}

/**
 * The files and the choice as of the current load: what the flow kept, unless the page loaded anew
 * since.
 *
 * @param kept What the flow kept.
 * @param loaded The files of the current load.
 * @returns The files and the choice.
 */
function keptOf(kept: Kept, loaded: Files): Kept {
	return kept.from === loaded
		? kept
		: { chosen: chosenAtFirst(loaded), files: loaded, from: loaded };
}

/**
 * The choice with one file ticked or unticked.
 *
 * @param chosen The ids of the chosen files.
 * @param id The file.
 * @param isChosen Whether it goes along.
 * @returns The new choice.
 */
function withChoice(chosen: ReadonlySet<string>, id: string, isChosen: boolean): Set<string> {
	const next = new Set(chosen);
	if (isChosen) next.add(id);
	else next.delete(id);
	return next;
}

/**
 * Keeps the files of the flow and which of them the mail carries.
 *
 * @param loaded The files the page loaded.
 * @returns The files, the choice, and the functions that change them.
 */
function useFlowAttachments(loaded: Files): FlowAttachments {
	const [kept, setKept] = useState<Kept>(() =>
		keptOf({ chosen: new Set(), files: [], from: [] }, loaded),
	);
	const add = useCallback(
		(attachment: Readonly<AttachmentRecord>) => {
			setKept((previous) => {
				const { chosen, files } = keptOf(previous, loaded);
				return {
					chosen: withChoice(chosen, attachment.id, true),
					files: withAttachment(files, { ...attachment, own: true }),
					from: loaded,
				};
			});
		},
		[loaded],
	);
	const remove = useCallback(
		(id: string) => {
			setKept((previous) => {
				const { chosen, files } = keptOf(previous, loaded);
				return {
					chosen: withChoice(chosen, id, false),
					files: files.filter((attachment) => attachment.id !== id),
					from: loaded,
				};
			});
		},
		[loaded],
	);
	const choose = useCallback(
		(id: string, isChosen: boolean) => {
			setKept((previous) => {
				const current = keptOf(previous, loaded);
				return { ...current, chosen: withChoice(current.chosen, id, isChosen) };
			});
		},
		[loaded],
	);
	const { chosen, files } = keptOf(kept, loaded);
	return { add, attachments: files, choose, chosen, remove };
}

export { chosenAtFirst, chosenIdsOf, useFlowAttachments, withAttachment };
