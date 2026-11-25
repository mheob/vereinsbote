import type { ReactNode } from 'react';

interface RowProps {
	readonly children: ReactNode;
	/** CSS padding of the cell. */
	readonly padding: string;
	readonly align?: 'left' | 'center';
	readonly className?: string;
}

/**
 * A row of a layout table with one cell.
 *
 * @param props The row props.
 * @param props.children The content of the cell.
 * @param props.padding The padding of the cell.
 * @param props.align The horizontal alignment of the content.
 * @param props.className The class for the mobile rule.
 * @returns The row.
 */
export function Row({ align = 'left', children, className, padding }: RowProps): ReactNode {
	return (
		<tr>
			<td align={align} className={className} style={{ padding }}>
				{children}
			</td>
		</tr>
	);
}
