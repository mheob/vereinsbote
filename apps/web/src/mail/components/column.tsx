import type { ReactNode } from 'react';

import { LayoutTable } from './container';

interface ColumnProps {
	/** The rows of the column. */
	readonly children: ReactNode;
	readonly width: number;
	/** CSS padding of the cell. */
	readonly padding: string;
}

/**
 * One of two columns side by side; on a phone the columns stand below each other at full width
 * (`vb-column`).
 *
 * @param props The column props.
 * @param props.children The rows.
 * @param props.width The width in pixels.
 * @param props.padding The padding of the cell.
 * @returns The cell.
 */
export function Column({ children, padding, width }: ColumnProps): ReactNode {
	return (
		<td
			className="vb-column"
			valign="top"
			width={width}
			style={{ padding, verticalAlign: 'top', width }}
		>
			<LayoutTable width="100%">{children}</LayoutTable>
		</td>
	);
}
