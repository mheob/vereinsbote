/*
 * What the editor's preview compiles: the template as a mail source, with the HTML of a chosen
 * layout, and the values of the sample contact. Contact selection follows in Task 15; until then
 * the preview greets the invented sample member Anna Beispiel, who has every built-in value.
 */
import { contactPlaceholderValues } from '@/mail/placeholders/contact-values';
import type { SalutationTexts } from '@/mail/placeholders/salutation';
import type { MailLayout, MailSource, MediaInfo } from '@/mail/render/compile';
import { SAMPLE_CONTACTS } from '@/mail/sample';
import type { TemplateInput, TemplateLayout } from '@/mail/templates/template-schema';
import { BUILTIN_PROTECTED_FIELD_KEYS } from '@/server/contacts/fields';

/** A global layout with its HTML. */
interface LayoutHtml {
	readonly id: string;
	readonly html: string;
}

/** The sample contact sees every built-in protected field. */
const SAMPLE_FIELDS = new Set(BUILTIN_PROTECTED_FIELD_KEYS);

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
 * The template as the preview compiles it.
 *
 * @param input The template.
 * @param layouts The global layouts with their HTML.
 * @param media The images the blocks show.
 * @returns The mail source.
 */
function previewSource(
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

/**
 * The placeholder values of the sample contact with the template's salutation texts.
 *
 * @param texts The salutation texts.
 * @returns The values.
 */
function sampleValues(texts: SalutationTexts): Map<string, string> {
	return contactPlaceholderValues(SAMPLE_CONTACTS.female, SAMPLE_FIELDS, [], texts);
}

export { mailLayoutOf, previewSource, sampleValues };
export type { LayoutHtml };
