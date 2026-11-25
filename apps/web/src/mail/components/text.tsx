import type { CSSProperties, ReactNode } from 'react';

interface TextProps {
	readonly children: ReactNode;
	readonly color: string;
	readonly fontFamily: string;
	/** Space below the paragraph, in pixels. */
	readonly spaceAfter: number;
}

/**
 * The style of body text.
 *
 * @param color The text colour.
 * @param fontFamily The font.
 * @param spaceAfter The space below, in pixels.
 * @returns The inline style.
 */
function bodyStyle(color: string, fontFamily: string, spaceAfter: number): CSSProperties {
	return {
		color,
		fontFamily,
		fontSize: 16,
		lineHeight: '24px',
		margin: spaceAfter === 0 ? 0 : `0 0 ${String(spaceAfter)}px`,
		msoLineHeightRule: 'exactly',
	};
}

/**
 * A paragraph of body text.
 *
 * @param props The paragraph props.
 * @param props.children The inline content.
 * @param props.color The text colour.
 * @param props.fontFamily The font.
 * @param props.spaceAfter The space below, in pixels.
 * @returns The paragraph.
 */
function Text({ children, color, fontFamily, spaceAfter }: TextProps): ReactNode {
	return <p style={bodyStyle(color, fontFamily, spaceAfter)}>{children}</p>;
}

interface ListProps extends TextProps {
	readonly ordered: boolean;
}

/**
 * A bulleted or numbered list. Classic Outlook ignores a list's padding, so the indent is a
 * margin.
 *
 * @param props The list props.
 * @param props.children The items.
 * @param props.ordered Whether the list is numbered.
 * @param props.color The text colour.
 * @param props.fontFamily The font.
 * @param props.spaceAfter The space below, in pixels.
 * @returns The list.
 */
function List({ children, color, fontFamily, ordered, spaceAfter }: ListProps): ReactNode {
	const style: CSSProperties = {
		...bodyStyle(color, fontFamily, spaceAfter),
		marginLeft: 24,
		padding: 0,
	};
	return ordered ? <ol style={style}>{children}</ol> : <ul style={style}>{children}</ul>;
}

interface ListItemProps {
	readonly children: ReactNode;
	readonly color: string;
	readonly fontFamily: string;
}

/**
 * An item of a list, styled itself because classic Outlook does not pass the list's style on.
 *
 * @param props The item props.
 * @param props.children The inline content.
 * @param props.color The text colour.
 * @param props.fontFamily The font.
 * @returns The item.
 */
function ListItem({ children, color, fontFamily }: ListItemProps): ReactNode {
	return <li style={{ ...bodyStyle(color, fontFamily, 0), margin: '0 0 4px' }}>{children}</li>;
}

export { List, ListItem, Text };
