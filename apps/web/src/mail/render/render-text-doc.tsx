import { Fragment } from 'react';
import type { ReactNode } from 'react';

import type { InlineNode, Mark, Paragraph, TextDoc } from '@/mail/blocks/text-doc';
import { Link } from '@/mail/components/link';
import { List, ListItem, Text } from '@/mail/components/text';

import type { ResolvePlaceholder } from './inline-text';
import type { MailTheme } from './theme';

/** Space between paragraphs and lists of a text block, in pixels. */
const PARAGRAPH_GAP = 16;
const NO_NODES: readonly InlineNode[] = [];
const NO_BREAK_SPACE = '\u00A0';

/**
 * Wraps a text in its marks; the link outermost.
 *
 * @param text The text.
 * @param marks The marks of the text node.
 * @param theme The theme.
 * @returns The marked text.
 */
function marked(text: string, marks: readonly Mark[], theme: MailTheme): ReactNode {
	let node: ReactNode = text;
	if (marks.some((mark) => mark.type === 'italic')) node = <em>{node}</em>;
	if (marks.some((mark) => mark.type === 'bold')) node = <strong>{node}</strong>;
	const link = marks.find((mark) => mark.type === 'link');
	if (link !== undefined) {
		node = (
			<Link color={theme.link} href={link.attrs.href}>
				{node}
			</Link>
		);
	}
	return node;
}

interface InlineProps {
	readonly nodes?: readonly InlineNode[] | undefined;
	readonly theme: MailTheme;
	readonly resolve: ResolvePlaceholder;
}

/**
 * One inline node: a text (an element when it has marks), a line break or a placeholder value.
 *
 * @param node The node.
 * @param key The React key of an element.
 * @param props The content props.
 * @returns A string or an element.
 */
function inlinePiece(node: InlineNode, key: string, props: InlineProps): ReactNode {
	if (node.type === 'hardBreak') return <br key={key} />;
	if (node.type === 'placeholder') return props.resolve(node.attrs);
	if (node.marks === undefined || node.marks.length === 0) return node.text;
	return <Fragment key={key}>{marked(node.text, node.marks, props.theme)}</Fragment>;
}

/**
 * Inline content with marks, line breaks and placeholders. Neighbouring texts are joined, so the
 * renderer puts no comment between them.
 *
 * @param props The content props.
 * @returns The content.
 */
function InlineContent(props: InlineProps): ReactNode {
	const children: ReactNode[] = [];
	for (const [index, node] of (props.nodes ?? NO_NODES).entries()) {
		const piece = inlinePiece(node, String(index), props);
		const last = children.length - 1;
		const previous = children[last];
		if (typeof piece === 'string' && typeof previous === 'string')
			children[last] = previous + piece;
		else children.push(piece);
	}
	return children;
}

interface ParagraphProps {
	readonly paragraph: Paragraph;
	readonly theme: MailTheme;
	readonly resolve: ResolvePlaceholder;
	readonly spaceAfter: number;
}

/**
 * A paragraph; an empty one keeps its line.
 *
 * @param props The paragraph props.
 * @param props.paragraph The paragraph node.
 * @param props.theme The theme.
 * @param props.resolve The placeholder values.
 * @param props.spaceAfter The space below, in pixels.
 * @returns The paragraph.
 */
function ParagraphContent({ paragraph, resolve, spaceAfter, theme }: ParagraphProps): ReactNode {
	const empty = paragraph.content === undefined || paragraph.content.length === 0;
	return (
		<Text color={theme.text} fontFamily={theme.font} spaceAfter={spaceAfter}>
			{empty ? (
				NO_BREAK_SPACE
			) : (
				<InlineContent nodes={paragraph.content} resolve={resolve} theme={theme} />
			)}
		</Text>
	);
}

interface TextDocProps {
	readonly doc: TextDoc;
	readonly theme: MailTheme;
	readonly resolve: ResolvePlaceholder;
}

/**
 * The content of a text block: paragraphs and lists. The paragraphs of a list item stand in the
 * item, separated by a line break, so the list stays tight in every client.
 *
 * @param props The document props.
 * @param props.doc The document.
 * @param props.theme The theme.
 * @param props.resolve The placeholder values.
 * @returns The paragraphs and lists.
 */
function TextDocContent({ doc, resolve, theme }: TextDocProps): ReactNode {
	return doc.content.map((node, index) => {
		const key = String(index);
		const spaceAfter = index === doc.content.length - 1 ? 0 : PARAGRAPH_GAP;
		if (node.type === 'paragraph') {
			return (
				<ParagraphContent
					key={key}
					paragraph={node}
					resolve={resolve}
					spaceAfter={spaceAfter}
					theme={theme}
				/>
			);
		}
		return (
			<List
				key={key}
				color={theme.text}
				fontFamily={theme.font}
				ordered={node.type === 'orderedList'}
				spaceAfter={spaceAfter}
			>
				{node.content.map((item, itemIndex) => (
					<ListItem key={String(itemIndex)} color={theme.text} fontFamily={theme.font}>
						{item.content.map((paragraph, paragraphIndex) => (
							<Fragment key={String(paragraphIndex)}>
								{paragraphIndex > 0 ? <br /> : null}
								<InlineContent nodes={paragraph.content} resolve={resolve} theme={theme} />
							</Fragment>
						))}
					</ListItem>
				))}
			</List>
		);
	});
}

export { TextDocContent };
