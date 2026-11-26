import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vite-plus/test';

import { translate } from '@/i18n/translate';
import type { MessageKey, MessageParams } from '@/i18n/translate';
import type { SkipReason } from '@/server/waves/preparer';

import {
	countsText,
	ENTRY_STATUSES,
	entryCodeText,
	entryStatusText,
	isKnownEntryCode,
	waveStateText,
} from './overview-texts';

/** Every reason the preparer skips an entry for; the type keeps the list complete. */
const SKIP_REASONS = {
	addressChanged: true,
	deleted: true,
	exited: true,
	invalidEmail: true,
	noEmail: true,
	optedOutArea: true,
	optedOutOccasion: true,
	suppressed: true,
} as const satisfies Record<SkipReason, true>;

/**
 * The modules that write an entry's code, or hand one to the outbox: the outbox and its step, the
 * provider adapters, the platform's subrequest budget and the bounces.
 */
const CODE_SOURCES = [
	'../../platform/subrequests.ts',
	'../../server/bounces/bounces.ts',
	'../../server/sending/graph.ts',
	'../../server/sending/mime.ts',
	'../../server/sending/outbox-step.ts',
	'../../server/sending/outbox.ts',
	'../../server/sending/resend.ts',
	'../../server/sending/transport.ts',
] as const;

/** A code literal of those modules, e.g. `'graph.mailbox'`. */
const CODE_LITERAL = /'(?<code>(?:bounce|graph|mime|outbox|platform|resend)\.[A-Za-z]+)'/gu;
/** A failure code of the preparer, e.g. `code: 'attachmentMissing'`. */
const PREPARER_CODE = /code: '(?<code>[A-Za-z]+)'/gu;

/**
 * Reads a module of the app.
 *
 * @param path The path, relative to this file.
 * @returns The source.
 */
async function source(path: string): Promise<string> {
	return readFile(new URL(path, import.meta.url), 'utf8');
}

/**
 * The codes a pattern finds in a text.
 *
 * @param text The text.
 * @param pattern The pattern with a group `code`.
 * @returns The codes.
 */
function codesIn(text: string, pattern: Readonly<RegExp>): string[] {
	return [...text.matchAll(pattern)].flatMap((match) => match.groups?.code ?? []);
}

/**
 * Translates into German.
 *
 * @param key The key.
 * @param params The parameters.
 * @returns The text.
 */
function t(key: MessageKey, params?: MessageParams): string {
	return translate('de', key, params);
}

describe(entryCodeText, () => {
	it('has a text for every code the outbox, the preparer and bounces can write', async () => {
		const sources = await Promise.all(CODE_SOURCES.map(async (path) => source(path)));
		const written = sources.flatMap((text) => codesIn(text, CODE_LITERAL));
		const preparer = await source('../../server/waves/preparer.ts');
		const failures = codesIn(preparer, PREPARER_CODE);
		// The scan still finds the codes it is meant to find.
		expect(written).toStrictEqual(
			expect.arrayContaining([
				'bounce.hard',
				'graph.mailbox',
				'outbox.keyExpired',
				'resend.domain',
			]),
		);
		expect(failures).toStrictEqual(['attachmentMissing', 'waveGone']);
		expect(preparer).toContain('`missing:${');
		const codes = [
			...new Set([...written, ...failures, ...Object.keys(SKIP_REASONS)]),
			// What a user who may not see exit dates gets for `exited` (ruling R10).
			'unavailable',
		];
		expect(codes.filter((code) => !isKnownEntryCode(code))).toStrictEqual([]);
	});

	it('says each code in both languages', () => {
		for (const code of ['bounce.hard', 'graph.recipient', 'outbox.keyExpired', 'exited']) {
			const german = entryCodeText(code, t);
			const english = entryCodeText(code, (key, params) => translate('en', key, params));
			expect(german).not.toBe(english);
			expect(german).not.toContain(code);
		}
		expect(entryCodeText('bounce.hard', t)).toBe(
			'Rückläufer: Die Adresse gibt es nicht oder sie nimmt keine Mails an.',
		);
	});

	it('names the key of a missing required value', () => {
		expect(entryCodeText('missing:contact.firstName', t)).toBe(
			'Pflichtwert fehlt: contact.firstName',
		);
		expect(isKnownEntryCode('missing:contact.firstName')).toBe(false);
	});

	it('falls back to a generic text that names an unknown code', () => {
		expect(entryCodeText('graph.somethingNew', t)).toBe(
			'Unbekannter Fehler (Code: graph.somethingNew)',
		);
		expect(isKnownEntryCode('toString')).toBe(false);
	});
});

describe(entryStatusText, () => {
	it('names every status once', () => {
		expect(new Set(ENTRY_STATUSES).size).toBe(8);
		const texts = ENTRY_STATUSES.map((status) => entryStatusText(status, t));
		expect(new Set(texts).size).toBe(8);
		expect(entryStatusText('uncertain', t)).toBe('Unklar');
	});
});

describe(countsText, () => {
	it('lists the statuses with entries, the outcome first', () => {
		const counts = {
			bounced: 0,
			cancelled: 0,
			failed: 1,
			planned: 2,
			sending: 0,
			sent: 3,
			skipped: 0,
			uncertain: 0,
		};
		expect(countsText(counts, t)).toBe('Gesendet: 3, Geplant: 2, Fehlgeschlagen: 1');
		expect(countsText({ ...counts, failed: 0, planned: 0, sent: 0 }, t)).toBe('Keine Einträge');
	});
});

describe(waveStateText, () => {
	it('names the four states', () => {
		const states = (['planned', 'running', 'done', 'stopped'] as const).map((state) =>
			waveStateText(state, t),
		);
		expect(states).toStrictEqual(['Geplant', 'Läuft', 'Fertig', 'Gestoppt']);
	});
});
