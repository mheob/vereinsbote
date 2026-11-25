# Vereinsbote – Design

Stand: 2026-11-23 · Status: Entwurf zur Freigabe

Markierung **[Claude]** = Entscheidung, die im Gespräch nicht ausdrücklich abgestimmt wurde, sondern als sinnvolle Vorgabe gesetzt ist. Diese Punkte sind am Ende noch einmal gesammelt.

---

## 1. Worum es geht

Der Vereinsbote ist eine Open-Source-Webapp, mit der ein Verein E-Mails an seine Mitglieder und an direkte (Geschäfts-)Partner verschickt:

- **automatisch** nach Datumsregeln, z. B. runde Geburtstage oder Mitgliedsjubiläen,
- **manuell**, z. B. Rechnungen an Partner oder Einladungen zu Veranstaltungen.

Geburtstage und Rechnungen sind nur Beispiele. Grundsätzlich soll alles abbildbar sein, was ein Verein an Mitglieder oder Partner schickt.

Die Mails sind im Corporate Design (CD) des jeweiligen Vereins gestaltet. Jeder Verein betreibt eine **eigene Instanz** mit eigener Domain (eine Instanz = ein Verein, keine Mandantenfähigkeit).

Die ersten Zielvereine hosten ihre Websites bereits auf **Vercel oder Cloudflare** (mit Sanity als CMS und Next.js, TanStack Start oder Astro im Frontend).

### Warum

- **Geburtstagsgrüße werden heute gar nicht verschickt.** Von Hand ist das zu aufwendig, und es besteht das Risiko, jemanden zu vergessen.
- **Rechnungen** entstehen in der Buchhaltungssoftware als PDF (optional zusätzlich als XRechnung) und werden manuell über Outlook aus dem Vereinspostfach verschickt. Die Gestaltung ist dort stark begrenzt.
- **Zuständig sind Ehrenamtliche** (Mitgliederverwaltung, Finanzen), meist ohne HTML-Kenntnisse.
- **Die Mitgliederverwaltung hat keine API**, es gibt nur einen Datei-Export.

### Woran wir Erfolg erkennen

- Der eigene Verein verschickt runde Geburtstage und Jubiläen vollautomatisch, und niemand wird vergessen.
- Ehrenamtliche ohne HTML-Kenntnisse gestalten und verschicken Mails im Vereins-CD selbst.
- **[Claude]** Ein weiterer Verein installiert und richtet den Vereinsbote anhand der Doku selbst ein, auf Vercel oder auf Cloudflare.

---

## 2. Ziele, Nicht-Ziele, Anti-Ziele

### Ziele (alles in der ersten Version)

- Mitglieder-Import aus Datei (CSV/XLSX); Partner per eigenem Import oder manueller Pflege
- Anlässe mit automatischem Auslöser (Datumsregel) oder manuellem Auslöser
- Gestaltung in drei Ebenen (CD, Layout, Inhalt) mit Klick-Editor für Ehrenamtliche
- Import von HTML-Vorlagen für Profis (auch aus React Email exportiert), global oder pro Anlass
- Versand über Microsoft 365 (Microsoft Graph) und Resend
- Auswertung unzustellbarer Mails (Rückläufer)
- Getrennte Bereiche mit Rollen
- Datenschutz und Barrierefreiheit als durchgehende Leitplanken

### Nicht-Ziele

- **Beitragsrechnungen:** laufen per Lastschrift außerhalb der App.
- **Austausch von Vorlagen zwischen Vereinen:** ist nicht vorgesehen.
- **Anmeldungen oder Zusagen zu Veranstaltungen.**
- **Empfangen und Verarbeiten von Antworten:** Antworten landen im normalen Postfach. Einzige Ausnahme ist das Lesen von Rückläufern.
- **Mehrere Vereine in einer Instanz.**
- **Allgemeiner SMTP-Versand:** nicht in der ersten Version. Die Versand-Schnittstelle ist aber darauf vorbereitet.
- **Öffnungs- oder Klick-Tracking.**
- **Direkte Anbindung an die Mitgliederverwaltung.**
- **[Claude]** **Vier-Augen-Freigabe vor dem Versand:** nicht in der ersten Version. Den Schutz übernehmen Testmail, Vorschau pro Empfänger und ein Bestätigungsdialog mit Empfängerzahl.

### Anti-Ziele (Fehlschlag, auch wenn technisch alles läuft)

- Glückwunsch an ein ausgetretenes oder verstorbenes Mitglied
- Doppelte Mails, z. B. weil die Zeitsteuerung zweimal läuft
- Mail mit falschem Inhalt an die falsche Person, z. B. eine Rechnung an den falschen Partner
- Daten eines Bereichs werden für Unbefugte sichtbar
- Die Automatik fällt still aus (abgelaufenes Microsoft-Secret, Zeitsteuerung läuft nicht), und niemand merkt es
- Ein Widerspruch eines Mitglieds wird durch einen neuen Import überschrieben
- Die App kann im Namen beliebiger Postfächer des Vereins senden
- Ehrenamtliche scheitern an der Bedienung oder an der Einrichtung in der App (CD, Absender, Import)

---

## 3. Rahmenbedingungen

- **Hosting:** Vercel und Cloudflare sind gleichwertige Ziele. Ein Docker-Image fällt als Nebenprodukt ab.
- **Kosten:** Zielkorridor 0–5 $ pro Monat und Verein zusätzlich zum bestehenden Hosting. Für die Datenbank reicht Neon Free (1 GB), für Dateien reichen die kostenlosen Kontingente.
- **[Claude] Unterstützte Tarife:**
  - **Cloudflare:** Workers Paid (5 $/Monat) ist Voraussetzung. Workers Free erlaubt nur 10 ms Rechenzeit und 50 Unteranfragen pro Aufruf und wird nicht unterstützt. Sonst müssten Import, PDF-Auslesen und Mail-Erzeugung in den Browser wandern.
  - **Vercel:** Offiziell unterstützt ist Pro. Das kostet 20 $/Monat, bzw. 0 $ zusätzlich, wenn der Verein Pro schon hat. Hobby ist laut Vercel nur für private, nicht-kommerzielle Nutzung gedacht. Technisch läuft die App dort über Vercel Schedules (Beta: alle 15 Minuten mit bis zu 15 Minuten Versatz, höchstens 5.000 Läufe im Monat), aber ohne Zusage.
  - **Neon Free:** 100 CU-Stunden im Monat. Die Datenbank schläft nach 5 Minuten ohne Zugriff. Ist das Kontingent aufgebraucht, steht sie bis zum nächsten Monat still. Deshalb läuft die Zeitsteuerung höchstens alle 15 Minuten, damit die Datenbank dazwischen schlafen kann. Geschätzter Verbrauch bei kleinster Größe: etwa 60 CU-Stunden im Monat.
- **Microsoft 365:** Die SMTP-Anmeldung mit Passwort (Basic Auth) wird ab Ende Dezember 2026 standardmäßig abgeschaltet. Der Versand läuft deshalb ausschließlich über die Graph API mit OAuth.
- **Exchange-Limits (Richtwerte):** 30 Nachrichten pro Minute und 10.000 Empfänger pro Tag und Postfach.
- **Resend:** Der kostenlose Tarif erlaubt 100 Mails pro Tag bzw. 3.000 pro Monat. Für Einladungswellen ist ein bezahlter Tarif nötig, das wird in der Doku erklärt.
- **Datenschutz:** DSGVO. Daten und Dateien liegen in EU-Regionen.
- **Barrierefreiheit:** Die App erfüllt WCAG 2.2 AA. Die Mails sind barrierearm (siehe 6.5).
- **Volumen-Annahme:** 300–1.000 Mitglieder, 5.000–15.000 Mails im Jahr, Spitzen von etwa 1.000 Mails an einem Tag.
- **Sprache:** Die Oberfläche ist von Beginn an zweisprachig, Deutsch (Standard) und Englisch. Alle Texte liegen zentral. Alles, was Code ist (Bezeichner, URL-Pfade, HTML-IDs usw.), ist englisch. (Nachtrag 2026-11-23, Wunsch des Projekts.)

---

## 4. Lösungsansätze

### 4.1 Betrieb

| Ansatz | Vorteile | Nachteile |
|---|---|---|
| A: nur Vercel (Next.js, Postgres, Vercel-Zeitsteuerung) | schnellster Start, passt zu Next.js-Vereinen | schließt Cloudflare-Vereine aus; ein späterer Umbau betrifft fast alles |
| **B: plattformunabhängig (gewählt)** | ein Code für Vercel, Cloudflare und Docker; erreicht alle Zielvereine | mehr Aufwand für die Zwischenschichten am Anfang |
| C: Docker-Server | volle Kontrolle | passt nicht zur Zielgruppe, die keine Server betreibt |

**Gewählt: B, mit TanStack Start.** Die Zielvereine nutzen beide Plattformen, und ein späterer Umstieg von A auf B wäre teuer.

### 4.2 Klick-Editor und Mail-Erzeugung

| Ansatz | Vorteile | Nachteile |
|---|---|---|
| **A: eigener Editor, Mails mit React Email erzeugt (gewählt)** | volle Kontrolle über Barrierefreiheits-Prüfungen, CD-Variablen, Platzhalter und Rollen; gleiche Technik wie React-Email-Vorlagen; läuft auf beiden Plattformen | meiste Arbeit (Editor, Umsortieren, Vorschau) |
| B: fertiger Open-Source-Editor (z. B. EmailBuilder.js, Easy Email) | Editor in Tagen statt Wochen | Regeln und Variablen müssen in fremden Code gebogen werden; die Barrierefreiheit des Editors ist fraglich; abhängig von einem Fremdprojekt |
| C: GrapesJS mit MJML | sehr mächtig, große Community | für Ehrenamtliche überladen; die MJML-Erzeugung ist rechenlastig und auf Cloudflare kritisch |

**Gewählt: A.** Barrierefreiheit und CD sind der Kern des Produkts, und genau dort braucht es volle Kontrolle.

---

## 5. Fachliches Modell (Begriffe)

- **Kontakt:** ein Mitglied oder ein Partner.
  - Felder: Typ, Mitgliedsnummer (bei Mitgliedern der Schlüssel für den Import), Kundennummer (bei Partnern, optional), Firma, Geschlecht, Vorname, Nachname, E-Mail, Geburtsdatum, Eintrittsdatum, Austrittsdatum, Adresse, Gruppen/Abteilungen (Mitglieder, aus dem Import), Schlagworte (nur Partner, in der App vergeben), frei definierbare Zusatzfelder aus der Import-Zuordnung. *(Teilplan 2: „Geschlecht“ ersetzt „Anrede“; Kontakte haben keine Sprache, Mails an Kontakte sind deutsch. Details: `2026-11-24-vereinsbote-02-kontakte-design.md`.)*
  - Jedes Feld hat eine Schutzstufe: **Basis** (Name, Firma, E-Mail, Typ, Geschlecht, Gruppen, Schlagworte) oder **geschützt** (z. B. Geburtsdatum, Eintrittsdatum, Austrittsdatum, Adresse). Geschützte Felder sind pro Kontaktart (Mitglied, Partner) einem oder mehreren Bereichen zugeordnet.
- **Bereich:** vom Verein selbst angelegt, z. B. „Mitglieder“, „Finanzen“, „Veranstaltungen“. Ein Bereich bündelt Anlässe und ist die Grundlage für Rechte.
- **Anlass:** gehört zu genau einem Bereich. Ein Anlass besteht aus Vorlage, Auslöser, Empfängern, Anhängen und Absender. *(Teilplan 4: Ein Anlass hat eine Art – „persönlich“ (eine Mail pro Kontakt, Vorrang beim Tageslimit) oder „Rundschreiben“ (eine Mail pro Adresse, nachrangig) – und die Einstellung „Abmeldelink“. Anlässe sind auf Dauer angelegt, jede Veranstaltung ist eine neue Welle. Empfänger und Anhänge gehören zur Welle. Details: `2026-11-25-vereinsbote-04-versand-design.md`.)*
- **Auslöser:**
  - Datumsregel: ein Datumsfeld plus eine Regel, z. B. „Alter ∈ {50, 60, 70, 75, 80, 85, …}“ oder „Jahre seit Eintritt ∈ {10, 25, 40, 50, …}“. Die Werte konfiguriert der Verein.
  - oder manuell.
- **Empfänger:** einzelne Kontakte oder ein Filter (Typ, Gruppe, Schlagwort, Feldwerte).
- **CD (Theme):**
  - Logo(s), Farben (Primär, Sekundär, Text, Hintergrund, Links)
  - Schrift: Auswahl mit mailtauglichen Ersatzschriften
  - Fußzeile: Impressum, Anschrift, Vereinsregister, Links
  - Alles ist als Variable verfügbar, z. B. `{{cd.farbe_primaer}}` oder `{{cd.logo}}`. *(Teilplan 3: englische Schlüssel, z. B. `{{brand.primaryColor}}`, `{{brand.logoUrl}}`; nur Schriftstapel, keine Webfonts; Social-Media-Links als Text oder Icon.)*
- **Layout:** Rahmen (Kopf, Fuß, Inhaltsbereich).
  - Ein Standard-Layout wird automatisch aus dem CD erzeugt.
  - Importierte HTML-Layouts gelten global oder für einen einzelnen Anlass. *(Teilplan 3: global oder für eine einzelne Vorlage.)*
- **Inhalt:** Liste von Bausteinen aus dem Klick-Editor, eingesetzt in den Inhaltsbereich des Layouts. Alternativ ist eine vollständige importierte HTML-Vorlage nur mit Platzhaltern möglich.
- **Vorlage** *(Teilplan 3)*: eigenständig, gehört zu genau einem Bereich; Name, Betreff, Vorschautext, Briefanrede-Form, Inhalt und Layout-Wahl. Ein Anlass verweist auf eine Vorlage; mehrere Anlässe dürfen eine Vorlage teilen. Bilder liegen in einer Bildersammlung pro Bereich. Details: `2026-11-24-vereinsbote-03-gestaltung-design.md`.
- **Absender:** Postfachadresse, Anzeigename, Antwortadresse und Anbindung (Graph oder Resend). Mehrere Absender sind möglich, jeder Anlass wählt einen. *(Teilplan 4: Die Zugangsdaten liegen an einer eigenen Anbindung, die sich mehrere Absender teilen. Absender werden pro Bereich freigegeben; ein Anlass wählt nur freigegebene. Ein Absender ist der Absender für Systemmails.)*
- **Versandwelle:** ein Lauf eines Anlasses mit N Empfängern.
- **Postausgangs-Eintrag:** eine Mail an einen Empfänger.
  - Statusfolge: geplant → in Versand → gesendet, bzw. → zurückgewiesen (Rückläufer) oder → fehlgeschlagen.
  - Dazu: Anzahl der Versuche und letzte Fehlermeldung.
  - *(Teilplan 4: zusätzlich „übersprungen“ (vor dem Versand nicht mehr anschreibbar), „abgebrochen“ (Welle gestoppt) und „unklar“ (Lauf brach mitten im Senden ab; wird nicht automatisch erneut gesendet). Statt einer Fehlermeldung wird ein Fehlercode gespeichert.)*
- **Widerspruch:** Mitgliedsnummer bzw. bei Partnern die Kundennummer (falls keine vorhanden: die E-Mail) plus Anlass bzw. Bereich. Wird getrennt gespeichert und **überlebt jeden Import**.
- **[Claude] Sperre:** „Keine Mails mehr“ für einen Kontakt, in der App gesetzt, z. B. wenn ein Todesfall zwischen zwei Exporten bekannt wird. Wird wie ein Widerspruch getrennt gespeichert und überlebt jeden Import.
- **Benutzer und Rollen:** Pro Bereich eine Stufe (Lesen, Bearbeiten, Versenden). Dazu die Admin-Rolle.
- **Protokoll:** Wer hat wann was getan (Import, Versand, Einstellungsänderungen).

---

## 6. Funktionen

### 6.1 Ersteinrichtung

Ein Assistent führt durch die Einrichtung:

1. Admin-Konto anlegen.
2. CD einstellen.
3. Absender verbinden (Anleitung für Microsoft 365 bzw. Resend).
4. Ersten Import durchführen.
5. Bereiche und Benutzer anlegen.

**[Claude]** Der erste Admin meldet sich einmalig mit einem Einrichtungs-Token aus einer Umgebungsvariable an.

### 6.2 Import

**Mitglieder**

- **Hochladen und Zuordnen:**
  - CSV oder XLSX auswählen. *(Teilplan 2: Die Datei wird im Browser gelesen; an den Server gehen nur die zugeordneten Felder.)*
  - Die Spalten einmal den Feldern zuordnen, die App merkt sich die Zuordnung.
  - Mitglieder sind in der App schreibgeschützt; Korrekturen passieren in der Mitgliederverwaltung. In der App setzbar sind nur Sperre und Widerspruch.
  - CSV-Dateien aus deutscher Software haben oft Semikolon als Trennzeichen und den Zeichensatz Windows-1252. Beides wird erkannt.
- **Vorschau und Prüfung:**
  - Die App prüft E-Mail-Format, Datumsangaben und doppelte Mitgliedsnummern und zeigt eine Fehlerliste.
  - Nicht zugeordnete Spalten werden verworfen und nicht gespeichert.
  - Die Importdatei wird nach dem Import sofort gelöscht.
- **Austrittsdatum:** Der Export des ersten Vereins enthält nur aktive Mitglieder und eine Spalte für das Austrittsdatum („Austritt am“ o. ä.), mit der auch künftige Austritte gekennzeichnet sind. Der Export lässt sich in der Mitgliederverwaltung frei anpassen.
  - Die Spalte wird in der Zuordnung dem Feld Austrittsdatum zugeordnet.
  - Bei jedem Lauf gilt: Ist das Austrittsdatum erreicht oder überschritten, bekommt der Kontakt keine Mails mehr, auch wenn seit dem Austritt noch kein neuer Import kam.
  - Beim nächsten Import fehlt der Kontakt im Export und wird gelöscht.
- **[Claude] Import-Filter:** Für Vereine mit anderen Exporten lässt sich in der Zuordnung zusätzlich festlegen, welche Zeilen überhaupt übernommen werden, z. B. nur „Status = aktiv“. Zeilen außerhalb des Filters gelten als fehlend.
- **Komplett-Ersetzen:**
  - Wer im neuen Export fehlt oder durch den Filter fällt, wird gelöscht und nicht nur deaktiviert.
  - Widersprüche und Sperren bleiben erhalten.
- **[Claude] Sicherheitsabfrage:** Sinkt die Mitgliederzahl gegenüber dem letzten Import um mehr als 20 %, fragt die App ausdrücklich nach, bevor sie ersetzt. Das schützt davor, dass eine falsche Datei viele Mitglieder löscht.
- **[Claude] Warnung bei alten Daten:**
  - Ist der letzte Import älter als 8 Wochen, warnt die App in der Oberfläche und in der Vorschau-Mail. Zusätzlich bekommen die Admins eine Warn-Mail (**[Claude]** einmal pro Woche, solange der Zustand anhält). Die Frist ist einstellbar.
  - Automatische Mails laufen trotzdem weiter. Ein automatisches Pausieren würde die Glückwünsche still ausfallen lassen.

**Partner**

- Eigener Import ohne Komplett-Ersetzen. Abgleich über die Kundennummer, falls vorhanden, sonst über die E-Mail. Partner, die im Export fehlen, zeigt die Vorschau als „nicht mehr im Export“; gelöscht werden sie nur, wenn der Benutzer sie ankreuzt.
- Alternativ manuelle Pflege in der App, mit Schlagworten (z. B. „Sponsor“, „Presse“).

### 6.3 Automatische Anlässe

- **Auswertung:** Die Datumsregeln werden täglich in der Zeitzone Europe/Berlin ausgewertet. Die Mails werden zur eingestellten Uhrzeit verschickt (**[Claude]** Standard 08:00).
- **[Claude] 29. Februar:** In Nicht-Schaltjahren gilt der 28. Februar.
- **Vorschau-Mail:**
  - Die Zuständigen des Bereichs bekommen vorab eine Liste der kommenden Mails (**[Claude]** Standard: 7 Tage vorher, einstellbar).
  - **[Claude]** Zuständige sind alle Benutzer mit dem Recht Versenden im Bereich. Optional lässt sich pro Bereich eine abweichende Adresse für Hinweise eintragen.
  - Über einen Link in der App können sie einzelne Mails stoppen.
- **Nie doppelt:** Jede automatische Mail hat einen eindeutigen Schlüssel aus Anlass, Kontakt und Anlassdatum. Dieselbe Mail kann deshalb nicht zweimal entstehen, egal wie oft die Zeitsteuerung läuft.
- **[Claude] Nachholen nach einem Ausfall:**
  - Fiel die Zeitsteuerung aus, werden verpasste Anlässe bis zu 3 Tage nachgeholt.
  - Ältere werden übersprungen und im Dashboard angezeigt.
- **Jubiläen** funktionieren genauso wie Geburtstage, nur mit dem Eintrittsdatum.
- **Ohne nutzbare E-Mail:** Manche Kontakte haben einen Anlass, aber keine oder eine als ungültig markierte E-Mail-Adresse.
  - Sie erscheinen in der Vorschau-Mail und im Dashboard als eigene Liste („bitte anders gratulieren“).
  - Zusätzlich bekommen die Zuständigen des Bereichs eine eigene Warn-Mail, damit sie anrufen oder eine Karte schicken können.
  - Briefe erzeugt die App nicht.

### 6.4 Manuelle Anlässe

**Ablauf**

1. Anlass wählen oder anlegen.
2. Empfänger wählen, einzeln oder über einen Filter.
3. Anhänge hinzufügen.
4. Vorschau ansehen, pro Empfänger mit echten Daten.
5. Testmail an sich selbst schicken.
6. Versenden, sofort oder zu einem geplanten Zeitpunkt. Vorher erscheint ein Bestätigungsdialog mit der Empfängerzahl. **[Claude]** „Sofort“ verschickt das erste Paket direkt aus der Anfrage heraus. Der Rest folgt über den Postausgang.

**[Claude] Doppelte Adressen:** Bei Mails an eine Gruppe (z. B. Einladungen) geht pro E-Mail-Adresse nur eine Mail raus, auch wenn sich mehrere Kontakte eine Adresse teilen (z. B. Familien). Persönliche Anlässe wie Geburtstage gehen weiterhin pro Person. *(Teilplan 4: gesteuert über die Art des Anlasses; die Mail trägt die Werte des ersten Kontakts der Adresse. Die Testmail trägt die Werte des Kontakts in der Vorschau. Anhänge: PDF, JPEG, PNG, höchstens 4 MB pro Datei und 20 MB pro Mail, über Graph rund 3 MB pro Mail.)*

**Rechnungen**

- PDF hochladen.
- Eine XRechnung kann als separate XML-Datei vorliegen, in der Syntax UBL oder CII. Sie kann auch in die PDF eingebettet sein (ZUGFeRD/Factur-X). In beiden Fällen liest die App sie aus: Rechnungsnummer, Betrag, Fälligkeit und Käufer-E-Mail. Diese Werte stehen als Platzhalter zur Verfügung.
- Die App schlägt den Empfänger vor, indem sie die Käufer-E-Mail mit der Partnerliste abgleicht. Der Vorschlag muss immer bestätigt werden.
- Ohne XRechnung trägt man die Felder von Hand ein.
- Mehrere Rechnungen in einem Durchgang sind möglich. Jede wird einzeln zugeordnet und bestätigt.

**Einladungen**

- Optional hängt die App einen Kalendereintrag (.ics) an, mit Titel, Ort, Beginn und Ende.

### 6.5 Gestaltung

**Drei Ebenen:** CD → Layout → Inhalt (siehe 5).

**Klick-Editor**

- **Bausteine:** Überschrift, Text mit einfacher Formatierung (fett, kursiv, Link, Liste), Bild, Button, Trenner, Abstand, zwei Spalten, Platzhalter.
- **Bedienung:** vollständig mit der Tastatur möglich, auch das Umsortieren von Bausteinen ohne Maus.
- **Vorschau:** live, in Desktop- und Mobilansicht, wahlweise mit einem Beispielkontakt oder einem echten Kontakt.

**Platzhalter**

- Verfügbar sind:
  - Kontaktfelder
  - Anlassdaten (Alter, Jahre der Mitgliedschaft)
  - Rechnungsdaten
  - CD-Variablen
- **[Claude] Briefanrede:** Der berechnete Platzhalter `{{briefanrede}}` ergibt sich aus dem Feld Geschlecht (und bei Organisationen aus dem leeren Vornamen), z. B. „Liebe Anna“, „Lieber Max“, „Hallo Kim“ oder „Sehr geehrte Damen und Herren“. Die Zuordnung (auch für die Sie-Form) stellt der Verein pro Anlass ein. *(Teilplan 3: Schlüssel `{{salutation}}`, Du- oder Sie-Form und Texte pro Vorlage; alle Platzhalter-Schlüssel sind englisch, z. B. `{{contact.firstName}}`, mit Ersatztext `{{contact.firstName | "…"}}`.)*
- **[Claude] Keine Bedingungen in Vorlagen:** Bedingte Textblöcke gibt es in der ersten Version nicht. Unterschiedliche Texte (z. B. 50. vs. 90. Geburtstag, Mitglieder vs. Partner) entstehen über getrennte Anlässe mit eigener Regel bzw. eigenem Filter. So bleibt es dabei, dass pro Versandwelle nur einmal gerendert wird (siehe 7).
- Jeder Platzhalter kann einen Ersatztext für fehlende Werte haben.
- **[Claude]** Fehlt ein Pflichtwert ohne Ersatztext, wird die Mail an diesen Empfänger nicht verschickt, sondern als Fehler markiert.
- Alle Werte werden beim Einsetzen HTML-maskiert. Importierte Daten dürfen kein HTML in die Mail schleusen.

**Barrierefreiheit der Mails**

- Bilder brauchen einen Alternativtext (Pflicht). Rein dekorative Bilder werden ausdrücklich als solche markiert.
- Die CD-Farben werden auf Kontrast geprüft (WCAG AA, 4,5:1 für Text). Die App warnt beim Einstellen des CD.
- Überschriften sind echte Überschriften, die Hierarchie wird geprüft.
- Das `lang`-Attribut ist gesetzt. Layout-Tabellen haben `role="presentation"`.
- Zu jeder Mail entsteht automatisch eine Nur-Text-Version.
- Bei nichtssagenden Linktexten („hier klicken“) warnt die App.

**HTML-Import (für Profis)**

- **Eingabe:** HTML-Datei hochladen oder Code einfügen. Die Vorlage nutzt dieselbe Platzhalter- und CD-Variablen-Syntax. Ein Layout markiert seinen Inhaltsbereich mit `{{inhalt}}`. *(Teilplan 3: `{{content}}`.)*
- **React-Email-Vorlagen:** Sie werden außerhalb der App nach HTML exportiert und dann importiert. Die App führt keinen fremden Code aus.
- **Prüfungen beim Import:**
  - Mailtauglichkeit: Warnung bei CSS, das Outlook ignoriert.
  - Barrierefreiheit: dieselben Punkte wie oben, nur als Warnung.
  - Sicherheit: Skripte, Formulare, eingebettete Frames und Event-Handler werden entfernt.

**Bilder**

- **Verkleinern und Komprimieren:** Bilder werden vor der Ablage automatisch verkleinert und komprimiert.
  - **[Claude]** Höchstbreite 1200 px, also doppelte Auflösung für die übliche Mailbreite von 600 px.
  - **[Claude]** Formate: JPEG für Fotos, PNG für Grafiken und Logos mit Transparenz. WebP und AVIF nicht, weil Outlook sie nicht zuverlässig anzeigt.
  - **[Claude]** Die Verarbeitung passiert im Browser vor dem Hochladen. Das kostet auf dem Server keine Rechenzeit und funktioniert auf jeder Plattform gleich. Der Server prüft nur Größe und Format.
- **[Claude]** Bilder werden in den Dateispeicher hochgeladen und über öffentliche, nicht erratbare URLs eingebunden. Die URLs sind für alle Empfänger gleich, es gibt also kein Tracking. *(Teilplan 3: Der Speicher ist privat; die App liefert die Bilder selbst unter nicht erratbaren `/media/…`-Adressen aus.)*
- Anhänge bleiben privat.

### 6.6 Versand

**Postausgang und Zeitsteuerung**

- Jede Mail landet zuerst im Postausgang. Die Zeitsteuerung arbeitet ihn regelmäßig ab, **[Claude]** standardmäßig alle 15 Minuten (siehe Neon in 3).
- **[Claude]** Solange der Postausgang Arbeit hat, stößt jeder Lauf am Ende direkt den nächsten an. So sind auch 1.000 Einladungen bei 30 Mails pro Minute in gut 30 Minuten verschickt. Ohne Arbeit bleibt die Datenbank zwischen den Läufen im Schlaf.
- **Tageslimit pro Absender (optional):** z. B. 100 Mails pro Tag für Resend Free.
  - Der Postausgang prüft das Limit bei jedem Paket.
  - **Vorrang:** Einzelmails haben Vorrang vor Gruppenwellen. Dazu zählen automatische persönliche Mails wie Gratulationen und manuelle Einzelmails wie Rechnungen.
  - **[Claude]** Für bereits geplante Einzelmails des Tages hält der Postausgang Kontingent frei. Eine Einladungswelle am frühen Morgen kann also die Geburtstagsmails um 8 Uhr nicht verdrängen.
  - Eine Gruppenwelle, die das Limit übersteigt, verteilt sich auf mehrere Tage. **[Claude]** Der Bestätigungsdialog zeigt vorher an, wie viele Tage der Versand voraussichtlich dauert.
- Jeder Lauf verschickt Pakete bis zu einem Zeitbudget.
- Der Versand wird pro Absender gedrosselt, mit einstellbaren Grenzen. Standard für Graph: 30 Mails pro Minute.
- Bei Fehlern versucht die App es erneut, mit wachsenden Abständen. Nach der maximalen Zahl an Versuchen ist der Eintrag „fehlgeschlagen“ und im Dashboard sichtbar.

**Microsoft 365 (Graph)**

- **Zugriff:**
  - Anmeldung als App (Client Credentials) mit den Rechten `Mail.Send` und `Mail.Read`.
  - Beide Rechte werden in Exchange auf die Absenderpostfächer beschränkt (RBAC for Applications bzw. Application Access Policy). Das geht nur über Exchange Online PowerShell. Die Anleitung macht diesen Schritt zur Pflicht und liefert fertige Befehle zum Kopieren.
  - **[Claude]** Nach der Einrichtung prüft die App, ob die Beschränkung wirkt: Sie versucht, ein Postfach zu lesen, das kein Absender ist, etwa das der einrichtenden Person. Gelingt das, warnt sie deutlich.
  - Gruppenpostfächer als Absender sind empfohlen, sie kosten keine Lizenz.
- **Versand:**
  - Mails werden im Ordner „Gesendet“ gespeichert.
  - Anhänge über 3 MB laufen über eine Upload-Session.
  - *(Teilplan 4: Die Rechte bleiben `Mail.Send` und `Mail.Read`. Eine Upload-Session bräuchte `Mail.ReadWrite`; sie entfällt. Jede Mail geht als ein MIME-Aufruf (nur so lassen sich `List-Unsubscribe` und eine eigene Message-ID setzen), Anhänge sind über Graph auf rund 3 MB pro Mail begrenzt. Systemmails gehen ohne Ablage in „Gesendet“, damit Anmeldelinks nicht im Postfach liegen.)*
- **Ablauf des Secrets:**
  - Die App kennt das Ablaufdatum des Secrets.
  - Sie warnt 30 Tage vorher in der Oberfläche und per Mail an die Admins.
- **Rückläufer:**
  - Die App prüft regelmäßig das Absenderpostfach auf Unzustellbarkeitsberichte.
  - Sie ordnet sie über die Message-ID der Original-Mail zu und setzt den Status.
  - Der Kontakt wird mit „E-Mail ungültig“ markiert, und der Bereich bekommt einen Hinweis.
  - **[Claude]** Die App liest nur, sie verschiebt oder löscht nichts im Postfach. Welche Berichte schon verarbeitet sind, merkt sie sich in der Datenbank.
  - *(Teilplan 4: Nur harte Rückläufer markieren den Kontakt mit „E-Mail ungültig“; die Markierung hängt an Kontaktschlüssel und Adresse.)*

**Resend**

- API-Key und Bestätigung der Domain per DNS.
- Die Antwortadresse ist das Vereinspostfach. Optional geht eine Blindkopie an ein Archivpostfach.
- Zustellung und Rückläufer meldet Resend über einen signierten Webhook.

**Abmelden**

- Optional pro Anlass, nie bei Rechnungen.
- Die Mail enthält einen Abmeldelink und den Header `List-Unsubscribe`.
- Der Link führt zu einer öffentlichen Seite mit signiertem Token und erzeugt einen Widerspruch.
- *(Teilplan 4: Die Seite bietet „nur dieser Anlass“ (vorausgewählt) oder „alle Mails aus diesem Bereich“; die Ein-Klick-Abmeldung des Mailprogramms (`List-Unsubscribe-Post`) gilt nur für den Anlass.)*

### 6.7 Rollen und Anmeldung

**Rollen**

- **Bereiche** mit den Stufen Lesen, Bearbeiten und Versenden pro Benutzer.
- **[Claude] Geschützte Felder:**
  - Alle Benutzer eines Bereichs (ab Lesen) sehen die geschützten Felder, die diesem Bereich zugeordnet sind. Andere Bereiche sehen sie nicht.
  - Vorlagen, Empfängerfilter, Vorschau und Testmails eines Bereichs können nur Basisfelder und die geschützten Felder dieses Bereichs verwenden. Der Editor bietet andere Felder gar nicht erst an. Ein HTML-Import mit unerlaubten Platzhaltern wird abgelehnt.
  - Globale Layouts (Admin) dürfen nur CD-Variablen und Basisfelder verwenden.
- **[Claude] Basisfelder** (Name, E-Mail, Typ, Gruppen) aller Kontakte sind für alle Benutzer mit einem Bereichsrecht sichtbar und als Empfänger wählbar.
- **[Claude] Import-Rechte:**
  - Den Mitglieder-Import darf, wer Bearbeiten in dem Bereich hat, dem die geschützten Mitgliederfelder zugeordnet sind (Standard: „Mitglieder“).
  - Den Partner-Import darf, wer Bearbeiten im Partner-Bereich hat (Standard: „Finanzen“).
- **Die Admin-Rolle** verwaltet CD, Layouts, Absender (*Teilplan 4: und gibt sie pro Bereich frei*), Bereiche und Benutzer. Mitgliederdaten sieht sie nur mit zusätzlichen Bereichsrechten. **[Claude]** Der Einrichtungsassistent gibt dem ersten Admin Bearbeiten im Bereich „Mitglieder“, damit der erste Import möglich ist. Das Recht lässt sich danach entziehen.

**Anmeldung**

- über das Microsoft-Konto, beschränkt auf den Tenant des Vereins,
- oder über einen Anmeldelink per Mail, verschickt über den eingerichteten Absender.
- Es gibt keine Passwörter und keine Selbstregistrierung. Admins laden Benutzer ein.

### 6.8 Datenschutz

**Datensparsamkeit**

- Nur zugeordnete Spalten werden gespeichert.
- Importdateien werden sofort gelöscht.
- Ausgetretene Mitglieder werden gelöscht.

**Löschfristen (einstellbar)**

- **[Claude]** Versandprotokolle mit Empfängerdaten: Standard 6 Monate.
- **[Claude]** Anhänge: werden zusammen mit dem Versandprotokoll gelöscht.
- **[Claude]** Aktivitätsprotokoll: Standard 12 Monate.

**Rechte der Betroffenen**

- Widersprüche pro Anlass oder Bereich.
- **[Claude]** Die Daten eines Kontakts lassen sich als Datei exportieren (Auskunft nach Art. 15 DSGVO), einschließlich Versandprotokoll. Das darf, wer Bearbeiten im Mitglieder- bzw. Partner-Bereich hat.

**Technische Absicherung**

- Zugangsdaten (Graph-Secret, Resend-Key) werden verschlüsselt gespeichert (AES-GCM). Der Schlüssel kommt aus einer Umgebungsvariable.
- Die Datenbank (Neon Frankfurt) und die Dateien (R2 mit EU-Gerichtsbarkeit bzw. Vercel Blob in einer EU-Region) liegen in der EU.

**Doku für Vereine**

- Vorlage für den Eintrag im Verarbeitungsverzeichnis.
- Liste der Auftragsverarbeiter (Hosting, Datenbank, Dateien, Versand).

### 6.9 Barrierefreiheit der App

- Die App erfüllt WCAG 2.2 AA: Tastatur, Screenreader, Kontrast, sichtbarer Fokus, Fehlermeldungen in Formularen.
- Automatische Prüfungen (z. B. axe) in den Tests, ergänzt um manuelle Prüfungen mit Tastatur und Screenreader für die Kernabläufe.

### 6.10 Betriebsüberwachung

- **Dashboard** mit:
  - letztem Lauf der Zeitsteuerung
  - Zustand des Postausgangs
  - fehlgeschlagenen Mails und Rückläufern
  - Ablaufdatum des Graph-Secrets
  - Alter des letzten Imports
- **Mail an die Admins** bei fehlgeschlagenen Versänden oder einem bald ablaufenden Secret.
- **Ausfall der Zeitsteuerung oder der Datenbank** (z. B. aufgebrauchtes Neon-Kontingent): Dann kann die App selbst keine Mail schicken. Das Dashboard zeigt es deutlich an. **[Claude]** Optional lässt sich eine externe Heartbeat-URL konfigurieren, die bei jedem Lauf aufgerufen wird. Sie ist die einzige Warnung von außen, deshalb empfiehlt die Doku sie ausdrücklich.

---

## 7. Technische Architektur

- **Framework:** TanStack Start (React, Vite). Deploy-Ziele: Vercel, Cloudflare Workers, Node/Docker.
- **Datenbank – [Claude], abweichend vom Gespräch:** überall Postgres mit Drizzle ORM. Auf Vercel und Cloudflare ist das Neon (Region Frankfurt), im Docker ein normales Postgres.
  - **Gründe:**
    - Es gibt nur einen SQL-Dialekt, ein Schema und einen Migrationsweg.
    - Echte Transaktionen sind möglich, wichtig für Postausgang und Idempotenz.
    - Neon Free kostet nichts.
  - **Preis:** Cloudflare-Vereine brauchen zusätzlich ein Neon-Konto statt D1. Im Gespräch war für Cloudflare noch D1 genannt.
- **[Claude] Dateien:** über eine kleine Speicher-Schnittstelle mit drei Umsetzungen:
  - Cloudflare R2 mit EU-Gerichtsbarkeit (auf Cloudflare)
  - Vercel Blob in einer EU-Region (auf Vercel; die verfügbare Region vor der Umsetzung prüfen)
  - S3 (im Docker)
  - Grund: Vercel-Vereine brauchen so kein zusätzliches Cloudflare-Konto. Die Datenbank (Neon) können sie direkt über den Vercel Marketplace anlegen.
  - *(Teilplan 3: R2 per Binding mit `jurisdiction = "eu"`, Vercel Blob als privater Store in `fra1`, S3 über `s3mini`; in Entwicklung und CI SeaweedFS. Alle Objekte sind privat.)*
- **Zeitsteuerung:**
  - Auslöser: die Zeitsteuerung der Plattform (Vercel Cron/Schedules, Cloudflare Cron Triggers), im Docker ein interner Taktgeber.
  - Alle rufen einen geschützten Endpunkt „tick“ auf.
  - Ein Tick erledigt nacheinander:
    1. Datumsregeln auswerten
    2. Postausgang abarbeiten
    3. Rückläufer prüfen
    4. Fristen löschen
    5. Warnungen erzeugen
  - Jeder Schritt arbeitet mit einem Zeitbudget und setzt beim nächsten Tick fort.
- **Mail-Erzeugung:**
  - Die Bausteinliste (JSON) wird zu React-Email-Komponenten, daraus entstehen HTML und eine Nur-Text-Version.
  - Pro Versandwelle wird einmal gerendert, mit Markierungen für die Platzhalter. Pro Empfänger werden dann nur noch die Werte eingesetzt. Das spart Rechenzeit, wichtig für Cloudflare.
- **Versand-Schnittstelle:** eine Adapter-Schnittstelle (Mail senden, Rückläufer abholen, Limits). Implementierungen: Graph und Resend, später SMTP.
- **[Claude] Anmeldung:** Better Auth (Microsoft-Provider und Magic Link). Ein Builder darf eine gleichwertige Bibliothek wählen, wenn sie auf Workers läuft.
- **Konfiguration:** über Umgebungsvariablen. Die plattformspezifischen Teile bleiben klein und klar abgegrenzt (Datenbanktreiber, Zeitsteuerung, Umgebung).

---

## 8. Auslieferung und Dokumentation

- **[Claude] Wer installiert:** eine technisch versierte Person. Die Zielvereine betreiben bereits Next.js- bzw. Sanity-Websites, so jemand ist also vorhanden. Die tägliche Nutzung und die Einrichtung in der App (CD, Absender, Import) übernehmen Ehrenamtliche ohne Technikkenntnisse.
- **[Claude] Updates:**
  - Es gibt versionierte Releases mit Änderungsprotokoll.
  - Datenbank-Migrationen laufen beim Deploy automatisch und bleiben mit älteren Daten verträglich.
  - Ein Verein aktualisiert, indem er seinen Fork synchronisiert und neu deployt.
- **Lizenz:** MIT.
- **Doku-Website im Projekt:** Eine typische Dokumentations-Website ist Teil des Repos, zweisprachig in Deutsch und Englisch. Die `README.md` ist englisch. (Nachtrag 2026-11-23, Wunsch des Projekts.)
  - **[Claude]** Gebaut mit Astro und Starlight. Starlight ist auf Dokumentation zugeschnitten und bringt Suche, Navigation und eine barrierefreie Grundlage mit.
  - **[Claude]** Das Repo ist ein Monorepo mit App und Doku-Website nebeneinander.
  - Sie enthält alle Anleitungen unten, ein Benutzerhandbuch für Ehrenamtliche und eine Entwickler-Doku (Architektur, Mitwirken).
- **Installationsanleitungen** für Vercel, Cloudflare und Docker, wo möglich mit Deploy-Button.
- **Anleitung für Microsoft Entra** mit Screenshots, inklusive Beschränkung auf die Absenderpostfächer und Hinweis auf den Ablauf des Secrets.
- **Anleitung für Resend**, inklusive DNS-Einträge und Hinweis auf die Tarifgrenzen.
- **Datenschutz-Vorlagen** (siehe 6.8).
- **Mitgelieferte Startvorlagen:** runder Geburtstag, Mitgliedsjubiläum, Einladung, Rechnung. Sie übernehmen das CD automatisch. *(Teilplan 3: Sie kommen mit dem Teilplan ihrer Platzhalter: Einladung 3, Geburtstag und Jubiläum 5, Rechnung 6.)*

---

## 9. Dem Builder überlassen

- **Bibliotheken:**
  - barrierefreie UI-Bausteine (z. B. React Aria Components oder Base UI)
  - Ziehen und Ablegen mit Tastaturunterstützung
  - Parser für CSV, XLSX und XML
- Datenbankschema im Detail.
- Takt der Zeitsteuerung und Paketgrößen innerhalb der Plattformgrenzen.
- Aufbau der Plattformadapter.
- Teststrategie im Detail. Pflicht sind:
  - Snapshot-Tests für das Mail-Rendering
  - automatisierte Barrierefreiheitsprüfungen
  - Tests für Idempotenz und Import-Ersetzen
  - E2E-Tests der Kernabläufe: Ersteinrichtung, Import, automatische Anlässe (mit simulierter Zeit), manueller Versand mit Testmail, Tageslimit mit Vorrang, Rollen und Rechte. **[Claude]** Der Versand läuft dabei gegen einen lokalen Mail-Fänger (z. B. Mailpit) bzw. eine Test-Anbindung statt gegen Microsoft oder Resend.

---

## 10. Offene Punkte

- Keine. Die Lizenz ist MIT (siehe 8).

---

## 11. Gesammelte [Claude]-Entscheidungen zur Prüfung

1. **Datenbank:** Postgres (Neon) auf beiden Plattformen statt D1 auf Cloudflare.
2. **Anmeldung:** Better Auth mit Microsoft-Login und Magic Link. Der erste Admin richtet sich über ein Einrichtungs-Token ein.
3. **Import-Sicherheitsabfrage** bei mehr als 20 % weniger Mitgliedern.
4. **Warnung bei alten Daten:** nach 8 Wochen, ohne automatisches Pausieren.
5. **Automatische Mails:**
   - Versand um 08:00
   - Vorschau-Mail 7 Tage vorher
   - Geburtstag am 29. Februar wird am 28. Februar gefeiert
   - Nachholen bis 3 Tage
6. **Fehlender Pflicht-Platzhalter:** Die Mail wird nicht gesendet, sondern als Fehler markiert.
7. **Bilder:** öffentliche, nicht erratbare URLs. Anhänge bleiben privat.
8. **Rückläufer bei Microsoft 365:** nur lesen, nichts im Postfach verändern.
9. **Löschfristen:** Versandprotokoll 6 Monate, Aktivitätsprotokoll 12 Monate.
10. **Datenexport pro Kontakt** (Auskunft).
11. **Keine Vier-Augen-Freigabe** in der ersten Version.
12. ~~Oberfläche nur auf Deutsch~~ – ersetzt: Deutsch und Englisch von Beginn an (Wunsch des Projekts).
13. **Erfolgskriterium:** Ein weiterer Verein installiert den Vereinsbote anhand der Doku selbst.
14. **Optionale Heartbeat-URL** zur Überwachung der Zeitsteuerung.
15. **Tarife:** Cloudflare Workers Paid ist Pflicht. Auf Vercel ist Pro offiziell unterstützt, Hobby läuft ohne Zusage.
16. **Takt:** alle 15 Minuten. Läufe stoßen sich bei voller Warteschlange selbst an, „sofort senden“ startet direkt.
17. **Geschützte Felder streng pro Bereich**, auch in Vorlagen, Filtern, Vorschau und Testmails. Dazu die Import-Rechte und das Mitglieder-Recht für den ersten Admin.
18. **Dateien auf Vercel** über Vercel Blob statt R2.
19. **Import:** Import-Filter (z. B. nur aktive Mitglieder), Sperre „keine Mails mehr“, eine Mail pro Adresse bei Gruppenversand.
20. **Platzhalter:** `{{briefanrede}}` aus dem Feld Geschlecht. Keine bedingten Textblöcke, Varianten über getrennte Anlässe.
21. **Zuständige** eines Bereichs sind alle mit dem Recht Versenden, optional mit abweichender Hinweis-Adresse.
22. **Installation und Updates:** Installation durch eine technisch versierte Person. Updates per Fork-Synchronisierung mit automatischen Migrationen.
23. **Selbsttest der Postfach-Beschränkung** bei Microsoft 365.
24. **Warn-Mail bei alten Daten:** einmal pro Woche an die Admins.
25. **Bilder:** Höchstbreite 1200 px, JPEG/PNG, Verarbeitung im Browser.
26. **Tageslimit:** Für geplante Einzelmails wird Kontingent freigehalten. Der Dialog zeigt die voraussichtliche Versanddauer.
27. **Doku-Website:** Astro mit Starlight, im Monorepo neben der App.
28. **E2E-Tests** laufen gegen einen lokalen Mail-Fänger statt gegen echte Anbieter.
