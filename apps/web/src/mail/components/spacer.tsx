import type { ReactNode } from 'react';

const NO_BREAK_SPACE = '\u00A0';

interface SpacerProps {
	/** Pixels. */
	readonly height: number;
	readonly backgroundColor?: string;
}

/**
 * An empty row of a fixed height, left out of the plain text. Classic Outlook keeps the height
 * only with an exact line height and a character in the cell.
 *
 * @param props The spacer props.
 * @param props.height The height.
 * @param props.backgroundColor A colour that fills the row, e.g. the accent line.
 * @returns The row.
 */
export function Spacer({ backgroundColor, height }: SpacerProps): ReactNode {
	const size = `${String(height)}px`;
	return (
		<tr>
			<td
				data-skip-in-text="true"
				height={height}
				style={{
					backgroundColor,
					fontSize: size,
					height: size,
					lineHeight: size,
					msoLineHeightRule: 'exactly',
				}}
			>
				{NO_BREAK_SPACE}
			</td>
		</tr>
	);
}
