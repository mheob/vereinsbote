/*
 * The sample mails of `mail:sample`: the standard layout filled with invented contacts, for a look
 * at the result in real mail clients (Mailpit can relay them). Mailboxes cannot reach `localhost`,
 * so every image of the app (the photo, the logos, the social icons) goes with the mail as an
 * inline attachment and the HTML points at it with `cid:`.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Block } from '@/mail/blocks/block-schema';
import { DEFAULT_BRAND, ICON_VARIANTS, SOCIAL_PLATFORMS } from '@/mail/brand/brand-schema';
import type { Brand } from '@/mail/brand/brand-schema';
import { socialIconPath } from '@/mail/brand/social';
import { contactPlaceholderValues } from '@/mail/placeholders/contact-values';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import type { SalutationForm } from '@/mail/placeholders/salutation';
import { compileMail } from '@/mail/render/compile';
import type { MailSource } from '@/mail/render/compile';
import { fillMail } from '@/mail/render/fill';
import type { FilledMail } from '@/mail/render/fill';
import { SAMPLE_BLOCKS, SAMPLE_CONTACTS } from '@/mail/sample';
import type { SampleContactKind } from '@/mail/sample';
import { withoutTrailingSlashes } from '@/mail/trailing-slashes';
import type { FieldKey } from '@/server/contacts/fields';
import { mediaPath } from '@/server/media/ids';

import { PHOTO_HEIGHT, PHOTO_WIDTH, samplePhoto } from './sample-photo';

interface SampleAttachment {
	cid: string;
	path: string;
	contentType: string;
}

interface SampleMail {
	name: string;
	mail: FilledMail;
	attachments: SampleAttachment[];
}

/** A made-up id of the sample photo; the mail shows it as the photo and as both logos. */
const PHOTO_ID = 'SAMPLE_PHOTO_aaaaaaaaa';
const PHOTO_CID = 'sample-photo';
const ALL_FIELDS: ReadonlySet<FieldKey> = new Set<FieldKey>([
	'address',
	'birthDate',
	'entryDate',
	'exitDate',
]);
/** `public/social`, relative to this file (`src/server/mail`). */
const SOCIAL_DIRECTORY = fileURLToPath(new URL('../../../public/social/', import.meta.url));

const written: { photo?: Promise<string> } = {};

/**
 * Makes the sample photo and writes it to a file in a new temporary directory.
 *
 * @returns The path of the file.
 */
async function writePhoto(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), 'vereinsbote-sample-'));
	const file = path.join(directory, 'photo.png');
	await writeFile(file, await samplePhoto());
	return file;
}

/**
 * Writes the sample photo to a temporary file, once per process.
 *
 * @returns The path of the file.
 */
async function photoPath(): Promise<string> {
	written.photo ??= writePhoto();
	return written.photo;
}

/** A club with every optional value of the brand set. */
const FULL_BRAND: Brand = {
	colors: {
		background: '#ffffff',
		link: '#0b5394',
		primary: '#1e3a8a',
		secondary: '#e8eef7',
		text: '#111827',
	},
	fonts: { heading: 'georgia', headingWish: 'Merriweather', text: 'verdana', textWish: null },
	footer: {
		address: 'TSV Beispielstadt e. V.\nSportplatzweg 1\n12345 Beispielstadt',
		iconVariant: 'dark',
		imprintUrl: 'https://verein.example/impressum',
		links: [
			{ display: 'icon', label: 'Instagram', url: 'https://www.instagram.com/tsv.beispiel' },
			{ display: 'icon', label: 'Facebook', url: 'https://facebook.com/tsv.beispiel' },
			{ display: 'icon', label: 'Mastodon', url: 'https://social.example/@tsv' },
			{ display: 'text', label: 'Kontakt', url: 'mailto:info@verein.example' },
		],
		privacyUrl: 'https://verein.example/datenschutz',
		register: 'Amtsgericht Beispielstadt, VR 1234',
		text: 'Du bekommst diese Mail als Mitglied.\nFragen? Schreib uns.',
		websiteUrl: 'https://verein.example',
	},
	footerLogo: { alt: '', height: PHOTO_HEIGHT, mediaId: PHOTO_ID, type: 'png', width: PHOTO_WIDTH },
	headerLogo: {
		alt: 'TSV Beispielstadt',
		height: PHOTO_HEIGHT,
		mediaId: PHOTO_ID,
		type: 'png',
		width: PHOTO_WIDTH,
	},
	logoAlign: 'left',
	name: 'TSV Beispielstadt',
};

/**
 * Gives the image block the sample photo.
 *
 * @param block A block of the sample.
 * @returns The block, with the photo when it is the image.
 */
function withPhoto(block: Block): Block {
	return block.type === 'image' ? { ...block, mediaId: PHOTO_ID } : block;
}

/** The sample blocks with the sample photo in the image block. */
const BLOCKS: readonly Block[] = SAMPLE_BLOCKS.map((block) => withPhoto(block));

/** A short mail: a salutation and two columns. */
const COLUMN_BLOCKS: readonly Block[] = [
	...BLOCKS.filter((block) => block.id === 'sample-salutation'),
	...BLOCKS.filter((block) => block.type === 'columns'),
	...BLOCKS.filter((block) => block.id === 'sample-closing'),
];

interface SampleSpec {
	name: string;
	subject: string;
	blocks: readonly Block[];
	brand: Brand;
	contact: SampleContactKind;
	form: SalutationForm;
}

const SPECS: readonly SampleSpec[] = [
	{
		blocks: BLOCKS,
		brand: DEFAULT_BRAND,
		contact: 'female',
		form: 'du',
		name: 'standard-informal',
		subject: 'Beispiel 1: Sommerfest bei {{brand.name}}, du-Form',
	},
	{
		blocks: BLOCKS,
		brand: DEFAULT_BRAND,
		contact: 'organization',
		form: 'sie',
		name: 'formal-organization',
		subject: 'Beispiel 2: Sommerfest bei {{brand.name}}, Sie-Form an eine Firma',
	},
	{
		blocks: COLUMN_BLOCKS,
		brand: DEFAULT_BRAND,
		contact: 'male',
		form: 'du',
		name: 'two-columns',
		subject: 'Beispiel 3: Zwei Spalten bei {{brand.name}}',
	},
	{
		blocks: BLOCKS,
		brand: FULL_BRAND,
		contact: 'diverse',
		form: 'du',
		name: 'full-brand',
		subject: 'Beispiel 4: {{brand.name}} mit Logos und Icon-Links',
	},
];

/**
 * Compiles and fills one sample mail.
 *
 * @param spec What the mail shows.
 * @param appOrigin The origin the images would be served from.
 * @returns The mail with absolute image addresses.
 */
async function fillSample(spec: Readonly<SampleSpec>, appOrigin: string): Promise<FilledMail> {
	const source: MailSource = {
		body: { blocks: spec.blocks, kind: 'blocks', layout: { kind: 'standard' } },
		media: new Map([[PHOTO_ID, { height: PHOTO_HEIGHT, type: 'png', width: PHOTO_WIDTH }]]),
		preheader: 'Samstag, 12. Juli, ab 15 Uhr im Vereinsheim',
		subject: spec.subject,
	};
	const compiled = await compileMail(source, spec.brand, appOrigin);
	if (!compiled.ok) throw new Error(`The sample mail ${spec.name} does not compile.`);
	const values = contactPlaceholderValues(
		SAMPLE_CONTACTS[spec.contact],
		ALL_FIELDS,
		[],
		DEFAULT_SALUTATIONS[spec.form],
	);
	const filled = fillMail(compiled.mail, values);
	if (!filled.ok) throw new Error(`The sample mail ${spec.name} lacks values.`);
	return filled.mail;
}

interface ImageFile {
	url: string;
	cid: string;
	file: string;
}

/**
 * Every image of the app a sample mail may show: the photo and the icons.
 *
 * @param origin The origin without a trailing slash.
 * @returns The address, the `cid` and the file of each.
 */
async function imageFiles(origin: string): Promise<ImageFile[]> {
	const icons = SOCIAL_PLATFORMS.flatMap((platform) =>
		ICON_VARIANTS.map((variant) => ({
			cid: `social-${platform}-${variant}`,
			file: path.join(SOCIAL_DIRECTORY, path.basename(socialIconPath(platform, variant))),
			url: `${origin}${socialIconPath(platform, variant)}`,
		})),
	);
	const photo = {
		cid: PHOTO_CID,
		file: await photoPath(),
		url: `${origin}${mediaPath(PHOTO_ID, 'png')}`,
	};
	return [photo, ...icons];
}

/**
 * Replaces the addresses of the app's images with `cid:` references.
 *
 * @param mail The mail.
 * @param images The images a mail may show.
 * @returns The mail with `cid:` images and the files it needs.
 */
function inlineImages(
	mail: Readonly<FilledMail>,
	images: readonly Readonly<ImageFile>[],
): { mail: FilledMail; attachments: SampleAttachment[] } {
	const used = images.filter(({ url }) => mail.html.includes(url));
	let { html } = mail;
	for (const { cid, url } of used) html = html.replaceAll(url, `cid:${cid}`);
	const attachments = used.map(({ cid, file }) => ({
		cid,
		contentType: 'image/png',
		path: file,
	}));
	return { attachments, mail: { ...mail, html } };
}

/**
 * Builds one sample mail.
 *
 * @param spec What the mail shows.
 * @param origin The origin of the app, without a trailing slash.
 * @param images The images a mail may show.
 * @returns The mail with its attachments.
 */
async function buildSampleMail(
	spec: Readonly<SampleSpec>,
	origin: string,
	images: readonly Readonly<ImageFile>[],
): Promise<SampleMail> {
	const { attachments, mail } = inlineImages(await fillSample(spec, origin), images);
	return { attachments, mail, name: spec.name };
}

/**
 * Builds the sample mails: the standard layout with all blocks (informal, a woman), the formal
 * form to a company, two columns, and the full brand with logos and icon links. Contacts are
 * invented.
 *
 * @param appOrigin The origin of the app; image addresses on it become `cid:` references.
 * @returns The mails with the files their images need.
 */
async function buildSampleMails(appOrigin: string): Promise<SampleMail[]> {
	const origin = withoutTrailingSlashes(appOrigin);
	const images = await imageFiles(origin);
	return Promise.all(SPECS.map(async (spec) => buildSampleMail(spec, origin, images)));
}

export { buildSampleMails };
export type { SampleAttachment, SampleMail };
