import { describe, expect, it } from 'vite-plus/test';

import type { Block } from '@/mail/blocks/block-schema';
import { DEFAULT_BRAND } from '@/mail/brand/brand-schema';
import type { Brand } from '@/mail/brand/brand-schema';
import { contactPlaceholderValues } from '@/mail/placeholders/contact-values';
import type { ContactValueSource } from '@/mail/placeholders/contact-values';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import type { SalutationTexts } from '@/mail/placeholders/salutation';
import { SAMPLE_BLOCKS, SAMPLE_CONTACTS } from '@/mail/sample';
import type { FieldKey } from '@/server/contacts/fields';

import { compileMail } from './compile';
import type { MailSource } from './compile';
import { fillMail } from './fill';
import type { FilledMail } from './fill';

const ORIGIN = 'https://verein.example';
const IMAGE_ID = 'IMAGE_aaaaaaaaaaaaaaaa';
const HEADER_LOGO_ID = 'HEADER_LOGO_aaaaaaaaaa';
const FOOTER_LOGO_ID = 'FOOTER_LOGO_aaaaaaaaaa';
const ALL_FIELDS: ReadonlySet<FieldKey> = new Set<FieldKey>([
	'address',
	'birthDate',
	'entryDate',
	'exitDate',
]);
const MEDIA = new Map([[IMAGE_ID, { height: 800, type: 'jpeg' as const, width: 1200 }]]);

/** A brand with every optional value set. */
const FULL_BRAND: Brand = {
	colors: {
		background: '#fffdf7',
		link: '#0b5394',
		primary: '#b91c1c',
		secondary: '#1e3a5f',
		text: '#111827',
	},
	fonts: { heading: 'georgia', headingWish: 'Merriweather', text: 'verdana', textWish: null },
	footer: {
		address: 'TSV Beispielstadt e. V.\nSportplatzweg 1\n12345 Beispielstadt',
		iconVariant: 'light',
		imprintUrl: 'https://verein.example/impressum',
		links: [
			{ display: 'icon', label: 'Instagram', url: 'https://www.instagram.com/tsv.beispiel' },
			{ display: 'icon', label: 'Facebook', url: 'https://facebook.com/tsv.beispiel' },
			{ display: 'icon', label: 'Mastodon', url: 'https://social.example/@tsv' },
			{ display: 'icon', label: 'Vereinsblog', url: 'https://blog.verein.example' },
			{ display: 'text', label: 'Kontakt', url: 'mailto:info@verein.example' },
		],
		privacyUrl: 'https://verein.example/datenschutz',
		register: 'Amtsgericht Beispielstadt, VR 1234',
		text: 'Du bekommst diese Mail als Mitglied.\nFragen? Schreib uns.',
		websiteUrl: 'https://verein.example',
	},
	footerLogo: { alt: '', height: 120, mediaId: FOOTER_LOGO_ID, type: 'png', width: 120 },
	headerLogo: {
		alt: 'TSV Beispielstadt',
		height: 200,
		mediaId: HEADER_LOGO_ID,
		type: 'png',
		width: 800,
	},
	logoAlign: 'center',
	name: 'TSV Beispielstadt',
};

/**
 * Compiles blocks in the standard layout and fills them for a sample contact.
 *
 * @param blocks The blocks.
 * @param options The brand, the contact and the salutation texts.
 * @param options.brand The brand; the default brand unless given.
 * @param options.contact The contact; the female sample unless given.
 * @param options.salutation The salutation texts; the Du form unless given.
 * @param options.unsubscribe The address of the unsubscribe link; none unless given.
 * @returns The filled mail.
 */
async function renderSample(
	blocks: readonly Block[],
	options: Readonly<{
		brand?: Brand;
		contact?: ContactValueSource;
		salutation?: SalutationTexts;
		unsubscribe?: string;
	}> = {},
): Promise<FilledMail> {
	const source: MailSource = {
		body: { blocks, kind: 'blocks', layout: { kind: 'standard' } },
		media: MEDIA,
		preheader: 'Alles zum Sommerfest, {{contact.firstName | ""}}',
		subject: 'Sommerfest für {{contact.displayName}}',
	};
	const compiled = await compileMail(source, options.brand ?? DEFAULT_BRAND, ORIGIN, 'de', {
		unsubscribe: options.unsubscribe !== undefined,
	});
	if (!compiled.ok) throw new Error(`compile failed: ${JSON.stringify(compiled)}`);
	const values = contactPlaceholderValues(
		options.contact ?? SAMPLE_CONTACTS.female,
		ALL_FIELDS,
		[],
		options.salutation ?? DEFAULT_SALUTATIONS.du,
	);
	if (options.unsubscribe !== undefined) values.set('unsubscribe.url', options.unsubscribe);
	const result = fillMail(compiled.mail, values);
	if (!result.ok) throw new Error(`fill failed: ${result.missing.join(', ')}`);
	return result.mail;
}

/**
 * One tag per line, so a snapshot can be read and its diff points at the changed element.
 *
 * @param html The HTML.
 * @returns The HTML with a line break between tags.
 */
function lines(html: string): string {
	return html.replaceAll('><', '>\n<');
}

const MARKER = /[\uE000\uE001]/u;
const EMPTY_LINK = /<a\b[^>]*><\/a>/u;
const TABLE = /<table\b[^>]*>/gu;
const LOW_HEADING = /<h[4-6]\b/u;
const LIGHT_ICON = /src="https:\/\/verein\.example\/social\/[a-z]+-light\.png"/gu;

/**
 * What a rendered mail must never have: placeholder syntax or markers, a missing language, an
 * empty link, a layout table that screen readers announce, a heading below `h3`.
 *
 * @param mail The filled mail.
 * @returns The names of the problems found; empty for a clean mail.
 */
function problems(mail: Readonly<FilledMail>): string[] {
	const all = `${mail.subject}${mail.preheader}${mail.html}${mail.text}`;
	const tables = [...mail.html.matchAll(TABLE)].map(([table]) => table);
	const checks: [string, boolean][] = [
		['placeholder syntax', all.includes('{{')],
		['marker', MARKER.test(all)],
		['language', !mail.html.includes('<html lang="de"')],
		['empty href', mail.html.includes('href=""')],
		['empty link', EMPTY_LINK.test(mail.html)],
		['table without role', tables.some((table) => !table.includes('role="presentation"'))],
		['heading below h3', LOW_HEADING.test(mail.html)],
	];
	return checks.filter(([, found]) => found).map(([name]) => name);
}

/**
 * The texts an HTML lacks.
 *
 * @param html The HTML.
 * @param parts The texts it should contain.
 * @returns The missing texts.
 */
function missingIn(html: string, parts: readonly string[]): string[] {
	return parts.filter((part) => !html.includes(part));
}

/** Each block alone; the image with an image of the collection. */
const SINGLE_BLOCKS: readonly (readonly [name: string, block: Block])[] = [
	...SAMPLE_BLOCKS.filter((block) => block.type !== 'image').map(
		(block) => [`${block.type} ${block.id}`, block] as const,
	),
	[
		'image',
		{
			alt: 'Das Vereinsheim im Sommer',
			decorative: false,
			href: 'https://verein.example/galerie',
			id: 'image',
			mediaId: IMAGE_ID,
			type: 'image',
		},
	],
	[
		'decorative image',
		{ alt: '', decorative: true, href: null, id: 'image', mediaId: IMAGE_ID, type: 'image' },
	],
];

describe('the rendered mails', () => {
	it('render the sample blocks in the default brand', async () => {
		const mail = await renderSample(SAMPLE_BLOCKS);
		expect(problems(mail)).toStrictEqual([]);
		expect(missingIn(mail.html, ['<h1 ', '<h2 ', '<h3 '])).toStrictEqual([]);
		expect(mail.subject).toBe('Sommerfest für Anna Beispiel');
		expect(lines(mail.html)).toMatchSnapshot('html');
		expect(mail.text).toMatchSnapshot('text');
	});

	it('render the full brand with logos and five footer links, three as icons', async () => {
		const mail = await renderSample(SAMPLE_BLOCKS, { brand: FULL_BRAND });
		expect(problems(mail)).toStrictEqual([]);
		expect(mail.html.match(LIGHT_ICON)).toHaveLength(3);
		expect(
			missingIn(mail.html, [
				'alt="Instagram"',
				'alt="Mastodon"',
				'>Vereinsblog</a>',
				`src="${ORIGIN}/media/${HEADER_LOGO_ID}.png"`,
				`src="${ORIGIN}/media/${FOOTER_LOGO_ID}.png"`,
			]),
		).toStrictEqual([]);
		expect(lines(mail.html)).toMatchSnapshot('html');
		expect(mail.text).toMatchSnapshot('text');
	});

	it('render the unsubscribe link at the end of the footer of the full brand', async () => {
		const unsubscribe = `${ORIGIN}/unsubscribe/token`;
		const mail = await renderSample(SAMPLE_BLOCKS, { brand: FULL_BRAND, unsubscribe });
		expect(problems(mail)).toStrictEqual([]);
		expect(missingIn(mail.html, [`href="${unsubscribe}"`, '>Abmelden</a>'])).toStrictEqual([]);
		expect(mail.text.endsWith(`Abmelden ${unsubscribe}`)).toBe(true);
		expect(lines(mail.html)).toMatchSnapshot('html');
		expect(mail.text).toMatchSnapshot('text');
	});

	it('render the Sie form for a firm', async () => {
		const mail = await renderSample(SAMPLE_BLOCKS, {
			contact: SAMPLE_CONTACTS.organization,
			salutation: DEFAULT_SALUTATIONS.sie,
		});
		expect(problems(mail)).toStrictEqual([]);
		expect(mail.text).toContain('Sehr geehrte Damen und Herren');
		expect(lines(mail.html)).toMatchSnapshot('html');
		expect(mail.text).toMatchSnapshot('text');
	});

	it.each(SINGLE_BLOCKS)('render the %s block alone', async (_name, block) => {
		const mail = await renderSample([block]);
		expect(problems(mail)).toStrictEqual([]);
		expect(lines(mail.html)).toMatchSnapshot('html');
		expect(mail.text).toMatchSnapshot('text');
	});

	it('render a salutation for every sample contact', async () => {
		const salutations = await Promise.all(
			(['female', 'male', 'diverse', 'organization'] as const).map(async (kind) => {
				const mail = await renderSample(
					[
						{
							id: 'line',
							ref: { fallback: null, key: 'salutation' },
							suffix: ',',
							type: 'placeholderLine',
						},
					],
					{ contact: SAMPLE_CONTACTS[kind] },
				);
				return mail.text.split('\n')[0];
			}),
		);
		expect(salutations).toStrictEqual([
			'Liebe Anna,',
			'Lieber Bernd,',
			'Hallo Kim,',
			'Sehr geehrte Damen und Herren,',
		]);
	});
});
