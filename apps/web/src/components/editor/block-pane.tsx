import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { useT } from '@/i18n/use-t';
import type { Block } from '@/mail/blocks/block-schema';
import type { Warning } from '@/mail/checks/block-checks';

import { BLOCK_TYPES } from './block-factory';
import { BlockForm } from './block-form';
import { BlockList } from './block-list';
import type { EditorView } from './editor-view';
import { FindingsPanel } from './findings-panel';

/**
 * The blocks of the template: the messages without a field, the hints, the list of the top level
 * and the form of the chosen block below it (Design 13).
 *
 * @param props The props.
 * @param props.blocks The blocks of the top level.
 * @param props.view The editor's state and actions.
 * @param props.warnings The hints of the blocks.
 * @param props.generalProblems The messages of problems without a field.
 * @param props.onJump Opens the form of a block.
 * @returns The pane.
 */
export function BlockPane({
	blocks,
	generalProblems,
	onJump,
	view,
	warnings,
}: Readonly<{
	blocks: readonly Block[];
	view: EditorView;
	warnings: readonly Warning[];
	generalProblems: readonly string[];
	onJump: (blockId: string) => void;
}>): ReactNode {
	const t = useT();
	const chosen = useMemo(
		() => blocks.find(({ id }) => id === view.selectedId),
		[blocks, view.selectedId],
	);
	return (
		<section aria-labelledby="editor-blocks" className="flex flex-col gap-4">
			<h2 className="text-xl font-bold" id="editor-blocks">
				{t('editor.blocks')}
			</h2>
			{generalProblems.map((message) => (
				<p className="font-semibold text-red-700" key={message} role="alert">
					{message}
				</p>
			))}
			<FindingsPanel onJump={onJump} warnings={warnings} />
			<BlockList
				addLabel={t('editor.addBlock')}
				blocks={blocks}
				column={undefined}
				emptyText={t('editor.blocksEmpty')}
				label={t('editor.blocks')}
				types={BLOCK_TYPES}
				view={view}
			/>
			{chosen === undefined ? null : <BlockForm block={chosen} key={chosen.id} view={view} />}
		</section>
	);
}
