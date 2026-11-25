/*
 * What a template is made of, and its structural validation. No server imports: the editor in
 * the browser, the server functions and the server's template module use the same types and
 * schema. The save checks (allowed placeholders, alt texts, limits) come on top of it.
 */
import { z } from 'zod';

import { blockListSchema } from '@/mail/blocks/block-schema';
import type { Block } from '@/mail/blocks/block-schema';
import type { SalutationForm, SalutationTexts } from '@/mail/placeholders/salutation';

/** The frame of a block template: the standard layout, a global layout or an own HTML layout. */
type TemplateLayout =
	| { readonly kind: 'standard' }
	| { readonly kind: 'shared'; readonly layoutId: string }
	| { readonly kind: 'own'; readonly html: string };

/** The content: blocks in a layout, or a complete imported HTML mail. */
type TemplateBody =
	| { readonly kind: 'blocks'; readonly blocks: readonly Block[]; readonly layout: TemplateLayout }
	| { readonly kind: 'html'; readonly html: string };

/** Everything of a template its editor changes; the area is fixed. */
interface TemplateInput {
	readonly name: string;
	/** With placeholder syntax. */
	readonly subject: string;
	/** With placeholder syntax; `''` for none. */
	readonly preheader: string;
	readonly salutationForm: SalutationForm;
	readonly salutationTexts: SalutationTexts;
	readonly body: TemplateBody;
}

const salutationTextsSchema: z.ZodType<SalutationTexts> = z.strictObject({
	female: z.string(),
	male: z.string(),
	noName: z.string(),
	organization: z.string(),
	other: z.string(),
});

const templateLayoutSchema: z.ZodType<TemplateLayout> = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('standard') }),
	z.strictObject({ kind: z.literal('shared'), layoutId: z.uuid() }),
	z.strictObject({ html: z.string(), kind: z.literal('own') }),
]);

const templateBodySchema: z.ZodType<TemplateBody> = z.discriminatedUnion('kind', [
	z.strictObject({
		blocks: blockListSchema,
		kind: z.literal('blocks'),
		layout: templateLayoutSchema,
	}),
	z.strictObject({ html: z.string(), kind: z.literal('html') }),
]);

/**
 * The structure of a template. Lengths, placeholders, images and the size are the save checks'
 * business, so the editor can show them at the field.
 */
const templateInputSchema: z.ZodType<TemplateInput> = z.strictObject({
	body: templateBodySchema,
	name: z.string(),
	preheader: z.string(),
	salutationForm: z.enum(['du', 'sie']),
	salutationTexts: salutationTextsSchema,
	subject: z.string(),
});

export { salutationTextsSchema, templateBodySchema, templateInputSchema };
export type { TemplateBody, TemplateInput, TemplateLayout };
