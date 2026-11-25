import { Fragment } from 'react';
import type { ReactNode } from 'react';

import type { Locale } from '@/i18n/locale';
import { translate } from '@/i18n/translate';
import type { Brand, BrandLogo, FooterLink, SocialPlatform } from '@/mail/brand/brand-schema';
import { detectPlatform, socialIconPath } from '@/mail/brand/social';
import { Container, LayoutTable } from '@/mail/components/container';
import { Image } from '@/mail/components/image';
import { Link } from '@/mail/components/link';
import { MailShell } from '@/mail/components/mail-shell';
import { Preheader } from '@/mail/components/preheader';
import { Row } from '@/mail/components/row';
import { Spacer } from '@/mail/components/spacer';
import { mediaPath } from '@/server/media/ids';

import { CONTENT_WIDTH, GUTTER } from './render-blocks';
import type { MailTheme } from './theme';

/** The box the header logo is fitted into, in pixels. */
const HEADER_LOGO_BOX = { height: 80, width: 240 } as const;
const FOOTER_LOGO_BOX = { height: 64, width: 160 } as const;
const ICON_SIZE = 24;
const ACCENT_HEIGHT = 4;
const LINE_BREAK = /\r\n|[\r\n]/u;
const SCHEME_PREFIX = /^(?:https:\/\/|mailto:)/u;

interface LayoutContext {
	readonly brand: Brand;
	readonly theme: MailTheme;
	/** The origin of the app, without a trailing slash. */
	readonly origin: string;
	readonly locale: Locale;
}

/**
 * The size of a logo fitted into a box, never enlarged.
 *
 * @param logo The logo.
 * @param box The box.
 * @param box.width The width of the box.
 * @param box.height The height of the box.
 * @returns The width and height in whole pixels.
 */
function fit(
	logo: BrandLogo,
	box: Readonly<{ width: number; height: number }>,
): { width: number; height: number } {
	const scale = Math.min(1, box.width / logo.width, box.height / logo.height);
	return {
		height: Math.max(1, Math.round(logo.height * scale)),
		width: Math.max(1, Math.round(logo.width * scale)),
	};
}

interface LogoProps {
	readonly logo: BrandLogo;
	readonly box: Readonly<{ width: number; height: number }>;
	readonly context: LayoutContext;
}

/**
 * A logo of the brand; its alternative text falls back to the club's name.
 *
 * @param props The logo props.
 * @param props.logo The logo.
 * @param props.box The box it is fitted into.
 * @param props.context The layout context.
 * @returns The image.
 */
function Logo({ box, context, logo }: LogoProps): ReactNode {
	const { height, width } = fit(logo, box);
	const alt = logo.alt.trim() === '' ? context.brand.name : logo.alt;
	return (
		<Image
			alt={alt}
			height={height}
			src={`${context.origin}${mediaPath(logo.mediaId, logo.type)}`}
			width={width}
		/>
	);
}

/**
 * A text with its line breaks kept.
 *
 * @param text The text.
 * @returns The lines with `<br>` between them.
 */
function withBreaks(text: string): ReactNode {
	return text.split(LINE_BREAK).map((line, index) => (
		<Fragment key={String(index)}>
			{index > 0 && <br />}
			{line}
		</Fragment>
	));
}

interface FooterLineProps {
	readonly children: ReactNode;
	readonly theme: MailTheme;
	readonly bold?: boolean;
}

/**
 * A line of the footer, in black or white on the secondary colour.
 *
 * @param props The line props.
 * @param props.children The content.
 * @param props.theme The theme.
 * @param props.bold Whether the line is bold.
 * @returns The row.
 */
function FooterLine({ bold = false, children, theme }: FooterLineProps): ReactNode {
	return (
		<Row align="center" padding={`0 ${String(GUTTER)}px 8px`}>
			<p
				style={{
					color: theme.footerText,
					fontFamily: theme.font,
					fontSize: 13,
					fontWeight: bold ? 'bold' : 'normal',
					lineHeight: '20px',
					margin: 0,
					msoLineHeightRule: 'exactly',
				}}
			>
				{children}
			</p>
		</Row>
	);
}

interface TextLink {
	readonly url: string;
	readonly label: string;
}

interface IconLink {
	readonly url: string;
	readonly platform: SocialPlatform;
}

/**
 * The text of a footer link: its label, else its address.
 *
 * @param link The link.
 * @returns The text.
 */
function linkText(link: FooterLink): string {
	return link.label.trim() === '' ? link.url.replace(SCHEME_PREFIX, '') : link.label;
}

/**
 * Sorts the footer links: icons for known platforms that should show as an icon, text for the
 * rest. The legal links come first.
 *
 * @param context The layout context.
 * @returns The text links and the icon links.
 */
function footerLinks(context: LayoutContext): { texts: TextLink[]; icons: IconLink[] } {
	const { footer } = context.brand;
	const fixed: [string | null, Parameters<typeof translate>[1]][] = [
		[footer.imprintUrl, 'mail.layout.imprint'],
		[footer.privacyUrl, 'mail.layout.privacy'],
		[footer.websiteUrl, 'mail.layout.website'],
	];
	const texts: TextLink[] = fixed.flatMap(([url, key]) =>
		url === null || url === '' ? [] : [{ label: translate(context.locale, key), url }],
	);
	const icons: IconLink[] = [];
	for (const link of footer.links) {
		const platform = link.display === 'icon' ? detectPlatform(link.url) : null;
		if (platform === null) texts.push({ label: linkText(link), url: link.url });
		else icons.push({ platform, url: link.url });
	}
	return { icons, texts };
}

/**
 * The footer: logo, name, address, register, links, icons and the free text. Empty values leave
 * their element out.
 *
 * @param props The footer props.
 * @param props.context The layout context.
 * @returns The rows.
 */
function Footer({ context }: { readonly context: LayoutContext }): ReactNode {
	const { brand, locale, origin, theme } = context;
	const { footer } = brand;
	const { icons, texts } = footerLinks(context);
	return (
		<>
			<Spacer height={24} />
			{brand.footerLogo !== null && (
				<Row align="center" padding={`0 ${String(GUTTER)}px 16px`}>
					<Logo box={FOOTER_LOGO_BOX} context={context} logo={brand.footerLogo} />
				</Row>
			)}
			<FooterLine bold theme={theme}>
				{brand.name}
			</FooterLine>
			{footer.address.trim() !== '' && (
				<FooterLine theme={theme}>{withBreaks(footer.address.trim())}</FooterLine>
			)}
			{footer.register.trim() !== '' && (
				<FooterLine theme={theme}>{footer.register.trim()}</FooterLine>
			)}
			{texts.length > 0 && (
				<FooterLine theme={theme}>
					{texts.map((link, index) => (
						<Fragment key={String(index)}>
							{index > 0 && <span aria-hidden="true">{' · '}</span>}
							<Link color={theme.footerText} href={link.url}>
								{link.label}
							</Link>
						</Fragment>
					))}
				</FooterLine>
			)}
			{icons.length > 0 && (
				<Row align="center" padding={`8px ${String(GUTTER)}px 16px`}>
					<LayoutTable align="center">
						<tr>
							{icons.map((link, index) => (
								<td key={String(index)} style={{ padding: '0 6px' }}>
									<a href={link.url} style={{ display: 'block', textDecoration: 'none' }}>
										<img
											alt={translate(locale, `mail.social.${link.platform}`)}
											height={ICON_SIZE}
											src={`${origin}${socialIconPath(link.platform, footer.iconVariant)}`}
											width={ICON_SIZE}
											style={{ border: 0, display: 'block', height: ICON_SIZE, width: ICON_SIZE }}
										/>
									</a>
								</td>
							))}
						</tr>
					</LayoutTable>
				</Row>
			)}
			{footer.text.trim() !== '' && (
				<FooterLine theme={theme}>{withBreaks(footer.text.trim())}</FooterLine>
			)}
			<Spacer height={24} />
		</>
	);
}

interface StandardLayoutProps {
	readonly context: LayoutContext;
	/** The subject with markers; the title of the document. */
	readonly subject: string;
	/** The preview text with markers; `''` for none. */
	readonly preheader: string;
	/** The rows of the blocks. */
	readonly children?: ReactNode;
}

/**
 * The standard layout (Design 8): the logo above an accent line in the primary colour, the
 * content area of 600 px on the secondary colour, and the footer of the brand.
 *
 * @param props The layout props.
 * @param props.context The layout context.
 * @param props.subject The subject.
 * @param props.preheader The preview text.
 * @param props.children The rows of the blocks.
 * @returns The mail document.
 */
function StandardLayout({ children, context, preheader, subject }: StandardLayoutProps): ReactNode {
	const { brand, locale, theme } = context;
	return (
		<MailShell backgroundColor={theme.secondary} lang={locale} title={subject}>
			{preheader !== '' && <Preheader text={preheader} />}
			<LayoutTable backgroundColor={theme.secondary} width="100%">
				<Row align="center" className="vb-page" padding="24px 0">
					<Container backgroundColor={theme.background} width={CONTENT_WIDTH}>
						{brand.headerLogo !== null && (
							<Row align={brand.logoAlign} padding={`24px ${String(GUTTER)}px`}>
								<Logo box={HEADER_LOGO_BOX} context={context} logo={brand.headerLogo} />
							</Row>
						)}
						<Spacer backgroundColor={theme.primary} height={ACCENT_HEIGHT} />
						<Spacer height={32} />
						{children}
						<Spacer height={16} />
					</Container>
					<Container width={CONTENT_WIDTH}>
						<Footer context={context} />
					</Container>
				</Row>
			</LayoutTable>
		</MailShell>
	);
}

export { StandardLayout };
export type { LayoutContext };
