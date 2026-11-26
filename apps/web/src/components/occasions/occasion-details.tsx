import type { ReactNode } from 'react';

import type { OccasionPage } from '@/functions/occasions';
import { useT } from '@/i18n/use-t';

/**
 * An occasion as read-only text, for readers of its area and for an archived occasion.
 *
 * @param props The props.
 * @param props.page The occasion with the areas, templates and senders.
 * @returns The details.
 */
export function OccasionDetails({ page }: Readonly<{ page: OccasionPage }>): ReactNode {
	const t = useT();
	const { occasion } = page;
	const area = page.areas.find(({ id }) => id === occasion.areaId);
	const template = page.templates.find(({ id }) => id === occasion.templateId);
	const sender = page.senders.find(({ id }) => id === occasion.senderId);
	const rows: readonly (readonly [string, string | undefined])[] = [
		[t('occasions.areaLabel'), area?.name],
		[t('occasions.kindLabel'), t(`occasions.kind.${occasion.kind}`)],
		[t('occasions.templateLabel'), template?.name],
		[t('occasions.senderLabel'), sender?.label],
		[
			t('occasions.unsubscribeLabel'),
			occasion.unsubscribe ? t('occasions.yes') : t('occasions.no'),
		],
		[t('occasions.triggerLabel'), t('occasions.trigger.manual')],
	];
	return (
		<dl className="grid max-w-xl grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
			{rows.map(([term, value]) => (
				<div className="contents" key={term}>
					<dt className="font-semibold">{term}</dt>
					<dd>{value}</dd>
				</div>
			))}
		</dl>
	);
}
