/*
 * A partner export in the form of the club's member administration (design 1), as German Excel
 * saves a CSV file: Windows-1252, semicolons, CRLF. Organizations carry their name in
 * „Nachname“, „-“ as first name and „keine Angabe“ as gender. All data is invented.
 */

const PARTNER_EXPORT_LINES: readonly string[] = [
	'Nr.;Nachname;Vorname;E-Mail;Geschlecht;Typ',
	'100001;Bäckerei Körner GmbH;-;info@baeckerei-koerner.example;keine Angabe;Kontakt',
	'100002;Getränke Weiß KG;-;bestellung@getraenke-weiss.example;keine Angabe;Kontakt',
	'100003;Sporthaus Großmann;-;-;keine Angabe;Kontakt',
	'100004;Autohaus Schäfer OHG;-;kontakt@autohaus-schaefer.example;keine Angabe;Kontakt',
	'100005;Müller;Lena;lena.mueller@example.org;weiblich;Kontakt',
	'100006;Brandt;Jonas;jonas.brandt@example.org;männlich;Kontakt',
];

/** The highest code point Windows-1252 and Latin-1 encode alike (U+00FF). */
const LATIN1_MAX = 255;
/** U+0080–U+009F: C1 controls in Latin-1, other characters in Windows-1252. */
const C1_FIRST = 128;
const C1_LAST = 159;
const HEX = 16;

/**
 * Encodes a text as Windows-1252. Only characters both encodings share are taken; any other
 * character throws, so the fixture never writes bytes that read back as something else.
 *
 * @param text The text.
 * @returns The bytes.
 * @throws {RangeError} For a character this encoder does not take.
 */
function windows1252(text: string): Buffer {
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		if (code > LATIN1_MAX || (code >= C1_FIRST && code <= C1_LAST)) {
			throw new RangeError(`U+${code.toString(HEX).toUpperCase()} is not encodable here.`);
		}
	}
	return Buffer.from(text, 'latin1');
}

/**
 * The partner export with six rows: four organizations (one without address) and two people.
 *
 * @returns The bytes of the CSV file.
 */
function partnerExportCsv(): Buffer {
	return windows1252(`${PARTNER_EXPORT_LINES.join('\r\n')}\r\n`);
}

export { partnerExportCsv, windows1252 };
