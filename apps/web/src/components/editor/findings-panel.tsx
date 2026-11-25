import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';

import { useT } from '@/i18n/use-t';
import type { Warning } from '@/mail/checks/block-checks';

const jumpClass =
	'text-left font-semibold text-blue-700 underline data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700';

/**
 * One hint with its jump to the block.
 *
 * @param props The props.
 * @param props.warning The warning.
 * @param props.onJump Called with the block of the warning.
 * @returns The list item.
 */
function Finding({
	onJump,
	warning,
}: Readonly<{ warning: Warning; onJump: (blockId: string) => void }>): ReactNode {
	const t = useT();
	const jump = useCallback(() => {
		onJump(warning.blockId);
	}, [onJump, warning.blockId]);
	return (
		<li>
			<Button className={jumpClass} onPress={jump}>
				{warning.kind === 'headingOrder'
					? t('editor.warning.headingOrder', { level: warning.level })
					: t('editor.warning.vagueLink', { text: warning.text })}
			</Button>
		</li>
	);
}

/**
 * The accessibility hints of the blocks next to the editor (Design 12): headings that skip a
 * level, link texts that say nothing. They do not keep the template from being saved; each one
 * jumps to its block. Nothing is shown without hints.
 *
 * @param props The props.
 * @param props.warnings The warnings.
 * @param props.onJump Called with the block of a hint.
 * @returns The hints.
 */
export function FindingsPanel({
	onJump,
	warnings,
}: Readonly<{ warnings: readonly Warning[]; onJump: (blockId: string) => void }>): ReactNode {
	const t = useT();
	// A key per warning from its content; equal warnings of one block are counted.
	const keyed = useMemo(() => {
		const seen = new Map<string, number>();
		return warnings.map((warning) => {
			const detail = warning.kind === 'vagueLink' ? warning.text : String(warning.level);
			const base = `${warning.blockId}-${warning.kind}-${detail}`;
			const count = seen.get(base) ?? 0;
			seen.set(base, count + 1);
			return { key: `${base}-${String(count)}`, warning };
		});
	}, [warnings]);
	if (warnings.length === 0) return null;
	return (
		<section
			aria-labelledby="editor-findings"
			className="flex flex-col gap-2 rounded-md bg-amber-50 p-4"
		>
			<h2 className="text-lg font-semibold" id="editor-findings">
				{t('editor.findings')}
			</h2>
			<p className="text-sm text-gray-700">{t('editor.findingsHelp')}</p>
			<ul className="flex list-disc flex-col gap-1 pl-5">
				{keyed.map(({ key, warning }) => (
					<Finding key={key} onJump={onJump} warning={warning} />
				))}
			</ul>
		</section>
	);
}
