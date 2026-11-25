import type { ReactNode } from 'react';

import type { Block, ColumnBlock, ImageBlock } from '@/mail/blocks/block-schema';
import { Button } from '@/mail/components/button';
import { Column } from '@/mail/components/column';
import { LayoutTable } from '@/mail/components/container';
import { Divider } from '@/mail/components/divider';
import { Heading } from '@/mail/components/heading';
import { Image } from '@/mail/components/image';
import { Row } from '@/mail/components/row';
import { Spacer } from '@/mail/components/spacer';
import { Text } from '@/mail/components/text';

import { inlineText } from './inline-text';
import type { ResolvePlaceholder } from './inline-text';
import { TextDocContent } from './render-text-doc';
import type { MailTheme } from './theme';

/** Where an image of the collection is and how large it is. */
interface ImageSource {
	readonly src: string;
	readonly width: number;
	readonly height: number;
}

interface BlockContext {
	readonly theme: MailTheme;
	readonly resolve: ResolvePlaceholder;
	/** The image of a media id; the compiler has checked that every id is known. */
	readonly image: (mediaId: string) => ImageSource | null;
}

/** The width of the content area. */
const CONTENT_WIDTH = 600;
/** The space between the edge of the content area and its text. */
const GUTTER = 20;
const COLUMN_WIDTH = CONTENT_WIDTH / 2;
/** Half the space between two columns; the column's text keeps it again. */
const COLUMN_GUTTER = 10;
const MAX_COLUMN_IMAGE_WIDTH = COLUMN_WIDTH - 2 * COLUMN_GUTTER;
/** The space below each block. */
const BLOCK_GAP = 16;
const SPACER_HEIGHTS = { large: 48, medium: 32, small: 16 } as const;

/** The measures of the place a block stands in: the content area or a column. */
interface Area {
	readonly gutter: number;
	readonly maxImageWidth: number;
	readonly maxButtonWidth: number;
}

const MAIN_AREA: Area = {
	gutter: GUTTER,
	maxButtonWidth: CONTENT_WIDTH - 2 * GUTTER,
	maxImageWidth: CONTENT_WIDTH,
};
const COLUMN_AREA: Area = {
	gutter: COLUMN_GUTTER,
	maxButtonWidth: MAX_COLUMN_IMAGE_WIDTH - 2 * COLUMN_GUTTER,
	maxImageWidth: MAX_COLUMN_IMAGE_WIDTH,
};

/**
 * The padding of a block's row: the gutter at the sides and the gap below.
 *
 * @param gutter The side space.
 * @returns The CSS padding.
 */
function padding(gutter: number): string {
	return `0 ${String(gutter)}px ${String(BLOCK_GAP)}px`;
}

interface ImageRowProps {
	readonly block: ImageBlock;
	readonly context: BlockContext;
	readonly area: Area;
}

/**
 * An image block at the width of its image, at most the width of its area; nothing until an
 * image is chosen.
 *
 * @param props The row props.
 * @param props.block The block.
 * @param props.context The render context.
 * @param props.area The area.
 * @returns The row, or nothing.
 */
function ImageRow({ area, block, context }: ImageRowProps): ReactNode {
	const image = block.mediaId === null ? null : context.image(block.mediaId);
	if (image === null) return null;
	const width = Math.min(image.width, area.maxImageWidth);
	const height = Math.round((image.height * width) / image.width);
	return (
		<Row align="center" padding={padding(0)}>
			<Image
				alt={block.decorative ? '' : block.alt}
				height={height}
				href={block.href}
				src={image.src}
				width={width}
			/>
		</Row>
	);
}

interface BlockRowProps {
	readonly block: ColumnBlock;
	readonly context: BlockContext;
	readonly area: Area;
}

/**
 * The row of a block that is not two columns.
 *
 * @param props The row props.
 * @param props.block The block.
 * @param props.context The render context.
 * @param props.area The area.
 * @returns The row.
 */
function BlockRow({ area, block, context }: BlockRowProps): ReactNode {
	const { resolve, theme } = context;
	switch (block.type) {
		case 'heading': {
			return (
				<Row padding={padding(area.gutter)}>
					<Heading color={theme.text} fontFamily={theme.headingFont} level={block.level}>
						{inlineText(block.content, resolve)}
					</Heading>
				</Row>
			);
		}
		case 'text': {
			return (
				<Row padding={padding(area.gutter)}>
					<TextDocContent doc={block.doc} resolve={resolve} theme={theme} />
				</Row>
			);
		}
		case 'image': {
			return <ImageRow area={area} block={block} context={context} />;
		}
		case 'button': {
			return (
				<Row align={block.align} padding={padding(area.gutter)}>
					<Button
						align={block.align}
						backgroundColor={theme.primary}
						color={theme.buttonText}
						fontFamily={theme.font}
						href={block.href}
						label={inlineText(block.label, resolve)}
						maxWidth={area.maxButtonWidth}
					/>
				</Row>
			);
		}
		case 'divider': {
			return (
				<Row padding={padding(area.gutter)}>
					<Divider />
				</Row>
			);
		}
		case 'spacer': {
			return <Spacer height={SPACER_HEIGHTS[block.size]} />;
		}
		case 'placeholderLine': {
			return (
				<Row padding={padding(area.gutter)}>
					<Text color={theme.text} fontFamily={theme.font} spaceAfter={0}>
						{`${resolve(block.ref)}${block.suffix}`}
					</Text>
				</Row>
			);
		}
		default: {
			return null;
		}
	}
}

interface BlockRowsProps {
	readonly blocks: readonly Block[];
	readonly context: BlockContext;
}

interface ColumnsProps {
	readonly left: readonly ColumnBlock[];
	readonly right: readonly ColumnBlock[];
	readonly context: BlockContext;
}

/**
 * Two columns side by side, each with its own rows.
 *
 * @param props The columns props.
 * @param props.left The blocks of the left column.
 * @param props.right The blocks of the right column.
 * @param props.context The render context.
 * @returns The row.
 */
function ColumnsRow({ context, left, right }: ColumnsProps): ReactNode {
	return (
		<Row padding="0">
			<LayoutTable width="100%">
				<tr>
					{[left, right].map((content, index) => (
						<Column
							key={String(index)}
							padding={`0 ${String(COLUMN_GUTTER)}px`}
							width={COLUMN_WIDTH}
						>
							{content.map((inner) => (
								<BlockRow key={inner.id} area={COLUMN_AREA} block={inner} context={context} />
							))}
						</Column>
					))}
				</tr>
			</LayoutTable>
		</Row>
	);
}

/**
 * The rows of the blocks of a template, for a layout table of the content width.
 *
 * @param props The rows props.
 * @param props.blocks The blocks.
 * @param props.context The render context.
 * @returns The rows.
 */
function BlockRows({ blocks, context }: BlockRowsProps): ReactNode {
	return blocks.map((block) =>
		block.type === 'columns' ? (
			<ColumnsRow key={block.id} context={context} left={block.left} right={block.right} />
		) : (
			<BlockRow key={block.id} area={MAIN_AREA} block={block} context={context} />
		),
	);
}

/**
 * The blocks in a table of their own, for the `{{content}}` of an HTML layout.
 *
 * @param props The content props.
 * @param props.blocks The blocks.
 * @param props.context The render context.
 * @returns The table.
 */
function BlockContent({ blocks, context }: BlockRowsProps): ReactNode {
	return (
		<LayoutTable width="100%">
			<BlockRows blocks={blocks} context={context} />
		</LayoutTable>
	);
}

export { BlockContent, BlockRows, CONTENT_WIDTH, GUTTER };
export type { BlockContext, ImageSource };
