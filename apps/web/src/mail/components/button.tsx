import type { ReactNode } from 'react';

import { escapeHtml } from '@/mail/escape';

import { LayoutTable } from './container';

interface ButtonProps {
	/** The label, with the compiler's markers for placeholder values. */
	readonly label: string;
	/** `''` while the template has no link yet: the button is shown without one. */
	readonly href: string;
	readonly align: 'left' | 'center';
	readonly backgroundColor: string;
	readonly color: string;
	readonly fontFamily: string;
	/** The widest the button may be, in pixels. */
	readonly maxWidth: number;
}

const HEIGHT = 44;
const PADDING_X = 24;
const MIN_WIDTH = 120;
/** A rough width of a character at 16 px in bold. */
const CHARACTER_WIDTH = 9;
/** The characters a placeholder value is assumed to take. */
const SLOT_CHARACTERS = 10;
const SLOT_MARKER = /\uE000\d+\uE001/gu;

/**
 * The width of the Outlook button. VML needs a fixed width, so it is estimated from the label.
 *
 * @param label The label with markers.
 * @param maxWidth The widest the button may be.
 * @returns The width in pixels.
 */
function estimateWidth(label: string, maxWidth: number): number {
	const slots = [...label.matchAll(SLOT_MARKER)];
	const characters = label.replaceAll(SLOT_MARKER, '').length + slots.length * SLOT_CHARACTERS;
	const width = characters * CHARACTER_WIDTH + 2 * PADDING_X;
	return Math.min(maxWidth, Math.max(MIN_WIDTH, width));
}

/**
 * The rounded button for classic Outlook, which knows no `border-radius` and no padding on links:
 * a VML shape in a conditional comment. Every value in it is escaped; the label keeps its
 * markers, whose values the filling escapes as well.
 *
 * @param props The button props.
 * @returns The conditional comment.
 */
function outlookButton(props: ButtonProps): string {
	const href = props.href === '' ? '' : ` href="${escapeHtml(props.href)}"`;
	const width = estimateWidth(props.label, props.maxWidth);
	const shape = `height:${String(HEIGHT)}px;v-text-anchor:middle;width:${String(width)}px;`;
	const text = `color:${escapeHtml(props.color)};font-family:${escapeHtml(props.fontFamily)};font-size:16px;font-weight:bold;`;
	return (
		'<!--[if mso]>' +
		`<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"${href} style="${shape}" arcsize="14%" stroke="f" fillcolor="${escapeHtml(props.backgroundColor)}">` +
		`<w:anchorlock/><center style="${text}">${escapeHtml(props.label)}</center></v:roundrect>` +
		'<![endif]-->'
	);
}

/**
 * A button: a table cell in the primary colour with a padded link, and a VML version that classic
 * Outlook shows instead (`mso-hide` hides the table there). The cell carries `mso-padding-alt` as
 * well, so the table keeps its padding should a Word-based client show it after all.
 *
 * @param props The button props.
 * @param props.label The label.
 * @param props.href The link target, or `''`.
 * @param props.align The alignment; the row around the button aligns it as well.
 * @param props.backgroundColor The primary colour.
 * @param props.color The label colour.
 * @param props.fontFamily The font.
 * @param props.maxWidth The widest the Outlook button may be.
 * @returns The button.
 */
export function Button(props: ButtonProps): ReactNode {
	const { align, backgroundColor, color, fontFamily, href, label } = props;
	return (
		<>
			{/* oxlint-disable-next-line react/no-danger -- fixed markup with escaped values, see outlookButton */}
			<div dangerouslySetInnerHTML={{ __html: outlookButton(props) }} />
			<LayoutTable
				align={align === 'center' ? 'center' : undefined}
				backgroundColor={backgroundColor}
				hiddenInOutlook
			>
				<tr>
					<td
						align="center"
						style={{
							backgroundColor,
							borderRadius: 6,
							msoHide: 'all',
							msoPaddingAlt: `12px ${String(PADDING_X)}px`,
						}}
					>
						<a
							href={href === '' ? undefined : href}
							style={{
								backgroundColor,
								borderRadius: 6,
								color,
								display: 'inline-block',
								fontFamily,
								fontSize: 16,
								fontWeight: 'bold',
								lineHeight: '20px',
								msoHide: 'all',
								padding: `12px ${String(PADDING_X)}px`,
								textDecoration: 'none',
							}}
						>
							{label}
						</a>
					</td>
				</tr>
			</LayoutTable>
		</>
	);
}
