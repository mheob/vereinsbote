/*
 * What the parts of the block editor share: the state they show and the actions they call. The
 * template editor builds it once per render; lists and forms only read it.
 */
import type { Block } from '@/mail/blocks/block-schema';
import type { EditorMedia } from '@/server/templates/editor-data';
import type { EditorPlaceholder } from '@/server/templates/editor-placeholders';

import type { BlockType } from './block-factory';
import type { ColumnTarget } from './editor-state';
import type { ProblemIndex } from './problems';

/** The changes the lists and forms ask for; the template editor applies and announces them. */
interface EditorActions {
	readonly select: (id: string) => void;
	readonly add: (type: BlockType, column: ColumnTarget | undefined) => void;
	readonly move: (id: string, toIndex: number, column: ColumnTarget | undefined) => void;
	readonly duplicate: (id: string) => void;
	readonly remove: (id: string) => void;
	readonly update: (block: Block) => void;
	/** Remembers an image chosen in the picker, for the preview and the form. */
	readonly addMedia: (id: string, media: EditorMedia) => void;
}

/** What the lists and forms show. */
interface EditorView {
	readonly isReadOnly: boolean;
	readonly selectedId: string | null;
	readonly areaId: string;
	/** The placeholders the area offers (and whose names the marks show). */
	readonly placeholders: readonly EditorPlaceholder[];
	readonly problems: ProblemIndex;
	readonly media: ReadonlyMap<string, EditorMedia>;
	/** Whether another block fits into the template. */
	readonly canAdd: boolean;
	/** The line of a block in its list. */
	readonly lineOf: (block: Block) => string;
	readonly actions: EditorActions;
}

export type { EditorActions, EditorView };
