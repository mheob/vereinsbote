import type { ReactNode } from 'react';

interface LinkProps {
	readonly children: ReactNode;
	readonly href: string;
	readonly color: string;
}

/**
 * A text link, underlined so it does not depend on its colour alone.
 *
 * @param props The link props.
 * @param props.children The link text.
 * @param props.href The target, checked by the block schema or the brand.
 * @param props.color The link colour.
 * @returns The link.
 */
export function Link({ children, color, href }: LinkProps): ReactNode {
	return (
		<a href={href} style={{ color, textDecoration: 'underline' }}>
			{children}
		</a>
	);
}
