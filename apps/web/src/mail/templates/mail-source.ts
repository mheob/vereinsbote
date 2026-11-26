/*
 * A template as `compileMail` takes it: subject, preview text, the body with the HTML of its layout,
 * and the images. The editor's preview and the sending build it with the same function, so a wave
 * sends what the preview showed. Browser-safe: types only from the server.
 */
import type { MailLayout, MailSource, MediaInfo } from '@/mail/render/compile';
import type { TemplateInput, TemplateLayout } from '@/mail/templates/template-schema';

/** A global layout with its HTML. */
interface LayoutHtml {
	readonly id: string;
	readonly html: string;
}

/**
 * The layout of the mail source for a template's layout choice.
 *
 * @param layout The choice.
 * @param layouts The global layouts with their HTML.
 * @returns The standard layout, or the HTML of a global or own layout; the standard layout when
 * a chosen global layout is gone.
 */
function mailLayoutOf(layout: TemplateLayout, layouts: readonly LayoutHtml[]): MailLayout {
	if (layout.kind === 'own') return { html: layout.html, kind: 'html' };
	if (layout.kind === 'standard') return { kind: 'standard' };
	const shared = layouts.find(({ id }) => id === layout.layoutId);
	return shared === undefined ? { kind: 'standard' } : { html: shared.html, kind: 'html' };
}

/**
 * A template as a mail source.
 *
 * @param input The template.
 * @param layouts The global layouts with their HTML; the one the template chose is enough.
 * @param media The images the template shows.
 * @returns The mail source.
 */
function mailSourceOf(
	input: TemplateInput,
	layouts: readonly LayoutHtml[],
	media: ReadonlyMap<string, MediaInfo>,
): MailSource {
	const { body, preheader, subject } = input;
	return {
		body:
			body.kind === 'html'
				? { html: body.html, kind: 'html' }
				: { blocks: body.blocks, kind: 'blocks', layout: mailLayoutOf(body.layout, layouts) },
		media,
		preheader,
		subject,
	};
}

export { mailLayoutOf, mailSourceOf };
export type { LayoutHtml };
