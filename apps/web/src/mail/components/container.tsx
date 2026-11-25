import type { ReactNode } from 'react';

interface LayoutTableProps {
	readonly children: ReactNode;
	/** Pixels, or the full width of the parent; without one the table fits its content. */
	readonly width?: number | '100%';
	readonly align?: 'left' | 'center';
	readonly backgroundColor?: string;
	readonly className?: string;
	/** Hides the table in classic Outlook, which shows a VML version instead. */
	readonly hiddenInOutlook?: boolean;
}

/**
 * A table for layout only: `role="presentation"` keeps screen readers from announcing it, and
 * the attributes keep classic Outlook from adding gaps.
 *
 * @param props The table props.
 * @param props.children The rows.
 * @param props.width The width.
 * @param props.align The alignment in the parent.
 * @param props.backgroundColor The background.
 * @param props.className The class for the mobile rule.
 * @param props.hiddenInOutlook Whether classic Outlook hides the table.
 * @returns The table.
 */
function LayoutTable({
	align,
	backgroundColor,
	children,
	className,
	hiddenInOutlook = false,
	width,
}: LayoutTableProps): ReactNode {
	return (
		<table
			role="presentation"
			align={align}
			border={0}
			cellPadding={0}
			cellSpacing={0}
			className={className}
			width={width}
			style={{
				backgroundColor,
				borderCollapse: 'collapse',
				maxWidth: typeof width === 'number' ? width : undefined,
				msoHide: hiddenInOutlook ? 'all' : undefined,
				width,
			}}
		>
			<tbody>{children}</tbody>
		</table>
	);
}

interface ContainerProps {
	readonly children: ReactNode;
	readonly width: number;
	readonly backgroundColor?: string;
}

/**
 * A centred area of a fixed width that takes the full width on a phone (`vb-container`).
 *
 * @param props The container props.
 * @param props.children The rows.
 * @param props.width The width in pixels.
 * @param props.backgroundColor The background.
 * @returns The area.
 */
function Container({ backgroundColor, children, width }: ContainerProps): ReactNode {
	return (
		<LayoutTable
			align="center"
			backgroundColor={backgroundColor}
			className="vb-container"
			width={width}
		>
			{children}
		</LayoutTable>
	);
}

export { Container, LayoutTable };
