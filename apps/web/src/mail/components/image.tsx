import type { ReactNode } from 'react';

interface ImageProps {
	readonly src: string;
	/** `''` for a decorative image. */
	readonly alt: string;
	/** The width the image is shown at, in pixels. */
	readonly width: number;
	readonly height: number;
	/** The target of a linked image. */
	readonly href?: string | null;
}

/**
 * An image at a fixed width that shrinks with a narrow screen. Classic Outlook reads the
 * `width` and `height` attributes; other clients the style.
 *
 * @param props The image props.
 * @param props.src The absolute URL.
 * @param props.alt The alternative text.
 * @param props.width The width.
 * @param props.height The height.
 * @param props.href The link target, or null.
 * @returns The image, linked when a target is given.
 */
export function Image({ alt, height, href, src, width }: ImageProps): ReactNode {
	const image = (
		<img
			alt={alt}
			height={height}
			src={src}
			width={width}
			style={{
				border: 0,
				display: 'block',
				height: 'auto',
				maxWidth: '100%',
				outline: 'none',
				textDecoration: 'none',
				width,
			}}
		/>
	);
	if (href === undefined || href === null) return image;
	return (
		<a href={href} style={{ display: 'block', textDecoration: 'none' }}>
			{image}
		</a>
	);
}
