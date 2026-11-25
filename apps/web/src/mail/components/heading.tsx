import type { CSSProperties, ReactNode } from 'react';

interface HeadingProps {
	readonly children: ReactNode;
	readonly level: 1 | 2 | 3;
	readonly color: string;
	readonly fontFamily: string;
}

/** Font size and line height per level. */
const SIZES = {
	1: { fontSize: '28px', lineHeight: '36px' },
	2: { fontSize: '22px', lineHeight: '30px' },
	3: { fontSize: '18px', lineHeight: '26px' },
} as const;

/**
 * A real heading (`h1`–`h3`), so screen readers can jump between the sections of a mail.
 *
 * @param props The heading props.
 * @param props.children The text.
 * @param props.level The level.
 * @param props.color The text colour.
 * @param props.fontFamily The heading font.
 * @returns The heading.
 */
export function Heading({ children, color, fontFamily, level }: HeadingProps): ReactNode {
	const style: CSSProperties = {
		...SIZES[level],
		color,
		fontFamily,
		fontWeight: 'bold',
		margin: 0,
		msoLineHeightRule: 'exactly',
	};
	if (level === 1) return <h1 style={style}>{children}</h1>;
	if (level === 2) return <h2 style={style}>{children}</h2>;
	return <h3 style={style}>{children}</h3>;
}
