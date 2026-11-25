import type { ReactNode } from 'react';

import { LayoutTable } from './container';

const NO_BREAK_SPACE = '\u00A0';

/** A neutral grey that shows on light and dark backgrounds; the line carries no meaning. */
const LINE_COLOR = '#d1d5db';

/**
 * A thin horizontal line, left out of the plain text.
 *
 * @returns The line.
 */
export function Divider(): ReactNode {
	return (
		<LayoutTable width="100%">
			<tr>
				<td
					data-skip-in-text="true"
					style={{ borderTop: `1px solid ${LINE_COLOR}`, fontSize: 1, lineHeight: '1px' }}
				>
					{NO_BREAK_SPACE}
				</td>
			</tr>
		</LayoutTable>
	);
}
