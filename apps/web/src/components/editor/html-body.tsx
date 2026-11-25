import type { ReactNode } from 'react';

import { useT } from '@/i18n/use-t';

/**
 * What an imported HTML template shows instead of blocks: the problems without a field, and a note
 * that the HTML is replaced, not edited, here.
 *
 * @param props The props.
 * @param props.generalProblems The messages of problems without a field.
 * @returns The note.
 */
export function HtmlBody({
	generalProblems,
}: Readonly<{ generalProblems: readonly string[] }>): ReactNode {
	const t = useT();
	return (
		<section className="flex flex-col gap-2">
			{generalProblems.map((message) => (
				<p className="font-semibold text-red-700" key={message} role="alert">
					{message}
				</p>
			))}
			<p role="note">{t('editor.htmlNote')}</p>
		</section>
	);
}
