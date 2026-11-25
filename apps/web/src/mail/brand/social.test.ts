/* oxlint-disable no-script-url -- the tests feed such URLs on purpose to see them refused */
import { describe, expect, it } from 'vite-plus/test';

import { SOCIAL_PLATFORMS } from './brand-schema';
import { detectPlatform, socialIconPath } from './social';

describe(detectPlatform, () => {
	it.each([
		['https://www.instagram.com/verein', 'instagram'],
		['https://instagram.com/verein', 'instagram'],
		['https://www.facebook.com/verein', 'facebook'],
		['https://fb.com/verein', 'facebook'],
		['https://www.youtube.com/@verein', 'youtube'],
		['https://youtu.be/abc', 'youtube'],
		['https://www.tiktok.com/@verein', 'tiktok'],
		['https://bsky.app/profile/verein.example', 'bluesky'],
		['https://www.threads.net/@verein', 'threads'],
		['https://www.threads.com/@verein', 'threads'],
		['https://x.com/verein', 'x'],
		['https://twitter.com/verein', 'x'],
		['https://wa.me/4915100000', 'whatsapp'],
		['https://chat.whatsapp.com/abc', 'whatsapp'],
		['https://social.example/@verein', 'mastodon'],
		['https://mastodon.social/@verein', 'mastodon'],
	])('recognizes %s as %s', (url, platform) => {
		expect(detectPlatform(url)).toBe(platform);
	});

	it.each([
		'http://instagram.com/x',
		'https://example.org',
		'https://example.org/page',
		'https://notinstagram.com/x',
		'https://instagram.com.evil.example/x',
		'mailto:verein@example.org',
		'javascript:alert(1)',
		'not a url',
		'',
	])('gives null for %s', (url) => {
		expect(detectPlatform(url)).toBeNull();
	});
});

describe(socialIconPath, () => {
	it('names the file of a platform and variant', () => {
		expect(socialIconPath('instagram', 'dark')).toBe('/social/instagram-dark.png');
		expect(socialIconPath('mastodon', 'brand')).toBe('/social/mastodon-brand.png');
	});

	it('knows the platforms of the icon set', () => {
		expect(SOCIAL_PLATFORMS).toContain('instagram');
		expect(SOCIAL_PLATFORMS).not.toContain('linkedin');
	});
});
