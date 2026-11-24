# Vereinsbote – Teilplan 2: Kontakte und Import (Design)

Stand: 2026-11-24 · Status: freigegeben am 2026-11-24

Ergänzt die Spec `2026-11-23-vereinsbote-design.md` (Abschnitte 5, 6.2, 6.7) für Teilplan 2 des Fahrplans. Wo dieses Dokument von der Spec abweicht, gilt dieses Dokument; die Spec wird im selben Schritt angepasst (siehe 14).

Markierung **[Claude]** = Vorgabe, die im Gespräch nicht ausdrücklich abgestimmt wurde. Diese Punkte stehen am Ende gesammelt.

---

## 1. Worum es geht und warum

Teilplan 2 bringt die Empfänger in die App: Mitglieder und Partner, mit Feldern, die je nach Bereich sichtbar sind, und mit Widerspruch und Sperre, die jeden Import überleben. Alles Spätere (Vorlagen, Versand, automatische Anlässe) baut darauf auf.

- Die Mitgliederverwaltung des Vereins hat **keine API**, nur einen Datei-Export. Der Export ist die Quelle der Wahrheit; die App spiegelt ihn.
- Zuständig sind **Ehrenamtliche ohne Technikkenntnisse**. Der Import muss mit dem Export, den die Software liefert, ohne Nacharbeit funktionieren.
- **Datenschutz** ist dem Verein wichtig: nur zugeordnete Spalten, keine gespeicherte Importdatei, ausgetretene Mitglieder werden gelöscht.

**Erfolg:** Die Mitgliederverwaltung lädt den Export ihrer Software hoch, ordnet die Spalten einmal zu, sieht vor dem Ersetzen genau, was passiert, und beim nächsten Mal reicht Hochladen und Bestätigen.

### Die echten Exporte des ersten Vereins

Die Exporte kommen aus derselben Mitgliederverwaltung als XLSX (ein Blatt, Kopfzeile in Zeile 1). Gesehen wurden nur Spaltennamen und Wertformen, keine Personendaten.

**Mitglieder** (437 Zeilen):

| Spalte | Form | Zuordnung |
|---|---|---|
| `Nr.` | Zahl, eindeutig | Mitgliedsnummer |
| `Vorname`, `Nachname` | Text | Vorname, Nachname |
| `Geburtstag`, `Mitglied seit` | Excel-Datum (`dd.mm.yyyy`), immer gefüllt | Geburtsdatum, Eintrittsdatum |
| `Mitglied bis` | Excel-Datum, bei 30 Zeilen gefüllt | Austrittsdatum |
| `E-Mail` | 410 Adressen, 27× „-“ | E-Mail |
| `Abteilungen` | „Fußball“, „Fußball, Danceaerobic“, „-“ … | Gruppen, getrennt am Komma |
| `Status` | „Aktiv“ / „Passiv“ | Gruppen |
| `Typ` | immer „Mitglied“ | verwerfen |
| `Geschlecht` | „männlich“ / „weiblich“ / „keine Angabe“ | Geschlecht |

**Partner** (52 Zeilen, `Typ` = „Kontakt“): `Nr.` (100001–100052, eindeutig), `Nachname`, `Vorname`, `E-Mail` (6× ohne), `Geschlecht`, `Typ`. 48 Zeilen sind Organisationen: Der Name steht in `Nachname`, `Vorname` ist „-“, `Geschlecht` ist „keine Angabe“.

Der Verein duzt seine Mitglieder; es gibt keine Anrede-Spalte.

---

## 2. Ziele, Nicht-Ziele, Anti-Ziele

### Ziele

- Kontaktmodell mit Basis- und geschützten Feldern, Zusatzfeldern und Zuordnung geschützter Felder zu Bereichen.
- Mitglieder-Import aus CSV und XLSX: Zuordnung (gemerkt), Wertübersetzung, Filter, Vorschau mit Fehlerliste, Komplett-Ersetzen, Sicherheitsabfrage.
- Partner-Import (Abgleich statt Ersetzen) und Partnerpflege in der App, mit Schlagworten.
- Kontaktliste und Detailansicht mit Suche und Filtern, nach Rechten gefiltert.
- Sperre und Widerspruch, getrennt gespeichert, überleben jeden Import.
- Warnung bei alten Daten (Oberfläche und wöchentliche Mail an die Admins).

### Nicht-Ziele (für Teilplan 2)

- Versand, Vorlagen, Platzhalter, Briefanrede-Texte (Teilpläne 3–5). Teilplan 2 liefert nur die Daten, auf denen sie aufbauen.
- Widerspruch pro Anlass und Abmeldelink. Anlässe gibt es erst ab Teilplan 4/5; das Datenmodell lässt Platz dafür.
- Auskunfts-Export und Löschfristen (Teilplan 7).
- Ein Sprachfeld an Kontakten (siehe 4).
- Bearbeiten von Mitgliedern in der App (siehe 4).

### Anti-Ziele (Fehlschlag, auch wenn technisch alles läuft)

- Eine falsche oder halbe Datei löscht still viele Mitglieder.
- Ein Fehler in einer einzelnen Zeile löscht ein bestehendes Mitglied, weil die Zeile übersprungen wurde.
- Spalten, die niemand zugeordnet hat (z. B. Notizen, Bankdaten), landen auf dem Server oder in der Datenbank.
- Ein Widerspruch oder eine Sperre geht durch einen Import verloren.
- Ein Benutzer sieht geschützte Felder eines Bereichs, in dem er kein Recht hat, etwa über die Suche, einen Filter oder eine Fehlermeldung.
- Die Importseite ist ohne Maus oder mit Screenreader nicht bedienbar.

---

## 3. Rahmen

- Alle Regeln aus `AGENTS.md` und den „Global Constraints“ von Teilplan 1 gelten: Vite+, pnpm-Catalog, neueste stabile Versionen, React Aria Components, `PostForm`, Server-Funktionen mit zod und eigener Autorisierung, `useT`/`translate`, `pageHead`, WCAG 2.2 AA mit axe in E2E, Fehlercodes statt Personendaten in Logs, TDD.
- Läuft gleich auf Node, Vercel und Cloudflare. Keine Bibliothek darf Node-Module voraussetzen, die im Browser oder auf Workers fehlen.
- Bereiche, Stufen (`read` < `edit` < `send`), `Principal`, `assertArea` und das Aktivitätsprotokoll aus Teilplan 1 werden genutzt, nicht neu gebaut.
- Die Ersteinrichtung legt die Bereiche „Mitglieder“ und „Finanzen“ an und gibt dem ersten Admin `edit` in „Mitglieder“ (Spec 6.7). Bereiche lassen sich umbenennen; Bezüge laufen deshalb über die ID.
- Größenordnung: der erste Verein hat rund 440 Mitglieder und 50 Partner. **[Claude]** Ausgelegt wird für bis zu 10 000 Zeilen pro Import; größere Dateien werden mit einer klaren Meldung abgelehnt.

---

## 4. Abgestimmte Entscheidungen

Im Gespräch am 2026-11-24 festgelegt:

1. **Keine Sprache an Kontakten.** Mails an Mitglieder und Partner sind deutsch; ein Anlass hat genau einen Text. Die Oberfläche bleibt zweisprachig, Systemmails gehen weiter in der Sprache des Benutzers. Damit ist der offene Punkt im Fahrplan erledigt.
2. **Geschlecht statt Anrede.** Das Spec-Feld „Anrede“ wird zum Feld **Geschlecht** mit den Werten weiblich, männlich, divers, keine Angabe. Die Zuordnung übersetzt die Werte des Exports. Teilplan 3 bildet daraus pro Anlass die Briefanrede, z. B. „Liebe Anna“ / „Lieber Max“ / „Hallo Kim“ (Du-Form) oder „Sehr geehrte Frau …“ / „Sehr geehrte Damen und Herren“ (Sie-Form, Organisation ohne Vorname).
3. **Mitglieder sind in der App schreibgeschützt.** Der Export ist die Quelle; Korrekturen passieren in der Mitgliederverwaltung. In der App setzbar sind nur Sperre und Widerspruch.
4. **Partner** kommen aus einem eigenen Export derselben Software oder werden in der App angelegt und gepflegt. Abgleich über die Kundennummer, sonst über die E-Mail.
5. **Firmenfeld.** Jeder Kontakt hat ein optionales Feld **Firma**. Die Partner-Zuordnung bietet die Regel „Ist der Vorname leer, ist der Nachname die Firma“, weil der Export die Organisation im Nachnamen führt. Liefert eine Software eine eigene Spalte „Firma“, wird sie direkt zugeordnet.
6. **Schlagworte nur für Partner**, in der App vergeben. Mitglieder haben Gruppen aus dem Export, keine Schlagworte.
7. **Die Importdatei wird im Browser gelesen** (Bauweg A, siehe 5).
8. **Der Partner-Import ersetzt nicht.** Partner, die im Export fehlen, zeigt die Vorschau als „nicht mehr im Export“; sie werden nur gelöscht, wenn der Benutzer sie dort ankreuzt. Partner ohne Kundennummer (von Hand angelegt) bleiben unberührt.
9. **Feldschutz getrennt nach Kontaktart.** Geschützte Felder werden pro Feld **und** Kontaktart Bereichen zugeordnet: Mitgliederfelder standardmäßig dem Mitglieder-Bereich, Partnerfelder dem Partner-Bereich. Ein Admin kann pro Feld und Kontaktart weitere Bereiche ergänzen. So sieht Finanzen Partneradressen, ohne Mitgliederadressen zu sehen.
10. Alle Vorschläge zu geschützten Feldern, Rechten, Sperre, Widerspruch, Austritt, doppelten Adressen, Warnung bei alten Daten und Protokoll wurden so bestätigt, wie sie in 6 bis 11 stehen.

---

## 5. Bauwege für den Import

| | A) Datei im Browser lesen (**gewählt**) | B) Datei auf dem Server lesen |
|---|---|---|
| Was den Server erreicht | nur die zugeordneten Felder als Daten | die ganze Datei, bei jedem Schritt neu |
| Importdatei löschen | entfällt, sie verlässt das Gerät nie | nur im Speicher, aber alle Spalten erreichen den Server |
| Plattformgrenzen | keine (rund 1–2 MB JSON bei 10 000 Zeilen) | XLSX-Entpacken kann die CPU-Grenze von Workers (Gratis 10 ms) reißen; Vercel 4,5 MB pro Anfrage |
| Kosten | zwei Bibliotheken, nachgeladen nur auf der Importseite | Logik an einer Stelle |

Verworfen: die Datei zwischen den Schritten speichern (widerspricht „sofort löschen“); die ganze Tabelle an den Server schicken und dort zuordnen (alle Spalten erreichen den Server, ohne Gewinn); `xlsx` (SheetJS) von npm (veraltet 0.18.5 mit bekannten Schwachstellen, neuere Versionen nur über ein CDN, gegen die Lieferketten-Regeln); `exceljs` (21 MB, seit Ende 2024 ohne Version).

**Gewählt: A.** Bibliotheken: `read-excel-file` für XLSX und `papaparse` für CSV (beide MIT, aktiv gepflegt; Stand der Prüfung 2026-11-24). Der Browser prüft zur Bequemlichkeit vor; **maßgeblich ist immer die Prüfung auf dem Server**.

---

## 6. Kontaktmodell

Ein Kontakt ist ein Mitglied oder ein Partner.

| Feld | Mitglied | Partner | Schutzstufe |
|---|---|---|---|
| Typ | ✓ | ✓ | Basis |
| Mitgliedsnummer | Pflicht, eindeutig, Schlüssel | – | Basis |
| Kundennummer | – | optional, eindeutig wenn gesetzt | Basis |
| Firma | optional | optional | Basis |
| Vorname, Nachname | ✓ | ✓ | Basis |
| E-Mail | optional | optional | Basis |
| Geschlecht | ✓ (Standard „keine Angabe“) | ✓ | Basis |
| Gruppen | aus dem Import | – | Basis |
| Schlagworte | – | in der App | Basis |
| Geburtsdatum | optional | optional | geschützt |
| Eintrittsdatum | optional | – | geschützt |
| Austrittsdatum | optional | – | geschützt |
| Adresse (Straße, PLZ, Ort) | optional | optional | geschützt |
| Zusatzfelder | aus der Zuordnung | aus der Zuordnung | je Feld festgelegt |

- **Nummern** werden als Text gespeichert (führende Nullen bleiben). Aus Excel gelesene Zahlen werden ohne Nachkommastellen übernommen (`100001`, nicht `100001.0`).
- **E-Mail** wird über `normalizeEmail` gespeichert. Mehrere Kontakte dürfen dieselbe Adresse haben (Familien); doppelte Adressen entfernt erst der Versand (Teilplan 4).
- **Datumsfelder** sind reine Kalenderdaten ohne Uhrzeit.
- **Angezeigter Name:** „Vorname Nachname“; ist eine Firma gesetzt, steht sie vorn und der Ansprechpartner darunter. Fehlt beides, die E-Mail, sonst die Nummer.
- **Geschlecht** wird als Basisfeld geführt, damit jeder Bereich eine Briefanrede bilden kann.
- **Zusatzfelder** werden in der Zuordnung angelegt: Name und Typ (Text oder Datum). Die Werte hängen am Kontakt. **[Claude]** Ein neues Zusatzfeld ist immer **geschützt** und dem Bereich des Imports zugeordnet (Mitglieder- bzw. Partner-Bereich). Nur ein Admin kann es zum Basisfeld machen oder weiteren Bereichen zuordnen. So kann niemand beim Import eine sensible Spalte für alle sichtbar machen.
- **Zuordnung geschützter Felder zu Bereichen** gilt pro Feld und Kontaktart (Entscheidung 9). Standard: alle geschützten Mitgliederfelder → Mitglieder-Bereich, alle geschützten Partnerfelder → Partner-Bereich. Ein Admin kann weitere Bereiche ergänzen oder einen entfernen; mindestens ein Bereich bleibt. **[Claude]**
- **[Claude] Mitglieder- und Partner-Bereich** sind Einstellungen (per Bereichs-ID), Standard „Mitglieder“ bzw. „Finanzen“. Ein Admin kann sie umstellen.
- **[Claude] Bereiche löschen** gehört nicht zu Teilplan 2; Teilplan 1 kann Bereiche nur anlegen und umbenennen. Das Schema ist vorbereitet: Widersprüche und Feldzuordnungen eines Bereichs verfallen mit ihm. Kommt das Löschen später, darf ein Bereich mit Mitglieder- oder Partner-Rolle nicht löschbar sein.
- **„Nicht mehr anschreiben“:** Ein Kontakt bekommt keine Mails, wenn eine Sperre besteht, das Austrittsdatum erreicht oder überschritten ist (auch ohne neuen Import) oder keine E-Mail vorhanden ist. Teilplan 2 liefert diese Prüfung als Funktion; Widersprüche prüft der Versand pro Bereich bzw. Anlass.

---

## 7. Mitglieder-Import

Ablauf in Schritten auf einer Seite, jeder Schritt mit Fortschrittsanzeige („Schritt 2 von 4“) und Ansage im Live-Bereich:

1. **Datei wählen:** Ziehen und Ablegen oder Dateiauswahl (beides per Tastatur), CSV oder XLSX. Bei XLSX mit mehreren Blättern: Blatt wählen. Die Kopfzeile ist die erste nicht leere Zeile.
2. **Zuordnen:** Für jede Spalte eine Auswahl: ein Feld aus 6, ein neues oder vorhandenes Zusatzfeld, „zu Gruppen hinzufügen“ oder „verwerfen“. Vorschläge kommen aus der gemerkten Zuordnung, sonst aus dem Spaltennamen (`Nr.` → Mitgliedsnummer, `Geburtstag` → Geburtsdatum, `Mitglied seit` → Eintrittsdatum, `Mitglied bis` → Austrittsdatum, `Abteilungen` → Gruppen …). Neben jeder Spalte stehen bis zu drei Beispielwerte aus der Datei, nur im Browser.
   - **Wertübersetzung** für Geschlecht: jeder vorkommende Wert → weiblich/männlich/divers/keine Angabe.
   - **Leerwerte:** Werte, die als leer gelten. **[Claude]** Standard: leer und „-“.
   - **Trennzeichen für Gruppen:** **[Claude]** Standard Komma und Semikolon; Leerzeichen am Rand werden entfernt.
   - **Filter (optional):** Regeln „Spalte ist / ist nicht Wert“, alle müssen zutreffen. Zeilen außerhalb gelten als fehlend.
   - Mitgliedsnummer muss zugeordnet sein, sonst geht es nicht weiter.
   - Die Zuordnung wird gespeichert, sobald ein Import bestätigt wurde (nicht vorher). Fehlen beim nächsten Mal zugeordnete Spalten oder gibt es neue, weist die Seite darauf hin.
3. **Vorschau:** Der Browser schickt die zugeordneten Werte an den Server. Der Server prüft und vergleicht mit dem Bestand und zeigt:
   - Zahlen: neu, geändert, unverändert, entfällt (davon ausgetreten); Mitglieder ohne E-Mail; Austritt in der Zukunft.
   - Eine Liste der Änderungen (Nummer und Name, für „geändert“ die betroffenen Felder ohne alte und neue Werte geschützter Felder).
   - Die **Fehlerliste** mit Zeilennummer, Spalte und Grund.
4. **Bestätigen:** Der Server ersetzt den Bestand in einer Transaktion und zeigt das Ergebnis.

**Prüfregeln (Server):**

- **[Claude] Blockierende Fehler** (Import nicht möglich, bis die Datei korrigiert ist): Mitgliedsnummer fehlt in einer Zeile innerhalb des Filters; Mitgliedsnummer doppelt; mehr als 10 000 Zeilen; Pflichtzuordnung fehlt. Begründung: Eine übersprungene Zeile würde ein bestehendes Mitglied löschen (Anti-Ziel).
- **[Claude] Feldfehler** (Import möglich, Zeile wird übernommen, das Feld bleibt leer, Eintrag in der Fehlerliste als Warnung): ungültige E-Mail, ungültiges oder unmögliches Datum, unbekannter Geschlechtswert (→ keine Angabe).
- Datumsformen: Excel-Datum, `TT.MM.JJJJ`, `T.M.JJJJ`, `JJJJ-MM-TT`. **[Claude]** Zweistellige Jahre sind ein Feldfehler.
- Alle Texte werden getrimmt; Steuerzeichen werden entfernt. HTML wird nicht interpretiert, nur gespeichert (maskiert wird beim Einsetzen, Spec 6.5).

**Ersetzen:**

- Wer im Export fehlt oder durch den Filter fällt, wird **gelöscht**, nicht deaktiviert. Sperren und Widersprüche bleiben (sie hängen an der Nummer, siehe 9).
- **[Claude] Ausgetretene in der Datei:** Zeilen, deren Austrittsdatum am Importtag erreicht oder überschritten ist, gelten als ausgetreten und werden wie fehlende Zeilen behandelt: gelöscht und mitgezählt in der Sicherheitsabfrage (Spec 6.8: „Ausgetretene Mitglieder werden gelöscht“). Zeilen mit künftigem Austrittsdatum werden übernommen.
- **Sicherheitsabfrage:** Sinkt die Zahl der Mitglieder gegenüber dem Bestand um mehr als 20 %, muss der Benutzer ausdrücklich bestätigen (eigenes Kontrollkästchen mit der Zahl der Löschungen). Beim ersten Import (Bestand 0) entfällt sie.
- **[Claude] Veränderter Bestand:** Die Vorschau trägt einen Stand des Bestands. Hat sich der Bestand bis zum Bestätigen geändert (anderer Import, neue Sperre), lehnt der Server ab und die Vorschau wird neu berechnet. Zwei gleichzeitige Importe schließen sich aus.
- Der Zeitpunkt des Imports wird für die Warnung bei alten Daten gespeichert.

**CSV:** Zeichensatz UTF-8 (mit oder ohne BOM), sonst Windows-1252; Trennzeichen Semikolon, Komma oder Tab werden erkannt; Anführungszeichen nach RFC 4180.

---

## 8. Partner

- **Import:** dieselbe Zuordnungsseite. Zusätzliche Option „Ist der Vorname leer, ist der Nachname die Firma“. Abgleich je Zeile über die Kundennummer, ohne Kundennummer über die E-Mail; trifft die E-Mail auf mehrere Partner, ist das ein Fehler für diese Zeile.
- **[Claude] Übernahme von Hand angelegter Partner:** Hat eine Zeile eine noch unbekannte Kundennummer und passt ihre E-Mail auf genau einen Partner ohne Kundennummer, wird dieser Partner übernommen und bekommt die Nummer. Seine Sperre und Widersprüche werden dabei von der E-Mail auf die Kundennummer umgeschlüsselt, damit sie weiter gelten.
- **Ergebnis:** neue Partner werden angelegt, gefundene aktualisiert (nur zugeordnete Felder; Schlagworte bleiben). **[Claude]** Leere Zellen und Feldfehler überschreiben beim Partner keinen gespeicherten Wert; die Vorschau nennt solche Fälle. Partner mit Kundennummer, die im Export fehlen, erscheinen als „nicht mehr im Export“ und werden nur gelöscht, wenn der Benutzer sie ankreuzt. Keine Sicherheitsabfrage, weil nichts automatisch gelöscht wird.
- **[Claude] Blockierende Fehler:** doppelte Kundennummer in der Datei; Zeile ohne Kundennummer und ohne E-Mail. Feldfehler wie bei Mitgliedern.
- **Pflege in der App:** anlegen, bearbeiten, löschen (mit Bestätigung). Formular mit `PostForm`, Fehler am Feld.
- **Schlagworte:** frei vergeben, mit Vorschlägen aus den vorhandenen; Groß-/Kleinschreibung wird beim Vergleich ignoriert. Filterbar in der Liste und später als Empfängerfilter.

---

## 9. Sperre und Widerspruch

- **Sperre** („keine Mails mehr“): für einen Kontakt, z. B. bei einem Todesfall zwischen zwei Exporten. **[Claude]** Ohne Freitext-Grund (Datensparsamkeit), nur wer und wann.
- **Widerspruch:** für einen Kontakt und einen Bereich. Das Modell sieht schon „Anlass“ als zweite Art vor; Teilplan 4/5 nutzt sie.
- **Schlüssel:** Mitglieder über die Mitgliedsnummer; Partner über die Kundennummer, ohne Kundennummer über die E-Mail. Beides ist getrennt vom Kontakt gespeichert und **überlebt jeden Import**; kommt ein Mitglied mit derselben Nummer wieder, gilt die Sperre wieder.
- **Rechte:** Setzen und Aufheben darf, wer `edit` im Mitglieder-Bereich (für Mitglieder) bzw. im Partner-Bereich (für Partner) hat.
- Die Detailansicht eines Kontakts zeigt seine Sperre und seine Widersprüche. **[Claude]** Einträge, deren Kontakt gerade nicht im Bestand ist (verwaist), bleiben gespeichert, damit sie bei einer Rückkehr wieder gelten. Eine Ansicht zum Prüfen und Löschen verwaister Einträge kommt mit den Löschfristen in Teilplan 7.
- Wird ein Bereich gelöscht, verfallen seine Widersprüche.

---

## 10. Rechte und Sichtbarkeit

| Aktion | Wer |
|---|---|
| Kontaktliste und Basisfelder aller Kontakte sehen | jeder Benutzer mit mindestens `read` in irgendeinem Bereich |
| Geschützte Felder sehen | `read` in einem Bereich, dem das Feld für diese Kontaktart zugeordnet ist |
| Mitglieder-Import | `edit` im Mitglieder-Bereich |
| Partner-Import, Partner anlegen/bearbeiten/löschen, Schlagworte | `edit` im Partner-Bereich |
| Sperre und Widerspruch | `edit` im Mitglieder- bzw. Partner-Bereich (je nach Kontakt) |
| Feldschutz, Mitglieder-/Partner-Bereich, Frist für alte Daten | Admin |

- Die Admin-Rolle allein gibt keinen Zugriff auf Kontakte (Spec 6.7).
- Die Prüfung geschieht auf dem Server, in jeder Server-Funktion. Geschützte Felder ohne Recht werden **nicht ausgeliefert**, nicht nur ausgeblendet; Suche und Filter über geschützte Felder gibt es nur für Benutzer, die das Feld sehen dürfen.
- Die Import-Vorschau zeigt geschützte Felder nur, wenn der Benutzer sie sehen darf. Wer importieren darf, sieht sie in der Regel (Mitglieder-Bereich).

---

## 11. Warnung bei alten Daten

- Ist der letzte bestätigte Mitglieder-Import älter als die Frist (Standard 8 Wochen, Admin-Einstellung), zeigt die App ein Banner für alle mit Zugriff auf den Mitglieder-Bereich und für Admins, mit Datum des letzten Imports und Link zum Import.
- Ein Schritt der Zeitsteuerung schickt dann **einmal pro Woche** eine Warn-Mail an alle aktiven Admins, in deren Sprache. Gemerkt wird, wann zuletzt gesendet wurde; der Schritt ist idempotent und bleibt im Zeitbudget.
- Bis Teilplan 4 einen echten Absender bringt, geht die Mail über den vorhandenen Systemmailer (in Entwicklung Mailpit). Ohne Mail-Anbindung wird der Versuch protokolliert (Fehlercode), nicht wiederholt bis zur nächsten Woche. **[Claude]**
- Gab es noch nie einen Import, gibt es keine Warnung; die Startseite verweist auf den ersten Import. **[Claude]**
- Automatische Mails laufen trotz Warnung weiter (Spec 6.2).

---

## 12. Oberfläche

**[Claude]** Pfade englisch, Texte in `de.ts`/`en.ts`:

- `/contacts` – Liste mit Reitern „Mitglieder“ und „Partner“, Suche (Name, Firma, E-Mail, Nummer), Filter (Gruppe bzw. Schlagwort, ohne E-Mail, gesperrt, Austritt erreicht/geplant), Seitenweise Anzeige. Tabelle mit React Aria.
- `/contacts/$contactId` – Detailansicht: Basisfelder, geschützte Felder je Recht, Sperre, Widersprüche pro Bereich; bei Partnern Bearbeiten und Schlagworte. Bei Mitgliedern der Hinweis „Änderungen in der Mitgliederverwaltung vornehmen“.
- `/contacts/new` – Partner anlegen.
- `/contacts/import/members`, `/contacts/import/partners` – Import-Assistent.
- `/admin/contact-settings` – Feldschutz (Zuordnung zu Bereichen, Zusatzfelder), Mitglieder-/Partner-Bereich, Frist für alte Daten.
- Navigation: „Kontakte“ für alle mit Bereichsrecht; „Import“ nur mit Import-Recht.
- Jede Seite bekommt `pageHead` und eine axe-Prüfung in E2E.

---

## 13. Protokoll und Datenschutz

- **Aktivitätsprotokoll:** Import (Art, Zahlen neu/geändert/gelöscht/Warnungen, wer, wann – keine Namen); Partner angelegt/geändert/gelöscht (Kundennummer bzw. interne ID); Sperre und Widerspruch gesetzt/aufgehoben (Nummer); Einstellungen geändert.
- Keine Kontaktdaten in Logs, URLs oder Fehlermeldungen. Zeilennummern statt Werten in Server-Fehlern.
- Die Importdatei verlässt den Browser nie; Beispielwerte in der Zuordnung entstehen nur im Browser.
- **Testdaten sind immer erfunden.** Die echten Exporte des Vereins kommen nie ins Repository, auch nicht gekürzt.

---

## 14. Änderungen an Spec und Fahrplan

Im selben Schritt wie dieses Design:

- Spec 5: „Anrede“ → „Geschlecht“; Feld „Firma“; Schlagworte nur für Partner.
- Spec 6.2: Datei wird im Browser gelesen; Partner-Import mit „nicht mehr im Export“; Mitglieder in der App schreibgeschützt.
- Spec 6.5: `{{briefanrede}}` aus dem Feld Geschlecht (und leerem Vornamen für Organisationen).
- Fahrplan: offener Punkt „Sprache der Mails“ als entschieden markieren; für Teilplan 7 ergänzen: Ansicht und Löschfrist für verwaiste Sperren und Widersprüche.

---

## 15. Tests (Pflicht)

- Unit: Lesen von CSV (Zeichensatz, Trennzeichen) und XLSX (Excel-Daten), Zuordnung, Wertübersetzung, Leerwerte, Gruppen-Aufteilung, Filter, Prüfregeln, Abgleich, Anzeigename, „nicht mehr anschreiben“.
- Datenbank (PGlite): Ersetzen in einer Transaktion, Sicherheitsabfrage, Sperre und Widerspruch überleben Löschen und Wiederkehr, Partner-Abgleich, Rechte inkl. „geschützte Felder werden nicht ausgeliefert“, Warnschritt idempotent.
- PostgreSQL (`*.postgres.test.ts`): zwei gleichzeitige Importe; Bestätigen nach verändertem Bestand.
- E2E: Mitglieder-Import mit einer erfundenen XLSX-Datei in der Form des echten Exports (inkl. „-“, Komma-Gruppen, Excel-Daten), zweiter Import mit gemerkter Zuordnung, Sicherheitsabfrage, Partner-Import aus CSV (Windows-1252, Semikolon), Partner pflegen, Sperre, Rechte (Benutzer ohne Bereichsrecht sieht keine Geburtsdaten), axe auf allen neuen Seiten.

---

## 16. Dem Builder überlassen

- Datenbankschema im Detail (z. B. Zusatzfelder als JSON-Spalte oder eigene Tabelle, Gruppen und Schlagworte als Array oder Tabelle).
- Wie der Bestandsstand für die Vorschau gebildet wird und wie Importe sich gegenseitig ausschließen.
- Wie viele Zeilen pro Anfrage an den Server gehen, solange 10 000 Zeilen auf allen Plattformen funktionieren.
- Aufbau der Komponenten des Assistenten; Seitengröße und Sortierung der Liste.
- Ob `read-excel-file` und `papaparse` den späteren CSP-Regeln (Teilplan 3, kein `eval`) genügen – vor der Aufnahme prüfen; bei Problemen eine gleichwertige Bibliothek wählen und begründen.

---

## 17. [Claude]-Entscheidungen zur Prüfung

1. Obergrenze 10 000 Zeilen pro Import.
2. Jedes geschützte Feld behält mindestens einen Bereich je Kontaktart.
3. Mitglieder- und Partner-Bereich als Admin-Einstellung per ID; Bereiche löschen ist nicht Teil von Teilplan 2, das Schema ist vorbereitet.
4. Leerwerte standardmäßig leer und „-“; Gruppen-Trennzeichen Komma und Semikolon.
5. Blockierende Fehler (fehlende/doppelte Nummer, zu viele Zeilen) vs. Feldfehler (Feld bleibt leer, Zeile wird übernommen).
6. Zweistellige Jahre sind ein Feldfehler.
7. Bestätigen scheitert, wenn sich der Bestand seit der Vorschau geändert hat; Importe schließen sich gegenseitig aus.
8. Sperre ohne Freitext-Grund.
9. Verwaiste Sperren/Widersprüche bleiben gespeichert; Ansicht und Löschfrist kommen in Teilplan 7.
10. Warn-Mail ohne Mail-Anbindung: Fehlercode protokollieren, nächster Versuch in einer Woche.
11. Vor dem ersten Import keine Warnung, sondern ein Hinweis auf der Startseite.
12. Pfade und Seitenaufteilung wie in 12.
13. Ein neues Zusatzfeld ist geschützt und dem Bereich des Imports zugeordnet; nur ein Admin ändert das.
14. Zeilen mit erreichtem Austrittsdatum werden beim Import wie fehlende behandelt (gelöscht).
15. Ein von Hand angelegter Partner wird über die E-Mail übernommen, wenn seine Kundennummer neu ist; Sperre und Widersprüche werden umgeschlüsselt.
16. Leere Zellen und Feldfehler überschreiben beim Partner-Import keine gespeicherten Werte.
