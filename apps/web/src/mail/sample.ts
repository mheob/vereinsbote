/*
 * Invented sample data for previews and sample mails: a contact per salutation case and blocks
 * that use every kind of block once.
 */
import type { Block } from '@/mail/blocks/block-schema';
import type { InlineNode, TextDoc } from '@/mail/blocks/text-doc';
import type { ContactValueSource } from '@/mail/placeholders/contact-values';

type SampleContactKind = 'female' | 'male' | 'diverse' | 'organization';

const BASE_CONTACT: ContactValueSource = {
	birthDate: null,
	city: 'Beispielstadt',
	customValues: {},
	customerNumber: null,
	email: null,
	entryDate: null,
	exitDate: null,
	firstName: null,
	gender: 'unspecified',
	groups: [],
	kind: 'member',
	lastName: null,
	memberNumber: null,
	organization: null,
	postalCode: '12345',
	street: 'Sportplatzweg 1',
	tags: [],
};

const SAMPLE_CONTACTS: Readonly<Record<SampleContactKind, ContactValueSource>> = {
	diverse: {
		...BASE_CONTACT,
		birthDate: '2001-09-30',
		email: 'kim.probe@example.org',
		entryDate: '2020-03-01',
		firstName: 'Kim',
		gender: 'diverse',
		groups: ['Leichtathletik'],
		lastName: 'Probe',
		memberNumber: '1003',
	},
	female: {
		...BASE_CONTACT,
		birthDate: '1985-05-17',
		email: 'anna.beispiel@example.org',
		entryDate: '2010-01-01',
		firstName: 'Anna',
		gender: 'female',
		groups: ['Fußball', 'Vorstand'],
		lastName: 'Beispiel',
		memberNumber: '1001',
		tags: ['Ehrenamt'],
	},
	male: {
		...BASE_CONTACT,
		birthDate: '1972-11-02',
		email: 'bernd.muster@example.org',
		entryDate: '1998-04-15',
		firstName: 'Bernd',
		gender: 'male',
		groups: ['Tennis'],
		lastName: 'Muster',
		memberNumber: '1002',
	},
	organization: {
		...BASE_CONTACT,
		customerNumber: 'K-501',
		email: 'kontakt@beispiel-gmbh.example',
		kind: 'partner',
		organization: 'Beispiel GmbH',
		tags: ['Sponsor'],
	},
};

const text = (value: string, marks?: readonly ('bold' | 'italic')[]): InlineNode =>
	marks === undefined
		? { text: value, type: 'text' }
		: { marks: marks.map((type) => ({ type })), text: value, type: 'text' };

const placeholder = (key: string, fallback: string | null = null): InlineNode => ({
	attrs: { fallback, key },
	type: 'placeholder',
});

const list = (
	type: 'bulletList' | 'orderedList',
	items: readonly string[],
): TextDoc['content'][number] => ({
	content: items.map((item) => ({
		content: [{ content: [text(item)], type: 'paragraph' }],
		type: 'listItem',
	})),
	type,
});

const INVITATION: TextDoc = {
	content: [
		{
			content: [
				text('Wir laden herzlich zu unserem '),
				text('Sommerfest', ['bold']),
				text(' ein. Es gibt Kuchen, '),
				text('Musik', ['italic']),
				text(' und ein Turnier für alle. Mehr dazu steht auf '),
				{
					marks: [{ attrs: { href: 'https://example.org/sommerfest' }, type: 'link' }],
					text: 'der Seite zum Sommerfest',
					type: 'text',
				},
				text('.'),
			],
			type: 'paragraph',
		},
		list('bulletList', ['Samstag, 12. Juli, ab 15 Uhr', 'Vereinsheim am Sportplatz']),
		{
			content: [text('Der Ablauf:')],
			type: 'paragraph',
		},
		list('orderedList', ['Begrüßung', 'Turnier', 'Grillen']),
		{
			content: [
				text('Fragen beantwortet das Büro unter '),
				{
					marks: [{ attrs: { href: 'tel:+4912345678' }, type: 'link' }],
					text: '012345 678',
					type: 'text',
				},
				text(' oder per '),
				{
					marks: [{ attrs: { href: 'mailto:info@example.org' }, type: 'link' }],
					text: 'Mail an das Büro',
					type: 'text',
				},
				text('. Mitgliedsnummer: '),
				placeholder('contact.memberNumber', 'liegt uns nicht vor'),
			],
			type: 'paragraph',
		},
	],
	type: 'doc',
};

const CLOSING: TextDoc = {
	content: [
		{
			content: [text('Viele Grüße'), { type: 'hardBreak' }, placeholder('brand.name')],
			type: 'paragraph',
		},
	],
	type: 'doc',
};

const SAMPLE_BLOCKS: readonly Block[] = [
	{ content: [text('Einladung zum Sommerfest')], id: 'sample-heading', level: 1, type: 'heading' },
	{
		id: 'sample-salutation',
		ref: { fallback: null, key: 'salutation' },
		suffix: ',',
		type: 'placeholderLine',
	},
	{ doc: INVITATION, id: 'sample-text', type: 'text' },
	{
		alt: 'Das Vereinsheim im Sommer',
		decorative: false,
		href: null,
		id: 'sample-image',
		mediaId: null,
		type: 'image',
	},
	{
		align: 'center',
		href: 'https://example.org/sommerfest/anmeldung',
		id: 'sample-button',
		label: [text('Zum Sommerfest anmelden')],
		type: 'button',
	},
	{ id: 'sample-divider', type: 'divider' },
	{ content: [text('Das Programm')], id: 'sample-program', level: 2, type: 'heading' },
	{
		id: 'sample-columns',
		left: [
			{ content: [text('Für Kinder')], id: 'sample-kids', level: 3, type: 'heading' },
			{
				doc: {
					content: [
						{ content: [text('Hüpfburg und Kinderschminken ab 15 Uhr.')], type: 'paragraph' },
					],
					type: 'doc',
				},
				id: 'sample-kids-text',
				type: 'text',
			},
		],
		right: [
			{ content: [text('Für Erwachsene')], id: 'sample-adults', level: 3, type: 'heading' },
			{
				doc: {
					content: [
						{ content: [text('Ab 18 Uhr spielt die Band „Die Beispiele“.')], type: 'paragraph' },
					],
					type: 'doc',
				},
				id: 'sample-adults-text',
				type: 'text',
			},
		],
		type: 'columns',
	},
	{ id: 'sample-spacer', size: 'medium', type: 'spacer' },
	{ doc: CLOSING, id: 'sample-closing', type: 'text' },
];

export { SAMPLE_BLOCKS, SAMPLE_CONTACTS };
export type { SampleContactKind };
