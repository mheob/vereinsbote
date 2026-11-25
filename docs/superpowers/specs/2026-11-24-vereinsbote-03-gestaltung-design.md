# Vereinsbote – Teilplan 3: Gestaltung und Rendering (Design)

Stand: 2026-11-24 · Status: freigegeben am 2026-11-24

Ergänzt die Spec `2026-11-23-vereinsbote-design.md` (Abschnitte 5, 6.5, 6.7 und 7, Dateien) für Teilplan 3 des Fahrplans. Wo dieses Dokument von der Spec abweicht, gilt dieses Dokument; die Spec wird im selben Schritt angepasst (siehe 21).

Markierung **[Claude]** = Vorgabe, die im Gespräch nicht ausdrücklich abgestimmt wurde. Diese Punkte stehen am Ende gesammelt.

---

## 1. Worum es geht und warum

Teilplan 3 bringt das Aussehen der Mails in die App. Ein Admin stellt das Corporate Design (CD) des Vereins ein, daraus entsteht ein Standard-Layout. Ehrenamtliche ohne HTML-Kenntnisse bauen den Inhalt im Klick-Editor aus Bausteinen und sehen dabei die echte Mail. Profis importieren fertiges HTML. Alles, was später verschickt wird (Teilpläne 4–6), entsteht aus diesen Vorlagen.

- **Ehrenamtliche gestalten selbst** (Spec 1, Erfolgskriterium). Der Editor muss ohne Schulung und vollständig mit Tastatur und Screenreader bedienbar sein.
- **Barrierefreiheit und CD sind der Kern des Produkts** (Spec 4.2). Deshalb ein eigener Editor mit eigenen Prüfungen statt eines fremden.
- **Keine fremden Daten in die Mail:** Platzhalterwerte werden maskiert, importiertes HTML wird bereinigt, nichts in der Mail lädt etwas von Dritten nach.

**Erfolg:** Die Veranstaltungs-Zuständige legt aus der Startvorlage „Einladung“ eine Vorlage an, tauscht Text und Bild, sieht die Mail auf Desktop und Handy mit einem echten Kontakt und speichert, ohne je HTML zu sehen. Die Mail hält WCAG-Grundregeln ein und sieht in Outlook und Gmail aus wie im CD.

---

## 2. Ziele, Nicht-Ziele, Anti-Ziele

### Ziele

- Speicher-Schnittstelle mit drei Umsetzungen (R2, Vercel Blob, S3) und Auslieferung der Bilder durch die App.
- CD: Vereinsname, Logos, Farben mit Kontrastprüfung, Schriften, Fußzeile mit Links und Social-Media-Icons.
- Standard-Layout aus dem CD; globale importierte Layouts.
- Vorlagen pro Bereich: Betreff, Vorschautext, Briefanrede-Form, Inhalt aus Bausteinen oder importiertem HTML, Layout-Wahl.
- Rendering mit React Email; Platzhalter mit Ersatztext, Briefanrede, Maskierung; Nur-Text-Fassung; einmal rendern, pro Empfänger nur einsetzen.
- Klick-Editor (Bausteine, Tastatur-Umsortieren, Prüfungen) mit Live-Vorschau (Desktop, Mobil, Nur-Text; Beispiel- oder echter Kontakt).
- Bildersammlung pro Bereich mit Bildverarbeitung im Browser.
- HTML-Import mit Bereinigung, Platzhalterprüfung und Warnungen.
- Vollständige Content-Security-Policy und zod `jitless` (Fahrplan, offene Punkte aus Teilplan 1 und 2).
- Startvorlagen-Mechanismus mit der Startvorlage „Einladung“.

### Nicht-Ziele (für Teilplan 3)

- Versand, Testmail an sich selbst, Absender, Abmeldelink (Teilplan 4). Teilplan 3 liefert nur, was der Versand rendert.
- Anlässe, Auslöser und Empfängerauswahl (Teilpläne 4/5). Ein Anlass verweist später auf eine Vorlage.
- Platzhalter für Anlassdaten (Alter, Jahre der Mitgliedschaft; Teilplan 5) und Rechnungsdaten (Teilplan 6) sowie die Startvorlagen „Geburtstag“, „Jubiläum“ (Teilplan 5) und „Rechnung“ (Teilplan 6). Teilplan 3 baut die Platzhalter-Registry so, dass sie dort nur ergänzt werden.
- Bedingte Textblöcke (Spec 6.5).
- Webfonts in Mails, Tracking-Pixel, Bilder von fremden Servern im Klick-Editor.
- Animierte Bilder. **[Claude]**
- Aufbewahrungsfristen für Bilder (Teilplan 7).

### Anti-Ziele (Fehlschlag, auch wenn technisch alles läuft)

- Importierte Kontaktdaten oder importiertes HTML schleusen Skript, Formulare oder fremde Links in eine Mail oder in die App.
- Eine Vorlage zeigt geschützte Felder eines anderen Bereichs, im Editor, in der Vorschau oder später in der Mail.
- Ein halbfertiger Stand einer Vorlage geht raus, weil der Editor zwischendurch speichert.
- Die Mail sieht in Outlook kaputt aus oder ist mit Screenreader nicht lesbar.
- Ein Empfänger bekommt „Liebe ,“ oder `{{contact.firstName}}` zu sehen.
- Das Öffnen einer Mail verrät Dritten (Google Fonts, Social-Media-CDNs) die IP des Empfängers.
- Ehrenamtliche scheitern am Editor, z. B. weil Umsortieren nur mit der Maus geht.

---

## 3. Rahmen

- Alle Regeln aus `AGENTS.md` gelten: Vite+, pnpm-Catalog, neueste stabile Versionen, React Aria Components, `PostForm`, Server-Funktionen mit zod und eigener Autorisierung, `useT`/`translate`, `pageHead`, WCAG 2.2 AA mit axe in E2E, Fehlercodes statt Personendaten in Logs, TDD, erfundene Testdaten.
- Läuft gleich auf Node, Vercel und Cloudflare Workers. Plattformpakete (`@vercel/blob`, S3-Client) nur hinter Build-Konstanten (`import.meta.env.VITE_VB_PLATFORM`), wie `pg` und `nodemailer`.
- Kontaktzugriff nur über `loadContactAccess` (Teilplan 2), nie in einer Transaktion.
- Mails an Kontakte sind deutsch (Teilplan 2, Entscheidung 1). Die Oberfläche bleibt zweisprachig.
- Bereiche, Stufen, `Principal` und Aktivitätsprotokoll aus Teilplan 1 werden genutzt.
- Größenordnung: ein Verein hat wenige Dutzend Vorlagen und einige hundert Bilder.

---

## 4. Abgestimmte Entscheidungen

Im Gespräch am 2026-11-24 festgelegt:

1. **Die Vorlage ist eigenständig** und gehört zu genau einem Bereich. Anlässe (Teilpläne 4/5) verweisen darauf; mehrere Anlässe dürfen eine Vorlage teilen. Briefanrede-Form und Layout-Wahl hängen an der Vorlage, nicht am Anlass.
2. **Rechte:** Ansehen und Vorschau ab `read` im Bereich der Vorlage; Anlegen, Ändern, Duplizieren, Löschen ab `edit`. CD und globale Layouts verwaltet der Admin.
3. **Platzhalter:** Basisfelder, geschützte Felder des Bereichs, Zusatzfelder und CD-Werte. Globale Layouts nur CD-Werte und Basisfelder (Spec 6.7). Kontaktdaten sind im Betreff erlaubt, in Link-Adressen nicht.
4. **Platzhalter-Schlüssel sind englisch** (`{{contact.firstName}}`, `{{salutation}}`, `{{content}}`, `{{brand.primaryColor}}`); der Editor zeigt übersetzte Namen.
5. **Briefanrede** pro Vorlage in Du- oder Sie-Form, Texte pro Vorlage änderbar (Tabelle in 10.3).
6. **Startvorlagen kommen mit ihren Platzhaltern:** „Einladung“ in Teilplan 3, „Geburtstag“ und „Jubiläum“ in Teilplan 5, „Rechnung“ in Teilplan 6.
7. **Bilder liefert die App selbst aus** (`/media/<id>.<ext>`), nicht ein öffentlicher Bucket. Alles im Speicher ist privat.
8. **Teilplan 4 rendert pro Versandwelle einmal und hebt das Ergebnis auf.** Spätere Änderungen an einer Vorlage ändern keine laufende Welle.
9. **Schriften:** nur mailtaugliche Stapel, optional eine Wunschschrift als Name. Nichts wird nachgeladen.
10. **Editor-Aufbau (Variante A):** links die Bausteinliste, der gewählte Baustein klappt zum Formular auf; rechts die echte Mail, Desktop oder Mobil. Auf schmalen Bildschirmen liegt die Vorschau auf einem Reiter.
11. **Bildersammlung pro Bereich.** Löschen nur, wenn keine Vorlage das Bild nutzt; der Löschdialog sagt, dass das Bild auch in verschickten Mails fehlen wird.
12. **CD, Standard-Layout und HTML-Import** wie in 7, 8 und 16 beschrieben; Social-Media-Links wahlweise als Text oder Icon.
13. **Bauwege:** eigene Mail-Komponenten mit `@react-email/render`, Tiptap für den Textbaustein, Live-Vorschau im Browser (siehe 5).
14. **Speicher, Bereinigung, CSP und Lieferung** wie in 6, 16, 17 und 19.
15. **Prüfung in echten Mailprogrammen schon in 3a:** ein Entwickler-Skript schickt Beispielmails an Mailpit, von dort per Relay an echte Postfächer; die Prüfung von Hand gehört zu „3a fertig“ (19).

Im Gespräch vorgeschlagen und ohne Widerspruch geblieben (Bedienung, 13): die Bausteine, ausdrückliches Speichern mit Warnung beim Verlassen, Ablehnen bei gleichzeitiger Änderung, blockierende und warnende Prüfungen, Vorschau mit umschaltbarem Beispielkontakt, Duplizieren.

---

## 5. Bauwege

### 5.1 Träger des Inhalts

| | A) eigenständige Vorlage im Bereich (**gewählt**) | B) Anlass-Gerüst schon in Teilplan 3 |
|---|---|---|
| Wiederverwendung | mehrere Anlässe teilen eine Vorlage; Startvorlagen sind Vorlagen | eine Vorlage pro Anlass |
| Risiko | eine Änderung wirkt auf alle Anlässe, die sie nutzen | Teilplan 3 baut einen Teil eines Modells, dessen Rest noch nicht entworfen ist |

### 5.2 Editor-Aufbau

A) Bausteinliste mit Formular und echter Mail daneben (**gewählt**); B) direkt in der Mail bearbeiten (am natürlichsten, aber am schwersten barrierefrei und weicht leichter von der echten Mail ab); C) Vorschau auf eigenem Reiter (sieht das Ergebnis nicht beim Tippen; bleibt als Darstellung für schmale Bildschirme).

### 5.3 Bilder

Sammlung pro Bereich (**gewählt**) vs. Bilder an der Vorlage (kein Wiederverwenden) vs. eine Sammlung für alle (jeder Bereich sieht und löscht fremde Bilder). Auslieferung durch die App (**gewählt**) vs. öffentlicher Bucket: Bei R2 bräuchte ein öffentlicher Bucket eine eigene Domain (r2.dev ist nur für Entwicklung), die CSP müsste fremde Hosts erlauben, und Löschen wirkt nicht sofort.

### 5.4 Mail-Komponenten

| | A) eigene Komponenten + `@react-email/render` (**gewählt**) | B) Paket `react-email` 6 |
|---|---|---|
| Abhängigkeiten | nur der Renderer (läuft im Browser und auf Workers, kein `eval`) | seit Version 6 kommen die Komponenten nur noch aus dem CLI-Paket: 19 Laufzeit-Abhängigkeiten (esbuild, socket.io, Babel, Tailwind) |
| Kontrolle | `role="presentation"`, `lang`, Outlook-Button und Kontrast in eigener Hand | Markup der Bibliothek |
| Aufwand | rund zehn einfache Tabellen-Komponenten | keiner |

Verworfen: `@react-email/components` (auf npm als veraltet markiert).

### 5.5 Textbaustein

Tiptap (**gewählt**; MIT, auf ProseMirror, dokumentierte Barrierefreiheit, JSON-Dokument, das ohne DOM zu React-Elementen wird) vs. Lexical (0.x, dünne Doku zur Barrierefreiheit). Verworfen: eigenes `contenteditable`.

### 5.6 Ort der Live-Vorschau

Im Browser mit demselben Render-Modul wie der Versand (**gewählt**; sofort, ohne Serverlast; der Render-Code landet im Editor-Bundle) vs. auf dem Server bei jeder Änderung (träger, mehr Aufrufe, hält auf Neon die Datenbank wach).

---

## 6. Speicher und Bildauslieferung

**Schnittstelle** (ein Modul, plattformunabhängig):

- `put(key, bytes, { contentType })`, `get(key)` (Stream, Typ, Größe oder `null`), `delete(key)`. Alle Objekte sind privat.
- Schlüssel: `media/<id>`. Teilplan 4 und 6 legen Anhänge unter eigenem Präfix ab.

**Umsetzungen:**

| Plattform | Umsetzung | Konfiguration |
|---|---|---|
| Cloudflare | R2-Binding, Bucket mit `jurisdiction = "eu"` | Binding `MEDIA_BUCKET` in der Wrangler-Konfiguration |
| Vercel | `@vercel/blob`, privater Store in `fra1` | `BLOB_READ_WRITE_TOKEN` (setzt Vercel beim Verbinden des Stores) |
| Node/Docker | S3-kompatibel über `s3mini` | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (alle oder keine) |

- Entwicklung, CI und E2E: **SeaweedFS** (`weed mini`) in `docker/compose.dev.yml`, per Digest gepinnt. MinIO wird nicht mehr gepflegt (Stand 2026-11-24).
- **[Claude]** Ohne konfigurierten Speicher läuft die App; Hochladen ist dann gesperrt und die Seiten sagen „Dateispeicher nicht eingerichtet“. `parseEnv` prüft die S3-Variablen wie `MS_LOGIN_*` (alle oder keine).
- Zugangsdaten nie in Logs; Fehler nur als Code (`errorLabel`).

**Auslieferung** über die Server-Route `GET /media/<id>.<ext>`:

- `<id>`: 128 Bit Zufall, base64url. Nicht erratbar, keine Anmeldung nötig, für alle Empfänger gleich (kein Tracking).
- Nur Bilder (JPEG, PNG). Kopfzeilen: passender `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: cross-origin`. **[Claude]** `Cache-Control` höchstens einen Tag: Ein gelöschtes Bild verschwindet aus dem Speicher sofort, aus Caches spätestens nach einem Tag. Mail-Proxys (Gmail, Outlook) halten ihre Kopien nach eigenen Regeln.
- Unbekannt oder gelöscht: 404 ohne Hinweis, ob es das Bild je gab.

---

## 7. CD

Eine Einstellung pro Instanz, verwaltet vom Admin unter `/admin/brand`.

- **Vereinsname:** Pflicht. Alternativtext des Kopf-Logos (änderbar), Fußzeile, `{{brand.name}}`.
- **Logos:** Kopf-Logo, optional Fuß-Logo (z. B. Wappen), je mit Alternativtext. Ausrichtung des Kopf-Logos links oder mittig. Eine hochgeladene SVG wandelt der Browser in PNG um (Outlook und Gmail zeigen kein SVG). Logos liegen im Speicher, nicht in einer Bildersammlung. **[Claude]** Ein ersetztes oder entferntes Logo bleibt als Datei erhalten, damit verschickte Mails ihren Kopf behalten; das Aufräumen solcher Dateien gehört zu den Löschfristen (Teilplan 7).
- **Farben:** Primär (Buttons, Akzentlinie im Kopf), Sekundär (Seitenhintergrund um die Inhaltsfläche und Fußzeile), Text, Hintergrund (Inhaltsfläche), Links. Eingabe als Hex-Wert mit Farbwähler.
  - Buttonschrift und Fußzeilenschrift sind automatisch schwarz oder weiß, je nachdem, was mehr Kontrast hat.
  - **Kontrastprüfung** (WCAG AA, 4,5:1) für jedes Paar, das im Standard-Layout vorkommt: Text/Hintergrund, Links/Hintergrund, Buttonschrift/Primär, Fußzeilenschrift/Sekundär. Unterschreitung: Warnung am Feld mit dem Verhältnis; speichern geht trotzdem.
- **Schriften:** je ein Stapel für Text und Überschriften aus einer festen Liste mailtauglicher Stapel. **[Claude]** Arial/Helvetica, Verdana, Tahoma, Trebuchet MS, Georgia, Times New Roman. Optional eine Wunschschrift davor (nur Buchstaben, Ziffern, Leerzeichen, Bindestrich); sie erscheint, wenn der Empfänger sie installiert hat, und wird nie geladen.
- **Fußzeile:** Anschrift, Vereinsregister (Gericht, Nummer), Links zu Impressum, Datenschutz und Website, bis zu 5 weitere Links, ein freier Text.
  - Jeder weitere Link wahlweise als **Text oder Icon**. Die Plattform erkennt die App an der Adresse (z. B. Instagram, Facebook, YouTube, TikTok, LinkedIn, Mastodon, Bluesky); unbekannte Adressen gibt es nur als Text.
  - Icons sind PNGs, die die App selbst ausliefert (nie von fremden Servern), in den Varianten dunkel, hell und Markenfarbe; Alternativtext ist der Plattformname.
- **Links** im CD: nur `https:` und `mailto:`. **[Claude]**
- **Leere CD-Werte [Claude]:** Pflicht ist nur der Vereinsname. Ist ein optionaler Wert leer (Logo, Website, Impressum, Datenschutz, Register, Anschrift, Links), lässt das Standard-Layout das Element weg. Impressum und Datenschutz sind nicht Pflicht; die CD-Seite empfiehlt sie mit einem Hinweis.
- **Vor der Einrichtung** gilt ein neutrales Standard-CD (Vereinsname „Verein“, Grau/Blau, Arial), damit die Vorschau sofort funktioniert. Admins sehen auf der Startseite „CD einrichten“, bis das CD einmal gespeichert ist.
- Die CD-Seite zeigt eine Vorschau des Standard-Layouts mit Beispielinhalt (Rahmen wie in 14).
- **CD-Werte als Platzhalter:** `brand.name`, `brand.website`, `brand.imprintUrl`, `brand.privacyUrl`, `brand.address`, `brand.register`, `brand.primaryColor`, `brand.secondaryColor`, `brand.textColor`, `brand.backgroundColor`, `brand.linkColor`, `brand.fontFamily`, `brand.headingFontFamily`, `brand.logoUrl`, `brand.footerLogoUrl` (absolute URL über `APP_URL`).

---

## 8. Standard-Layout und Mail-Rahmen

- Kopf mit Logo (und Akzentlinie in Primär), Inhaltsfläche 600 px breit auf Sekundär, Fußzeile im CD. Mobil nimmt die Inhaltsfläche die volle Breite.
- Rahmen jeder Mail: `<html lang="de">`, `<meta charset>`, Viewport, Titel = Betreff, Vorschautext als verstecktes Preheader-Element, Layout-Tabellen mit `role="presentation"`, Überschriften als echte `h1`–`h3`.
- Outlook (klassisch, Word-Engine): tabellenbasiert, Button mit VML-/`mso`-Trick, keine Abhängigkeit von `<style>` für das Grundgerüst; responsive Regeln in `<style>` nur als Verbesserung.
- **[Claude]** Feste Texte des Layouts (z. B. „Impressum“, „Datenschutz“) sind deutsch. Das Render-Modul nimmt eine Sprache als Parameter, damit Teilplan 4 Systemmails im Layout in der Sprache des Benutzers rendern kann, falls er das so entscheidet.

---

## 9. Vorlagen

**Felder** einer Vorlage:

- Bereich (fest; ein Wechsel geht nur über „duplizieren“), Name (eindeutig im Bereich **[Claude]**).
- Betreff (Pflicht, höchstens 200 Zeichen **[Claude]**, Platzhalter erlaubt) und Vorschautext (optional, höchstens 200 Zeichen).
- Briefanrede-Form (Du oder Sie) und die Anredetexte (10.3).
- Inhalt: **Bausteine** in einem Layout oder **vollständiges importiertes HTML** (16).
- Layout-Wahl (nur bei Bausteinen): Standard-Layout, ein globales Layout oder ein nur für diese Vorlage importiertes Layout.
- Version (für das Ablehnen gleichzeitiger Änderungen), zuletzt geändert von und am.

**Abläufe:**

- **Anlegen:** Bereich wählen (nur Bereiche mit `edit`), dann leer, aus einer Startvorlage oder per HTML-Import. **[Claude]** Der Anlegen-Dialog fragt Name und Betreff (bei Startvorlagen vorbelegt); erst dann entsteht die Vorlage, mit denselben Prüfungen wie beim Speichern (13). Beim HTML-Import entsteht sie mit „Übernehmen“ (16). **Eine gespeicherte Vorlage besteht immer die Speicherprüfungen.** Ungültig werden kann sie nur durch spätere Änderungen außerhalb (Feldschutz, CD, gelöschtes Bild); das meldet das Rendern (11) und der Editor beim nächsten Öffnen. Einen eigenen Zustand „versandbereit“ braucht Teilplan 4 deshalb nicht.
- **Startvorlagen** liegen im Code (deutsche Texte, Bausteine, Briefanrede-Form). „Anlegen aus Startvorlage“ kopiert sie in eine neue Vorlage; spätere Änderungen an der Startvorlage berühren keine Kopie. Jede Startvorlage besteht die Speicherprüfungen. Teilplan 3 liefert „Einladung“ **[Claude]**: Überschrift, Anrede-Zeile, Text mit Beispielangaben (Datum und Ort in eckigen Klammern zum Ersetzen), Abstand, Gruß mit `{{brand.name}}`. Ohne Bild und Button, weil beide eine Eingabe brauchen.
- **Duplizieren** in jeden Bereich, in dem der Benutzer `edit` hat. **[Claude]** Platzhalter, die im Zielbereich nicht erlaubt sind, verhindern das Duplizieren mit einer Liste. Bilder aus einer anderen Bereichssammlung werden in die Zielsammlung kopiert.
- **Löschen** mit Bestätigung. Teilplan 4 verhindert später das Löschen einer Vorlage, die ein Anlass nutzt.
- **Liste** `/templates`: Vorlagen aller Bereiche mit mindestens `read`, Filter nach Bereich.

---

## 10. Platzhalter

### 10.1 Syntax und Schlüssel

- `{{key}}`; mit Ersatztext `{{key | "Ersatztext"}}`. **[Claude]** Ein leerer Ersatztext (`""`) macht den Platzhalter optional. Im Editor erscheinen Platzhalter als Marken mit übersetztem Namen; Syntax sieht nur, wer HTML importiert.
- **Ohne Ersatztext ist ein Platzhalter Pflicht.** Fehlt sein Wert, schlägt das Rendern für diesen Empfänger fehl (Fehlercode mit Schlüssel, ohne Wert); Teilplan 4 markiert die Mail als Fehler (Spec 6.5).
- **[Claude] CD-Platzhalter** folgen denselben Regeln. Weil CD-Werte für alle Empfänger gleich sind, werden sie beim einmaligen Rendern eingesetzt (11): Ein fehlender Pflichtwert lässt das Rendern der ganzen Vorlage scheitern (Teilplan 4: die ganze Welle, bevor eine Mail entsteht). Editor und Vorschau zeigen das sofort.
- Schlüssel:
  - Kontakt: `contact.firstName`, `contact.lastName`, `contact.organization`, `contact.displayName` (Anzeigename aus Teilplan 2), `contact.email`, `contact.memberNumber`, `contact.customerNumber`, `contact.groups`, `contact.tags` (kommagetrennt), `contact.birthDate`, `contact.entryDate`, `contact.exitDate` (Format `TT.MM.JJJJ`), `contact.street`, `contact.postalCode`, `contact.city`, `contact.custom.<key>`.
  - `salutation` (10.3), die CD-Werte (7) und im Layout `content`.
  - Später: `occasion.*` (Teilplan 5), `invoice.*` (Teilplan 6), Abmeldelink (Teilplan 4).
- **[Claude] Zusatzfelder** bekommen einen festen Platzhalter-Schlüssel (`custom_fields.placeholder_key`, aus dem Namen gebildet, eindeutig pro Kontaktart, unveränderlich). Eine Migration füllt ihn für vorhandene Felder.

### 10.2 Erlaubte Platzhalter

- In einer Vorlage: Basisfelder; geschützte Felder und geschützte Zusatzfelder nur, wenn das Feld für mindestens eine Kontaktart dem Bereich der Vorlage zugeordnet ist **[Claude]**. Beim Rendern wird ein geschütztes Feld nur für die Kontaktarten geliefert, für die es dem Bereich zugeordnet ist; sonst gilt es als fehlend (Ersatztext oder Fehler).
- **[Claude]** Welche Werte das Rendern bekommt, hängt nur am Bereich der Vorlage und am Feldschutz, nicht an einem Benutzer: Der Versand in Teilplan 4 läuft ohne angemeldeten Benutzer. Die Vorschau prüft zusätzlich `read` des Benutzers im Bereich; wer dort `read` hat, sieht die Felder des Bereichs ohnehin (Teilplan 2).
- In globalen Layouts: CD-Werte, Basisfelder und `content`.
- Der Editor bietet nur erlaubte Platzhalter an. Der Server prüft beim Speichern, beim Import und beim Duplizieren jeden Platzhalter; unbekannte oder unerlaubte werden abgelehnt.
- Ändert ein Admin später den Feldschutz, wird eine Vorlage nicht verändert. Beim nächsten Speichern meldet der Editor den nicht mehr erlaubten Platzhalter. Beim Rendern liefert der Server ihn nicht (fehlend). **[Claude]**

### 10.3 Briefanrede

`{{salutation}}` ergibt sich aus Geschlecht, Vorname, Nachname und Firma. Die Texte sind pro Vorlage änderbar und dürfen nur `contact.firstName`, `contact.lastName` und `contact.organization` enthalten.

| | Du (Standard) | Sie (Standard) |
|---|---|---|
| weiblich | Liebe {Vorname} | Sehr geehrte Frau {Nachname} |
| männlich | Lieber {Vorname} | Sehr geehrter Herr {Nachname} |
| divers, keine Angabe | Hallo {Vorname} | Guten Tag {Vorname} {Nachname} |
| Firma (Firma gesetzt, Vorname leer) | Sehr geehrte Damen und Herren | Sehr geehrte Damen und Herren |
| ohne Namen **[Claude]** | Hallo | Guten Tag |

- „Ohne Namen“ greift, wenn der Text der Zeile einen Namen braucht, der fehlt. Damit fehlt die Briefanrede nie.
- Die Texte enden ohne Komma; das Komma setzt die Vorlage.

### 10.4 Maskierung und Kontexte

- **Werte werden in einem Durchgang eingesetzt und nie erneut ausgewertet.** Ein Wert, der selbst `{{…}}` enthält, erscheint wörtlich.
- HTML: Werte werden HTML-maskiert (`& < > " '`). Nur-Text: unverändert. Betreff und Vorschautext: Steuerzeichen entfernt, Zeilenumbrüche zu Leerzeichen.
- **Kontaktdaten und `salutation` nur im Textinhalt**, nie in Attributen, URLs oder `<style>`. In Attributen und `<style>` sind nur CD-Werte erlaubt; ihre Werte prüft das CD beim Speichern (Hex-Farben, `https:`-URLs, bereinigte Schriftnamen) und sie werden zusätzlich maskiert.

---

## 11. Rendering

- **Ein Modul für Browser und Server** (Vorschau und Versand nutzen denselben Code): Bausteine → eigene Mail-Komponenten → `@react-email/render` → HTML; `toPlainText` → Nur-Text.
- **Einmal rendern, dann nur einsetzen:** Das Rendern erzeugt HTML und Nur-Text mit Markierungen für die Platzhalter und zerlegt beides in feste Teile und Platzhalter (kompilierte Fassung). Pro Empfänger werden nur Werte aufgelöst, maskiert und eingesetzt. Teilplan 4 speichert die kompilierte Fassung pro Welle (Entscheidung 8).
- Importiertes HTML durchläuft denselben Schritt: Es wird nicht mit React gerendert, aber genauso in feste Teile und Platzhalter zerlegt; die Nur-Text-Fassung entsteht mit `toPlainText`.
- Ein Layout setzt den gerenderten Inhalt an `{{content}}` ein.
- Ergebnis pro Empfänger: Betreff, Vorschautext, HTML, Nur-Text, oder ein Fehler mit den fehlenden Pflicht-Schlüsseln.
- **Links:** nur `https:`, `mailto:` und `tel:` **[Claude]**; ohne Tracking-Parameter.

---

## 12. Barrierefreiheit der Mails

| Prüfung | Klick-Editor | HTML-Import | Art |
|---|---|---|---|
| Bild ohne Alternativtext und nicht „dekorativ“ | ✓ | ✓ | Editor: blockiert das Speichern. Import: Warnung |
| Überschriften-Reihenfolge (keine übersprungene Ebene, Beginn mit Ebene 1 oder 2) | ✓ | ✓ | Warnung |
| Nichtssagender Linktext („hier klicken“, „mehr“, „Link“, nackte Adresse) **[Claude]** Liste in `de` | ✓ | ✓ | Warnung |
| CD-Kontraste (7) | CD-Seite | – | Warnung |
| `lang` fehlt | – | ✓ | wird gesetzt (`de`) |
| Tabelle ohne `role="presentation"` | – | ✓ | Warnung |

- Dekorative Bilder bekommen `alt=""`.
- Die Nur-Text-Fassung entsteht immer automatisch.
- Warnungen stehen als Liste neben dem Editor; jede springt zum betroffenen Baustein (Fokus).

---

## 13. Klick-Editor

**Aufbau** (Variante A): links die Bausteinliste, der gewählte Baustein ist zum Formular aufgeklappt; rechts die Vorschau (14). Darüber Name, Betreff, Vorschautext, Briefanrede-Form und Layout-Wahl (zuklappbarer Bereich „Einstellungen“). Unter etwa 1024 px Breite liegt die Vorschau auf einem Reiter. **[Claude]**

**Bausteine:**

| Baustein | Inhalt |
|---|---|
| Überschrift | Ebene 1–3, Text mit Platzhaltern |
| Text | Tiptap: fett, kursiv, Link, Aufzählung, nummerierte Liste, Zeilenumbruch, Platzhalter-Marke |
| Bild | Bild aus der Bildersammlung des Bereichs (oder neu hochladen), Alternativtext oder „dekorativ“, optional Link |
| Button | Beschriftung (Platzhalter erlaubt), Link, Ausrichtung; Farbe aus dem CD |
| Trenner | – |
| Abstand | klein, mittel, groß |
| Zwei Spalten | je Spalte eine Bausteinliste ohne weitere Spalten; mobil untereinander |
| Platzhalter-Zeile | ein Platzhalter als eigene Zeile, z. B. die Briefanrede |

- **Platzhalter einfügen:** Menü mit übersetzten Namen, gruppiert (Kontakt, Verein, Anrede); pro eingefügtem Platzhalter ein Ersatztext (leer = optional, nicht gesetzt = Pflicht).
- **Umsortieren:** Ziehen und Ablegen sowie per Tastatur (React-Aria-Liste mit Tastatur-Drag-and-Drop) und zusätzlich „nach oben“/„nach unten“ im Baustein-Menü. Änderungen werden im Live-Bereich angesagt („Text an Position 3 verschoben“).
- **Speichern** nur per Knopf; Warnung beim Verlassen mit ungespeicherten Änderungen. Hat seit dem Laden jemand anderes gespeichert, lehnt der Server ab (Version) und der Editor bietet „neu laden“ an; die eigenen Änderungen gehen dabei verloren, der Dialog sagt das. **[Claude]**
- **Blockierende Prüfungen beim Speichern:** Bild ohne Alternativtext und ohne „dekorativ“, unbekannter oder unerlaubter Platzhalter, leerer Betreff, leerer Name. Fehler stehen am Feld bzw. am Baustein.
- **Grenzen [Claude]:** höchstens 100 Bausteine, Vorlage als JSON höchstens 256 KB. Der Server prüft die Bausteine mit zod streng (nur bekannte Bausteine, Tiptap-Knoten und -Marken, Link-Schemata).
- **Rückgängig/Wiederholen** innerhalb eines Textbausteins (Tiptap); über Bausteine hinweg nicht. **[Claude]**
- Tiptap ohne eingefügtes CSS (`injectCSS: false`), Stile über Tailwind.

---

## 14. Vorschau

- **Ansichten:** Desktop (600 px Inhalt), Mobil (375 px Rahmen), Nur-Text. Betreff und Vorschautext stehen über der Mail.
- **Kontakt:** erfundener Beispielkontakt mit umschaltbarer Art (Mitglied, Partner, Firma) und Geschlecht, damit jede Briefanrede sichtbar wird; oder ein echter Kontakt über eine Suche (Basisfelder).
  - Werte echter Kontakte liefert eine Server-Funktion. Sie prüft `read` im Bereich der Vorlage und liefert nur Werte erlaubter Platzhalter (10.2), gefiltert über `loadContactAccess`.
  - Fehlt ein Pflichtwert, zeigt die Vorschau die Fehlermeldung, die der Versand erzeugen würde, statt der Mail.
- **Rendern im Browser** mit dem Modul aus 11, verzögert um etwa 300 ms nach der letzten Änderung. **[Claude]** In Safari braucht `@react-email/render` einen Polyfill für `ReadableByteStreamController`.
- **Rahmen:** ein `<iframe sandbox="allow-scripts">` (ohne `allow-same-origin`, ohne Formulare, Popups oder Navigation) auf der Route `/preview-frame`. Die Route liefert eine kleine Seite mit eigener CSP (17) und einem Skript, das beim Laden einen `MessageChannel` öffnet, einen Port per `postMessage` nur an ein Elternfenster mit der Herkunft der App gibt und das HTML anzeigt, das auf dem anderen Port ankommt (keine Nachricht am Fenster, kein `postMessage` an `'*'`). Links in der Vorschau führen nirgendwohin.
- Die Vorschau ist für Screenreader als Rahmen mit Titel („Vorschau der Mail“) erreichbar; die Nur-Text-Ansicht ist normaler Seitentext.

---

## 15. Bildersammlung und Bildverarbeitung

**Bildersammlung** pro Bereich unter `/images` (Bereich wählen):

- Liste mit Vorschaubild, Name (aus dem Dateinamen, änderbar), Maße, Größe und „genutzt in N Vorlagen“.
- Hochladen und Löschen ab `edit`, Ansehen ab `read`. Löschen nur, wenn keine Vorlage des Bereichs das Bild nutzt; sonst nennt der Dialog die Vorlagen. Der Löschdialog sagt, dass das Bild auch in schon verschickten Mails fehlen wird (Entscheidung 11).
- Der Alternativtext gehört zur Verwendung im Baustein, nicht zum Bild.
- Der Editor öffnet die Sammlung als Dialog zum Auswählen und Hochladen.

**Verarbeitung im Browser** vor dem Hochladen (Spec 6.5):

- Eingang: was der Browser dekodieren kann (JPEG, PNG, WebP, GIF, je nach Browser HEIC). Logos zusätzlich SVG.
- Ausrichtung aus EXIF anwenden, auf höchstens 1200 px Breite verkleinern, neu kodieren: JPEG (Qualität etwa 0,85) für Bilder ohne Transparenz, PNG mit Transparenz. Das Neukodieren entfernt Metadaten (z. B. GPS-Position). **[Claude]**
- **[Claude]** GIF wird zum Standbild (erstes Bild); der Dialog sagt das.
- Ein Hinweis zeigt Größe vorher und nachher.

**Prüfung auf dem Server:** Dateisignatur JPEG oder PNG, Maße aus dem Dateikopf (höchstens 1200 × 4000 px **[Claude]**), höchstens 2 MB **[Claude]**. Der Server dekodiert keine Bilder.

---

## 16. HTML-Import

- **Wer:** Globale Layouts importiert der Admin (`/admin/layouts`). Ein Layout für eine Vorlage oder eine ganze Vorlage importiert, wer `edit` im Bereich hat.
- **Eingabe:** `.html`-Datei oder eingefügter Code, höchstens 500 KB. Über 102 KB warnt die App (Gmail schneidet längere Mails ab). React-Email-Vorlagen werden außerhalb der App exportiert; die App führt keinen fremden Code aus.
- **Ablauf:** Der Browser schickt das HTML an eine Server-Funktion; sie bereinigt, prüft und gibt bereinigtes HTML und Befunde zurück; die Seite zeigt beides mit Vorschau (14); „Übernehmen“ speichert. Gespeichert wird nur das bereinigte HTML. **[Claude]** Eine HTML-Vorlage wird geändert, indem man neues HTML einfügt oder lädt (gleicher Ablauf); einen eigenen Code-Editor gibt es nicht.
- **Bereinigung** auf dem Server (Allowlist mit parse5/hast; `style`-Werte und `<style>`-Inhalte über css-tree):
  - entfernt: Skripte, Formulare und Eingabefelder, Frames, `object`/`embed`, `<base>`, Meta-Weiterleitungen, Event-Handler, `javascript:`- und `data:`-Links, CSS mit `expression()`, `url(javascript:…)`, `@import` und `behavior`.
  - Kommentare werden entfernt, Outlook-Bedingungskommentare (`<!--[if mso]>`) bleiben. **[Claude]**
- **Abgelehnt:** unbekannte oder im Bereich unerlaubte Platzhalter (10.2), Kontakt-Platzhalter in Attributen oder `<style>`, ein Layout ohne `{{content}}` oder mit mehr als einem.
- **Warnungen:** CSS, das Outlook ignoriert (Daten von caniemail.com, MIT, als Auszug im Repo, aktualisiert per Skript), Barrierefreiheit (12), externe Bilder („Der Server von … sieht die IP der Empfänger“), Größe über 102 KB.
- Fehlt `lang`, wird `lang="de"` gesetzt.
- **[Claude] Eigene Bilder im importierten HTML:** Adressen der App (`/media/<id>.<ext>`, relativ oder mit `APP_URL`) erkennt der Import; sie gelten nicht als extern, zählen als Nutzung (sperren das Löschen) und werden beim Rendern absolut gemacht. In einer Vorlage oder ihrem eigenen Layout müssen sie zur Bildersammlung des Bereichs gehören, in globalen Layouts sind nur die CD-Logos erlaubt; sonst lehnt der Import ab. Die Bildnutzung wird deshalb beim Speichern aus Bausteinen und HTML ermittelt.
- **Globale Layouts:** Liste mit Name und „genutzt in N Vorlagen“; Löschen nur, wenn keine Vorlage sie nutzt.

---

## 17. Content-Security-Policy

**Seiten und API-Antworten** (Request-Middleware in `start.ts`):

- `script-src 'nonce-…' 'strict-dynamic'`; der Nonce kommt über `createRouter({ ssr: { nonce } })` an alle Skripte von TanStack Start (Nonce beim Erzeugen des Routers setzen, siehe TanStack/router Issue #8789).
- `style-src-elem 'self' 'nonce-…'`; `style-src-attr 'unsafe-inline'`, weil React Aria Components Style-Attribute serverseitig rendern (z. B. `VisuallyHidden`).
- `default-src 'self'`, `img-src 'self' blob: data:`, `font-src 'self'`, `connect-src 'self'`, `frame-src 'self'`, `worker-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`; bei `https:`-`APP_URL` zusätzlich `upgrade-insecure-requests`.
- **zod `jitless`:** ein eigenes Modul setzt `z.config({ jitless: true })`; der Client-Einstieg importiert es zuerst (Fahrplan, Punkt aus Teilplan 2).

**Vorschau-Rahmen** `/preview-frame`: `default-src 'none'; script-src 'nonce-…'; style-src 'unsafe-inline'; img-src 'self' https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'` und `X-Frame-Options: SAMEORIGIN`. `img-src https:` nur, damit die Vorschau externe Bilder importierter Vorlagen zeigt (dazu warnt der Import).

**Bilder** `/media/…`: siehe 6. **Gebaute Assets** behalten die Grundkopfzeilen aus `static-headers.ts`.

- Die Sicherheitskopfzeilen werden pro Route überschreibbar (nur diese beiden Routen weichen ab).
- **[Claude]** `vp dev` darf eine gelockerte Fassung nutzen, falls Vites HMR es verlangt; Build und E2E laufen mit der vollen Policy.
- Kein `report-to` in Teilplan 3 (gehört zur Betriebsüberwachung). **[Claude]**

---

## 18. Oberfläche, Protokoll und Datenschutz

**[Claude]** Pfade englisch, Texte in `de.ts`/`en.ts`, jede Seite mit `pageHead` und axe-Prüfung:

- `/templates` (Liste), `/templates/new` (Bereich und Start wählen), `/templates/$templateId` (Editor bzw. HTML-Ansicht).
- `/images` (Bildersammlung).
- `/admin/brand` (CD), `/admin/layouts`, `/admin/layouts/$layoutId`.
- Server-Routen `/media/$file` und `/preview-frame`.
- Navigation: „Vorlagen“ und „Bilder“ für alle mit Bereichsrecht; „CD“ und „Layouts“ in der Admin-Navigation.

**Aktivitätsprotokoll:** Vorlage angelegt/geändert/dupliziert/gelöscht (ID, Bereich), Bild hochgeladen/gelöscht (ID, Bereich), Bild beim Duplizieren in einen anderen Bereich kopiert (ID, Bereich, Quellbild, Vorlage), CD geändert, Layout importiert/geändert/gelöscht (ID). Keine Inhalte, keine Kontaktdaten.

**Datenschutz:**

- Werte echter Kontakte verlassen den Server nur für die Vorschau, nach Rechten gefiltert, und werden nicht gespeichert.
- Bilder: Metadaten entfernt, keine Tracking-URLs, keine Nachladevorgänge von Dritten in Mails aus dem Klick-Editor.
- Testdaten sind immer erfunden.

---

## 19. Lieferung

Ein Design, zwei Pull Requests, jeder mit lauffähiger, getesteter Software und eigenem Changeset (`minor`):

- **3a – Fundament der Gestaltung:** CSP und zod `jitless`; Speicher-Schnittstelle mit drei Umsetzungen, `/media`, SeaweedFS in Compose und CI; Bildverarbeitung im Browser (für Logos); CD-Seite; eigene Mail-Komponenten, Standard-Layout, Render-Modul mit Platzhaltern, Briefanrede, Maskierung, kompilierter Fassung und Nur-Text; Vorschau-Rahmen (für die CD-Vorschau); Platzhalter-Schlüssel für Zusatzfelder.
  - **Beispielmails:** `vp run --filter web mail:sample` rendert Beispielmails (Standard-Layout mit jedem Baustein, zwei Spalten, Briefanrede in beiden Formen) und schickt sie über `DEV_SMTP_URL` an Mailpit. Mailpit kann sie per Relay an echte Postfächer weiterleiten; die Relay-Konfiguration mit Zugangsdaten liegt in einer lokalen, nie eingecheckten Datei (README beschreibt sie).
  - **Abnahme von 3a:** einmal von Hand in Outlook (klassisch und neu), Gmail (Web und App), Apple Mail und iOS-Mail geprüft, durch den Projektinhaber. Befunde fließen vor dem Merge in die Komponenten.
- **3b – Vorlagen und Editor:** Vorlagen (Liste, Anlegen, Duplizieren, Löschen), Klick-Editor mit Tiptap und Umsortieren, Prüfungen, Vorschau mit Beispiel- und echtem Kontakt, Bildersammlung, HTML-Import für Vorlagen und Layouts, globale Layouts, Startvorlage „Einladung“.

README, AGENTS und CONTRIBUTING werden in jedem PR mitgezogen (neue Variablen, SeaweedFS, CSP-Regeln, Plattform-Grenzen der Speicherpakete).

---

## 20. Nacharbeit aus Teilplan 2, die Teilplan 3 aufgreift

- zod `jitless` vor der CSP (17).
- Die Import-Bibliotheken (`read-excel-file`, `papaparse`, `fflate`) laufen unter der neuen CSP; die E2E-Tests des Imports schlagen bei einer Verletzung fehl.
- **[Claude] Client-only-Grenze:** Teilplan 3 zieht eine Grenze, damit Editor-, Render- und Bildbibliotheken nur in den Client-Chunks der Seiten landen, die sie brauchen, und nimmt die Import-Leser mit hinter dieselbe Grenze.
- Admin-Navigation: „Verwaltung“ trägt neben dem aktiven Unterpunkt kein zweites `aria-current="page"` mehr (Teilplan 3 fügt dort Einträge hinzu).
- Gemeinsamer Typ `Translate` in `@/i18n`, sobald der Editor ihn braucht.

Alle anderen Punkte der Liste bleiben im Fahrplan.

---

## 21. Änderungen an Spec und Fahrplan

Im selben Schritt wie dieses Design:

- **Spec 5:** Vorlage als eigenständiges Objekt eines Bereichs, auf das ein Anlass verweist; Briefanrede-Form und Layout an der Vorlage; CD-Variablen mit englischen Schlüsseln (`{{brand.primaryColor}}`); Bildersammlung pro Bereich.
- **Spec 6.5:** Platzhalter-Schlüssel englisch (`{{salutation}}`, `{{content}}`, `{{contact.…}}`) mit Ersatztext-Syntax; Briefanrede-Tabelle pro Vorlage; Bilder über die App ausgeliefert (privater Speicher, nicht erratbare `/media`-URLs); Social-Media-Icons; Webfonts ausgeschlossen.
- **Spec 7 (Dateien):** Vercel Blob als privater Store in `fra1`, R2 mit `jurisdiction = "eu"`, S3 über `s3mini`, SeaweedFS für Entwicklung.
- **Spec 8:** Startvorlagen kommen mit ihren Teilplänen (Einladung 3, Geburtstag und Jubiläum 5, Rechnung 6).
- **Fahrplan:** Teilplan 3 in zwei PRs; CSP- und zod-Punkte als erledigt markieren, sobald 3a gemergt ist; für Teilplan 4: kompilierte Fassung pro Welle speichern, Löschen von Vorlagen in Benutzung sperren, entscheiden, ob Systemmails im CD-Layout gehen; für Teilplan 5 und 6: ihre Platzhalter und Startvorlagen; für Teilplan 7: Bilder, die nur noch verschickte Mails nutzen (Aufbewahrung, Löschfrist).

---

## 22. Tests (Pflicht)

- **Unit:**
  - Platzhalter-Parser (Syntax, Ersatztext, Fehler), Briefanrede-Matrix (inklusive „ohne Namen“), Maskierung in allen Kontexten (Anführungszeichen, Backslash, `{{` im Wert), kompilierte Fassung und Einsetzen, fehlender Pflichtwert.
  - Erlaubte Platzhalter pro Bereich, Kontaktart und Feldschutz.
  - Kontrastberechnung und Schwarz/Weiß-Wahl, Schriftnamen-Bereinigung.
  - zod-Schemata der Bausteine und des Tiptap-JSON (unbekannte Knoten, Link-Schemata).
  - HTML-Bereinigung mit einem XSS-Korpus (Skript, `onerror`, `javascript:`, SVG, `<base>`, Meta-Weiterleitung, `expression()`, `url(javascript:…)`, `@import`, verschachtelte Kommentare, `<noscript>`), Platzhalter in Attributen, caniemail-Warnungen.
  - Bildprüfung (Signatur, Maße aus dem Kopf, Größe), Erzeugung der Bild-IDs, Plattform-Erkennung der Social-Links.
  - CSP-Kopfzeilen pro Route.
- **Snapshots** (Spec 9): Standard-Layout, jeder Baustein, zwei Spalten, Startvorlage „Einladung“, importiertes Beispiel; jeweils HTML und Nur-Text.
- **Datenbank (PGlite):** Vorlagen mit Versionskonflikt; Rechte (`read`/`edit`, Admin ohne Bereichsrecht sieht keine Vorlagen); Duplizieren mit unerlaubten Platzhaltern; Bildnutzung sperrt Löschen; Layout in Benutzung; CD als einzelne Zeile; Migration der Platzhalter-Schlüssel; Vorschau-Werte liefern keine geschützten Felder fremder Bereiche.
- **Speicher:** jede Umsetzung gegen eine Attrappe ihres Clients; die S3-Umsetzung zusätzlich gegen SeaweedFS, wenn `TEST_S3_URL` gesetzt ist (`describe.skipIf` wie bei PostgreSQL).
- **E2E:**
  - CD einrichten (SVG-Logo wird PNG, Kontrastwarnung).
  - Vorlage aus „Einladung“ anlegen und nur mit der Tastatur bearbeiten: Baustein hinzufügen, per Tastatur verschieben, Platzhalter einfügen, Speichern ohne Alternativtext wird abgelehnt.
  - Vorschau Desktop/Mobil/Nur-Text, Beispielkontakt umschalten, echter Kontakt ohne geschützte Felder fremder Bereiche.
  - Bildersammlung: Hochladen, Löschen gesperrt, solange genutzt.
  - HTML-Import mit schädlichem Inhalt: Skript entfernt, Befund sichtbar; globales Layout als Admin.
  - Auf jeder Seite schlägt eine CSP-Verletzung (`securitypolicyviolation`) den Test fehl.
  - axe auf allen neuen Seiten; zusätzlich axe auf dem gerenderten HTML des Standard-Layouts.
  - Die Beispielmails aus 19 gehen an Mailpit; ihre HTML-Prüfung (caniemail-Daten) liegt über einer festgelegten Schwelle.
- **Von Hand:** Abnahme von 3a in echten Mailprogrammen (19).
- **Cloudflare-Smoke-Test** (README): `/media` aus dem lokalen R2 von `wrangler dev`.

---

## 23. Dem Builder überlassen

- Datenbankschema im Detail (CD als Zeile oder JSON, Bildnutzung als Tabelle oder berechnet, Layout-Wahl als JSON).
- Technik der Markierungen beim einmaligen Rendern, solange Werte nie erneut ausgewertet werden und `toPlainText` die Markierungen nicht zerreißt.
- Aufbau der Mail-Komponenten und der Responsive-Regeln, solange Outlook (klassisch und neu), Gmail, Apple Mail und iOS-Mail die Standard-Mail lesbar zeigen (Abnahme in 19).
- Die Schwelle der Mailpit-HTML-Prüfung im E2E-Test.
- Wie der Vorschau-Rahmen das HTML übernimmt (z. B. `DOMParser`, dann Kopf-Stile und Inhalt einsetzen).
- Cache-Kopfzeilen für `/media` innerhalb der Grenze aus 6 (z. B. `CDN-Cache-Control` auf Vercel, Cache API auf Workers).
- Tiptap-Erweiterungen und Tastenkürzel, Gestaltung der Platzhalter-Marken.
- Format und Umfang des caniemail-Auszugs.
- Beispielwerte des Beispielkontakts (erfunden).
- Quelle der Social-Media-Icons (Lizenz muss passen, z. B. Simple Icons, CC0; Markenrichtlinien beachten) und die Liste der erkannten Plattformen.
- Ein anderer S3-Client als `s3mini`, falls er sich als ungeeignet erweist (mit Begründung, Workers-tauglich nicht nötig, aber ohne Node-only-Abhängigkeiten außer hinter der Build-Konstante).
- Seitengrößen, Sortierung, Vorschaubilder (dasselbe Bild per CSS verkleinert genügt).

---

## 24. [Claude]-Entscheidungen zur Prüfung

1. Ohne konfigurierten Speicher läuft die App, Hochladen ist gesperrt; S3-Variablen alle oder keine.
2. `/media` mit höchstens einem Tag Cache: Löschen wirkt im Speicher sofort, in Caches spätestens nach einem Tag.
3. Feste Schriftstapel-Liste (Arial/Helvetica, Verdana, Tahoma, Trebuchet MS, Georgia, Times New Roman).
4. Links im CD nur `https:`/`mailto:`; in Vorlagen `https:`/`mailto:`/`tel:`.
5. Neutrales Standard-CD vor der Einrichtung, Hinweis für Admins auf der Startseite.
6. Feste Texte des Layouts deutsch, Sprache als Parameter für Teilplan 4.
7. Vorlagenname eindeutig im Bereich; Betreff und Vorschautext höchstens 200 Zeichen.
8. Duplizieren in andere Bereiche nur ohne dort unerlaubte Platzhalter; Bilder werden in die Zielsammlung kopiert.
9. Ersatztext-Syntax `{{key | "…"}}`, leerer Ersatztext = optional.
10. Zusatzfelder bekommen einen festen Platzhalter-Schlüssel (Migration).
11. Geschützte Felder sind in einer Vorlage erlaubt, wenn sie für mindestens eine Kontaktart dem Bereich zugeordnet sind; geliefert werden sie nur für diese Kontaktarten.
12. Geänderter Feldschutz verändert keine Vorlage; der Editor meldet es beim Speichern, das Rendern liefert den Wert nicht.
13. Briefanrede-Zeile „ohne Namen“ (Hallo / Guten Tag).
14. Nichtssagende Linktexte nach einer festen deutschen Liste.
15. Editor: Vorschau als Reiter unter etwa 1024 px; Ablehnen bei gleichzeitiger Änderung mit „neu laden“; Rückgängig nur im Textbaustein; Grenzen 100 Bausteine und 256 KB.
16. Vorschau rendert verzögert um etwa 300 ms.
17. Bildverarbeitung: JPEG-Qualität etwa 0,85, Metadaten entfernt, GIF wird Standbild; Server-Grenzen 1200 × 4000 px und 2 MB.
18. HTML-Vorlagen ändert man durch erneutes Einfügen; Outlook-Bedingungskommentare bleiben, andere Kommentare nicht.
19. `vp dev` darf eine gelockerte CSP nutzen; kein `report-to` in Teilplan 3.
20. Pfade und Navigation wie in 18.
21. Client-only-Grenze für Editor-, Render- und Bildbibliotheken, Import-Leser eingeschlossen.
22. Eine Vorlage entsteht erst mit Name und Betreff und besteht immer die Speicherprüfungen; kein Zustand „versandbereit“.
23. Startvorlage „Einladung“ ohne Bild und Button.
24. Leere optionale CD-Werte lassen das Element im Standard-Layout weg; Impressum und Datenschutz nur empfohlen.
25. CD-Platzhalter werden einmal pro Rendern eingesetzt; ein fehlender Pflichtwert lässt die ganze Vorlage scheitern.
26. Rendern filtert nach Bereich und Feldschutz, nicht nach Benutzer.
27. Eigene Bilder im importierten HTML zählen als Nutzung und müssen zur Sammlung des Bereichs gehören (globale Layouts: nur CD-Logos).
28. Ersetzte Logos bleiben als Datei erhalten bis zu den Löschfristen (Teilplan 7).
