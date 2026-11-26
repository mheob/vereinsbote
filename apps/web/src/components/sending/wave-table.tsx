import { Link } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Cell, Column, Row, Table, TableBody, TableHeader } from 'react-aria-components';

import { linkClass } from '@/components/styles';
import { useLocale, useT } from '@/i18n/use-t';
import type { WaveRow } from '@/server/waves/overview';

import { countsText, waveStateText } from './overview-texts';
import { formatClubDateTime } from './schedule';

const headerCellClass = 'px-3 py-2 text-left font-semibold whitespace-nowrap';
const cellClass =
	'px-3 py-2 align-top outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';
const rowClass =
	'border-b border-gray-300 outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';

/**
 * The occasion of a wave as the link to the wave's page; its accessible name adds the start, as
 * an occasion has many waves.
 *
 * @param props The props.
 * @param props.wave The wave.
 * @returns The link.
 */
function WaveLink({ wave }: Readonly<{ wave: WaveRow }>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const params = useMemo(() => ({ waveId: wave.id }), [wave.id]);
	const start = formatClubDateTime(wave.notBefore, locale);
	return (
		<Link
			aria-label={t('overview.waveAria', { occasion: wave.occasionName, start })}
			className={linkClass}
			params={params}
			to="/sending/waves/$waveId"
		>
			{wave.occasionName}
		</Link>
	);
}

/**
 * The waves of an area as a table: the occasion as the link to the wave's page, the start, the
 * state and the number of entries per status. Without waves the table says so.
 *
 * @param props The props.
 * @param props.areaName The area, for the table's name.
 * @param props.waves The waves of the page.
 * @returns The table.
 */
export function WaveTable({
	areaName,
	waves,
}: Readonly<{ areaName: string; waves: readonly WaveRow[] }>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const renderEmptyState = useCallback(
		() => <p className="px-3 py-6">{t('overview.wavesEmpty')}</p>,
		[t],
	);
	return (
		<div className="overflow-x-auto">
			<Table
				aria-label={t('overview.wavesCaption', { area: areaName })}
				className="w-full border-collapse outline-none data-focus-visible:outline-2 data-focus-visible:outline-blue-700"
			>
				<TableHeader className="border-b border-gray-600">
					<Column className={headerCellClass} isRowHeader>
						{t('overview.occasionColumn')}
					</Column>
					<Column className={headerCellClass}>{t('overview.startColumn')}</Column>
					<Column className={headerCellClass}>{t('overview.stateColumn')}</Column>
					<Column className={headerCellClass}>{t('overview.countsColumn')}</Column>
				</TableHeader>
				<TableBody
					className="data-empty:text-center"
					items={waves}
					renderEmptyState={renderEmptyState}
				>
					{(wave) => (
						<Row className={rowClass} id={wave.id}>
							<Cell className={cellClass}>
								<WaveLink wave={wave} />
							</Cell>
							<Cell className={cellClass}>{formatClubDateTime(wave.notBefore, locale)}</Cell>
							<Cell className={cellClass}>{waveStateText(wave.state, t)}</Cell>
							<Cell className={cellClass}>{countsText(wave.counts, t)}</Cell>
						</Row>
					)}
				</TableBody>
			</Table>
		</div>
	);
}
