import { describe, expect, it } from 'vite-plus/test';

import { translate } from '@/i18n/translate';
import type { MessageKey, MessageParams } from '@/i18n/translate';
import type { MemberImportPreview } from '@/server/contacts/import/members';
import type { PartnerImportPreview } from '@/server/contacts/import/partners';
import type { ImportChange } from '@/server/contacts/import/plan';
import type { BlockingIssue } from '@/server/contacts/import/rows';
import type { CustomFieldRecord } from '@/server/contacts/settings';

import {
	blockingMessage,
	changeText,
	countRows,
	fieldIssueReason,
	problemMessage,
	readFailureMessage,
	recomputedMessage,
	rowIssueMessage,
	withKeys,
} from './import-messages';

const de = (key: MessageKey, params?: MessageParams): string => translate('de', key, params);
const en = (key: MessageKey, params?: MessageParams): string => translate('en', key, params);

const LOCKER: CustomFieldRecord = {
	id: '0f8fad5b-d9cb-469f-a165-70867728950e',
	kind: 'member',
	name: 'Spind',
	placeholderKey: 'spind',
	protection: 'protected',
	type: 'text',
};

const MEMBER_PREVIEW: MemberImportPreview = {
	blocking: [],
	changes: [],
	confirmation: { deletions: 9, required: true },
	counts: {
		changed: 2,
		created: 39,
		futureExit: 1,
		removed: 9,
		removedExited: 1,
		unchanged: 3,
		withoutEmail: 5,
	},
	fieldIssues: [],
	moreChanges: 0,
	moreIssues: 0,
	stockVersion: 4,
};

const PARTNER_PREVIEW: PartnerImportPreview = {
	blocking: [],
	changes: [],
	counts: { created: 6, skipped: 1, takenOver: 2, unchanged: 3, updated: 4 },
	fieldIssues: [],
	keptValues: [],
	moreChanges: 0,
	moreIssues: 0,
	moreKeptValues: 0,
	moreRowIssues: 0,
	notInExport: [],
	rowIssues: [],
	stockVersion: 1,
};

/**
 * A change of the preview: a new member unless changed.
 *
 * @param changes What differs.
 * @returns The change.
 */
function change(
	changes: Readonly<Partial<Omit<ImportChange, 'fields'>>> & {
		readonly fields?: readonly ImportChange['fields'][number][];
	},
): ImportChange {
	return {
		exited: false,
		hiddenFields: false,
		name: { primary: 'Anna Berg', secondary: null },
		number: '1001',
		type: 'created',
		...changes,
		fields: [...(changes.fields ?? [])],
	};
}

describe(readFailureMessage, () => {
	it.each([
		['empty', 'Die Datei oder das Blatt ist leer.'],
		['headerTooLong', 'Ein Spaltenkopf ist länger als 200 Zeichen.'],
		['tooManyColumns', 'Die Datei hat mehr als 200 Spalten.'],
		[
			'unreadable',
			'Die Datei lässt sich nicht lesen. Speichere sie als CSV- oder XLSX-Datei und versuche es noch einmal.',
		],
		['unsupportedType', 'Bitte wähle eine CSV- oder XLSX-Datei.'],
	] as const)('names the read failure %s', (failure, text) => {
		const { key, params } = readFailureMessage(failure);
		expect(de(key, params)).toBe(text);
		expect(en(key, params)).not.toBe(text);
	});
});

describe(problemMessage, () => {
	it.each([
		['member', 'keyNotMapped', 'Ordne die Mitgliedsnummer zu.'],
		['partner', 'keyNotMapped', 'Ordne die Kundennummer oder die E-Mail zu.'],
		['member', 'fieldMappedTwice', 'Jedes Feld darf nur einer Spalte zugeordnet sein.'],
		['member', 'tooManyRows', 'Die Datei hat mehr als 10 000 Zeilen.'],
		['partner', 'noRows', 'Es bleibt keine Zeile zum Importieren. Prüfe die Datei und die Filter.'],
		['member', 'payloadTooLarge', 'Die Datei ist zu groß.'],
		[
			'partner',
			'payloadInvalid',
			'Die Daten der Datei kamen nicht richtig an. Bitte lade die Datei noch einmal.',
		],
	] as const)('names the problem of a %s import: %s', (kind, problem, text) => {
		expect(de(problemMessage(kind, problem))).toBe(text);
	});
});

describe(recomputedMessage, () => {
	it.each([
		['stockChanged', 'Der Bestand hat sich geändert. Die Vorschau wurde neu berechnet.'],
		['blocked', 'Der Bestand hat sich geändert. Die Vorschau wurde neu berechnet.'],
		[
			// The Berlin day changed since the preview: more members have left by now.
			'confirmationRequired',
			'Die Zahl der zu löschenden Mitglieder hat sich geändert. Die Vorschau wurde neu berechnet.',
		],
	] as const)('says why a refused confirm (%s) shows a new preview', (failure, text) => {
		expect(de(recomputedMessage(failure))).toBe(text);
		expect(en(recomputedMessage(failure))).not.toBe(text);
	});
});

describe(blockingMessage, () => {
	it.each<[BlockingIssue, string]>([
		[
			{ count: 10_001, reason: 'tooManyRows' },
			'Die Datei hat 10001 Zeilen, möglich sind höchstens 10 000.',
		],
		[{ reason: 'keyNotMapped' }, 'Ordne die Mitgliedsnummer zu.'],
		[
			{ field: 'firstName', reason: 'fieldMappedTwice' },
			'Das Feld „Vorname“ ist mehreren Spalten zugeordnet.',
		],
		[
			{ column: 'Spind', reason: 'customFieldInvalid' },
			'Spalte „Spind“: Das Zusatzfeld gibt es nicht mehr, oder sein Name ist leer, zu lang oder schon vergeben.',
		],
		[{ line: 7, reason: 'memberNumberMissing' }, 'Zeile 7: Die Mitgliedsnummer fehlt.'],
		[{ line: 8, reason: 'numberTooLong' }, 'Zeile 8: Die Nummer ist länger als 50 Zeichen.'],
		[{ line: 9, reason: 'partnerKeyMissing' }, 'Zeile 9: Kundennummer und E-Mail fehlen.'],
		[
			{ firstLine: 2, line: 10, reason: 'numberDuplicate' },
			'Zeile 10: Die Nummer steht schon in Zeile 2.',
		],
	])('names the blocking issue %o', (issue, text) => {
		expect(blockingMessage(de, 'member', issue)).toBe(text);
	});

	it('names the key of partners', () => {
		expect(blockingMessage(de, 'partner', { reason: 'keyNotMapped' })).toBe(
			'Ordne die Kundennummer oder die E-Mail zu.',
		);
	});
});

describe(fieldIssueReason, () => {
	it.each([
		['invalidDate', 'Kein gültiges Datum'],
		['invalidEmail', 'Keine gültige E-Mail-Adresse'],
		['tooLong', 'Zu lang'],
		['twoDigitYear', 'Jahr nur zweistellig'],
		['unknownGender', 'Geschlecht nicht übersetzt'],
	] as const)('names the field issue %s', (reason, text) => {
		expect(fieldIssueReason(de, reason)).toBe(text);
	});
});

describe(rowIssueMessage, () => {
	it.each([
		['emailAmbiguous', 'Zeile 4: Mehrere Partner haben diese E-Mail-Adresse.'],
		[
			'emailRepeated',
			'Zeile 4: Die E-Mail-Adresse steht schon in einer früheren Zeile ohne Kundennummer.',
		],
		['nameMissing', 'Zeile 4: Firma, Vor- und Nachname fehlen.'],
	] as const)('names the skipped row %s', (reason, text) => {
		expect(rowIssueMessage(de, { line: 4, reason })).toBe(text);
	});
});

describe(changeText, () => {
	it('names a new, a removed and an exited member', () => {
		expect(changeText(de, { change: change({}), customFields: [], kind: 'member' })).toBe(
			'Neu: 1001 Anna Berg',
		);
		expect(
			changeText(de, {
				change: change({ exited: true, type: 'removed' }),
				customFields: [],
				kind: 'member',
			}),
		).toBe('Entfällt: 1001 Anna Berg (ausgetreten)');
	});

	it('names the changed fields, custom ones by name, and says when others are hidden', () => {
		const changed = change({
			fields: ['email', 'groups', `custom:${LOCKER.id}`, 'custom:new:Schlüssel', 'custom:gone'],
			hiddenFields: true,
			type: 'changed',
		});
		expect(changeText(de, { change: changed, customFields: [LOCKER], kind: 'member' })).toBe(
			'Geändert: 1001 Anna Berg – Felder: E-Mail, Gruppen, Spind, Schlüssel, Zusatzfeld, weitere Felder, die du nicht sehen darfst',
		);
	});

	it('names an updated partner with its contact person, without number', () => {
		const updated = change({
			fields: ['lastName'],
			name: { primary: 'Bäckerei Körner GmbH', secondary: 'Lena Müller' },
			number: null,
			type: 'changed',
		});
		expect(changeText(de, { change: updated, customFields: [], kind: 'partner' })).toBe(
			'Aktualisiert: Bäckerei Körner GmbH (Lena Müller) – Felder: Nachname',
		);
	});
});

describe(countRows, () => {
	it('lists the member counts the user may see', () => {
		expect(countRows({ kind: 'member', preview: MEMBER_PREVIEW })).toStrictEqual([
			{ label: 'import.count.created', value: 39 },
			{ label: 'import.count.changed', value: 2 },
			{ label: 'import.count.unchanged', value: 3 },
			{ label: 'import.count.removed', value: 9 },
			{ label: 'import.count.removedExited', value: 1 },
			{ label: 'import.count.withoutEmail', value: 5 },
			{ label: 'import.count.futureExit', value: 1 },
		]);
		const hiddenExit = {
			...MEMBER_PREVIEW,
			counts: { ...MEMBER_PREVIEW.counts, futureExit: null, removedExited: null },
		};
		expect(
			countRows({ kind: 'member', preview: hiddenExit }).map(({ label }) => label),
		).not.toContain('import.count.futureExit');
	});

	it('lists the partner counts', () => {
		expect(countRows({ kind: 'partner', preview: PARTNER_PREVIEW })).toStrictEqual([
			{ label: 'import.count.created', value: 6 },
			{ label: 'import.count.updated', value: 4 },
			{ label: 'import.count.takenOver', value: 2 },
			{ label: 'import.count.unchanged', value: 3 },
			{ label: 'import.count.skipped', value: 1 },
		]);
	});
});

describe(withKeys, () => {
	it('gives each text a key of its own, repeated texts included', () => {
		expect(withKeys(['Neu: Lena Müller', 'Neu: Ben Ott', 'Neu: Lena Müller'])).toStrictEqual([
			{ key: 'Neu: Lena Müller#1', text: 'Neu: Lena Müller' },
			{ key: 'Neu: Ben Ott#1', text: 'Neu: Ben Ott' },
			{ key: 'Neu: Lena Müller#2', text: 'Neu: Lena Müller' },
		]);
	});
});
