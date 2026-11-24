/*
 * Social media links of the footer: which platform an address belongs to, and the icon files the
 * app serves itself (`public/social`, made by `scripts/build-social-icons.ts`).
 */
import type { IconVariant, SocialPlatform } from './brand-schema';

const HOSTS: Readonly<Record<string, SocialPlatform>> = {
	'bsky.app': 'bluesky',
	'chat.whatsapp.com': 'whatsapp',
	'facebook.com': 'facebook',
	'fb.com': 'facebook',
	'instagram.com': 'instagram',
	'threads.com': 'threads',
	'threads.net': 'threads',
	'tiktok.com': 'tiktok',
	'twitter.com': 'x',
	'wa.me': 'whatsapp',
	'whatsapp.com': 'whatsapp',
	'x.com': 'x',
	'youtu.be': 'youtube',
	'youtube.com': 'youtube',
};

const WWW = 'www.';
/** A Mastodon profile: `/@name` on any host. */
const MASTODON_PATH = /^\/@[^/]+/u;

/**
 * The platform of an address.
 *
 * @param url The address.
 * @returns The platform, or null for any address that is not an `https:` URL of a known platform.
 */
function detectPlatform(url: string): SocialPlatform | null {
	if (!URL.canParse(url)) return null;
	const parsed = new URL(url);
	if (parsed.protocol !== 'https:') return null;
	const host = parsed.hostname.startsWith(WWW)
		? parsed.hostname.slice(WWW.length)
		: parsed.hostname;
	const known = Object.hasOwn(HOSTS, host) ? HOSTS[host] : undefined;
	if (known !== undefined) return known;
	return MASTODON_PATH.test(parsed.pathname) ? 'mastodon' : null;
}

/**
 * The path of an icon on the app.
 *
 * @param platform The platform.
 * @param variant The colour variant.
 * @returns `/social/<platform>-<variant>.png`.
 */
function socialIconPath(platform: SocialPlatform, variant: IconVariant): string {
	return `/social/${platform}-${variant}.png`;
}

export { detectPlatform, socialIconPath };
