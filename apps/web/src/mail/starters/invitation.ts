/*
 * The starter "Einladung" (Design 9): heading, salutation line, text with sample details in
 * square brackets to replace, spacer and a greeting with the club's name. No image and no button:
 * both need an input before they pass the save checks. The texts are German, like the club's
 * mails; they are content, not interface text.
 */
import type { Block } from '@/mail/blocks/block-schema';
import type { InlineNode } from '@/mail/blocks/text-doc';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import type { TemplateInput } from '@/mail/templates/template-schema';

/** A starter's content with the name and subject the creation dialog offers. */
type StarterTemplate = Omit<TemplateInput, 'name' | 'subject'> & {
	readonly defaultName: string;
	readonly defaultSubject: string;
};

const text = (value: string): InlineNode => ({ text: value, type: 'text' });
const bold = (value: string): InlineNode => ({
	marks: [{ type: 'bold' }],
	text: value,
	type: 'text',
});

/**
 * The blocks of the invitation.
 *
 * @returns New blocks.
 */
function invitationBlocks(): Block[] {
	return [
		{
			content: [text('Einladung zu [Veranstaltung]')],
			id: 'invitation-heading',
			level: 1,
			type: 'heading',
		},
		{
			id: 'invitation-salutation',
			ref: { fallback: null, key: 'salutation' },
			suffix: ',',
			type: 'placeholderLine',
		},
		{
			doc: {
				content: [
					{
						content: [
							text(
								'wir laden dich herzlich zu [Veranstaltung] ein und freuen uns, wenn du dabei bist.',
							),
						],
						type: 'paragraph',
					},
					{
						content: [
							bold('Wann:'),
							text(' [Datum], [Uhrzeit]'),
							{ type: 'hardBreak' },
							bold('Wo:'),
							text(' [Ort]'),
						],
						type: 'paragraph',
					},
					{
						content: [text('Bitte sag uns bis [Datum] Bescheid, ob du kommst.')],
						type: 'paragraph',
					},
				],
				type: 'doc',
			},
			id: 'invitation-text',
			type: 'text',
		},
		{ id: 'invitation-spacer', size: 'medium', type: 'spacer' },
		{
			doc: {
				content: [
					{
						content: [
							text('Viele Grüße'),
							{ type: 'hardBreak' },
							{ attrs: { fallback: null, key: 'brand.name' }, type: 'placeholder' },
						],
						type: 'paragraph',
					},
				],
				type: 'doc',
			},
			id: 'invitation-greeting',
			type: 'text',
		},
	];
}

/**
 * The starter "Einladung", addressing the recipients with "du".
 *
 * @returns A new copy of the starter.
 */
function invitationStarter(): StarterTemplate {
	return {
		body: { blocks: invitationBlocks(), kind: 'blocks', layout: { kind: 'standard' } },
		defaultName: 'Einladung',
		defaultSubject: 'Einladung zu [Veranstaltung]',
		preheader: '',
		salutationForm: 'du',
		salutationTexts: { ...DEFAULT_SALUTATIONS.du },
	};
}

export { invitationStarter };
export type { StarterTemplate };
