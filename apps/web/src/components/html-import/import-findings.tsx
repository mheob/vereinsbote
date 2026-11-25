import type { ReactNode } from 'react';

import { useT } from '@/i18n/use-t';

import type { FindingGroups, Message } from './messages';

/**
 * One group of findings under its heading.
 *
 * @param props The props.
 * @param props.heading The heading of the group.
 * @param props.messages The messages.
 * @param props.tone The look of the group: refusals are red, warnings amber.
 * @returns The group; nothing when it is empty.
 */
function Group({
	heading,
	messages,
	tone,
}: Readonly<{
	heading: string;
	messages: readonly Message[];
	tone: 'neutral' | 'warning' | 'refused';
}>): ReactNode {
	if (messages.length === 0) return null;
	const frame = {
		neutral: 'bg-gray-100',
		refused: 'bg-red-50 text-red-900',
		warning: 'bg-amber-50',
	}[tone];
	return (
		<section className={`flex flex-col gap-2 rounded-md p-4 ${frame}`}>
			<h3 className="font-semibold">{heading}</h3>
			<ul className="flex list-disc flex-col gap-1 pl-5">
				{messages.map(({ key, text }) => (
					<li key={key}>{text}</li>
				))}
			</ul>
		</section>
	);
}

/**
 * What an import found, in three groups: what was removed, what it warns about and what it
 * refuses. Only a refusal stops the import.
 *
 * @param props The props.
 * @param props.groups What was removed and the warnings.
 * @param props.refused The messages of the refusals.
 * @returns The groups, or a note that there was nothing to report.
 */
export function ImportFindings({
	groups,
	refused,
}: Readonly<{ groups: FindingGroups; refused: readonly Message[] }>): ReactNode {
	const t = useT();
	const nothing =
		groups.removed.length === 0 && groups.warnings.length === 0 && refused.length === 0;
	return (
		<div className="flex flex-col gap-3">
			{nothing ? <p>{t('htmlImport.findingsNone')}</p> : null}
			<Group heading={t('htmlImport.refusedHeading')} messages={refused} tone="refused" />
			<Group heading={t('htmlImport.removedHeading')} messages={groups.removed} tone="neutral" />
			<Group heading={t('htmlImport.warningsHeading')} messages={groups.warnings} tone="warning" />
		</div>
	);
}
