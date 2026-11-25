import { describe, expect, it } from 'vite-plus/test';

import { translate } from '@/i18n/translate';
import type { ImportFinding, ImportRefusal } from '@/server/html-import/import-html';

import { findingGroups, refusalMessages } from './messages';

const t = (
	key: Parameters<typeof translate>[1],
	params?: Parameters<typeof translate>[2],
): string => translate('de', key, params);

describe(findingGroups, () => {
	it('sorts removed things from warnings and words each of them', () => {
		const findings: ImportFinding[] = [
			{ count: 2, kind: 'removed', what: 'script' },
			{ count: 1, kind: 'removed', what: 'unsafeUrl' },
			{ count: 3, kind: 'outlookCss', property: 'gap' },
			{ count: 1, kind: 'altMissing' },
			{ count: 2, kind: 'tablePresentation' },
			{ kind: 'vagueLink', text: 'hier' },
			{ kind: 'headingOrder', level: 4 },
			{ host: 'cdn.example', kind: 'externalImage' },
			{ bytes: 150 * 1024, kind: 'clipped' },
			{ kind: 'langAdded' },
		];
		const groups = findingGroups(findings, t);
		expect(groups.removed.map(({ text }) => text)).toStrictEqual([
			'Skripte: 2',
			'Links und Bilder mit unsicherer Adresse, zum Beispiel javascript: 1',
		]);
		expect(groups.warnings.map(({ text }) => text)).toStrictEqual([
			'Outlook für Windows ignoriert „gap“ (3-mal).',
			'Bilder ohne Alternativtext: 1.',
			'Tabellen ohne role="presentation": 2. Screenreader lesen sie sonst als Datentabellen vor.',
			'Der Link-Text „hier“ sagt ohne seine Umgebung wenig.',
			'Die Überschriften springen auf Ebene 4.',
			'Ein Bild liegt bei cdn.example. Postfächer blockieren Bilder fremder Server oft, und der Anbieter sieht, wer die Mail öffnet.',
			'Das HTML ist 150 KB groß. Gmail kürzt Mails ab 102 KB ab.',
			'Die Sprache fehlte und wurde auf Deutsch gesetzt.',
		]);
		const keys = [...groups.removed, ...groups.warnings].map(({ key }) => key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('finds nothing in no findings', () => {
		expect(findingGroups([], t)).toStrictEqual({ removed: [], warnings: [] });
	});
});

describe(refusalMessages, () => {
	it('gives every refusal its own clear message', () => {
		const refusals: ImportRefusal[] = [
			{ kind: 'tooLarge' },
			{ key: 'contact.firstName', kind: 'placeholderForbidden' },
			{ key: 'contact.custom.verein', kind: 'placeholderUnknown' },
			{ attribute: 'href', key: 'brand.website', kind: 'placeholderInAttribute' },
			{ attribute: 'href', key: 'brand.website', kind: 'fallbackNotAllowed' },
			{ key: 'contact.firstName', kind: 'placeholderInComment' },
			{ kind: 'placeholderHidden' },
			{ kind: 'tooDeep' },
			{ kind: 'contentMissing' },
			{ kind: 'contentRepeated' },
			{ kind: 'mediaForeign', mediaId: 'abc' },
			{ kind: 'syntax' },
		];
		const messages = refusalMessages(refusals, 'template', t).map(({ text }) => text);
		expect(messages).toStrictEqual([
			'Das HTML ist zu groß (höchstens 500 KB).',
			'Der Platzhalter „Vorname“ ist in diesem Bereich nicht erlaubt.',
			'Den Platzhalter „verein“ gibt es nicht.',
			'Der Platzhalter „Webseite“ darf nicht in „href“ stehen; dort sind nur Werte aus dem CD erlaubt.',
			'Der Platzhalter „Webseite“ darf in „href“ keinen Ersatztext haben.',
			'Der Platzhalter „Vorname“ darf nicht in einem Outlook-Kommentar stehen.',
			expect.stringContaining('versteckt einen Platzhalter'),
			'Das HTML ist zu tief verschachtelt. Bitte vereinfache es.',
			expect.stringContaining('genau einmal'),
			expect.stringContaining('nur einmal'),
			expect.stringContaining('Bildersammlung'),
			expect.stringContaining('geschweifte Klammern'),
		]);
	});

	it('words a foreign image by what the target may show', () => {
		const refusal: ImportRefusal = { kind: 'mediaForeign', mediaId: 'abc' };
		expect(refusalMessages([refusal], 'globalLayout', t)[0]?.text).toContain('CD');
		expect(refusalMessages([refusal], 'ownLayout', t)[0]?.text).toContain('Bereichs');
	});

	it('keys equal refusals alike and different ones apart', () => {
		const images: ImportRefusal[] = [
			{ kind: 'mediaForeign', mediaId: 'a' },
			{ kind: 'mediaForeign', mediaId: 'b' },
		];
		const [first, second] = refusalMessages(images, 'template', t);
		expect(first?.text).toBe(second?.text);
		expect(first?.key).not.toBe(second?.key);
	});
});
