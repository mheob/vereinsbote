# Vereinsbote – Umsetzungs-Fahrplan

**Spec:** `docs/superpowers/specs/2026-11-23-vereinsbote-design.md`

Die Spec umfasst mehrere eigenständige Teilsysteme. Sie wird deshalb in acht Teilpläne zerlegt, die nacheinander umgesetzt werden.

- Jeder Teilplan endet mit lauffähiger, getesteter Software.
- Veröffentlicht wird erst, wenn alle acht fertig sind. Die Spec sagt: „alles in der ersten Version“.
- Den jeweils nächsten Teilplan schreiben wir erst, wenn der vorherige umgesetzt ist. So baut er auf den echten Schnittstellen auf und nicht auf geplanten.

## Teilpläne

| # | Teilplan | Ergebnis | Spec | baut auf |
|---|---|---|---|---|
| 1 | Fundament | Monorepo, App-Gerüst, Zweisprachigkeit (de/en), Datenbank, Verschlüsselung, Anmeldung ohne Passwort, Bereiche und Stufen, Ersteinrichtung, Benutzerverwaltung, Zeitsteuerung, Builds für Vercel/Cloudflare/Docker, CI, E2E | 3, 6.1, 6.7, 6.8 (Verschlüsselung), 6.10 (Heartbeat), 7, 8 (Lizenz, Migrationen) | – |
| 2 | Kontakte und Import | Kontaktmodell mit Schutzstufen und Feldrechten, Mitglieder-Import (CSV/XLSX, Zuordnung, Filter, Austrittsdatum, Komplett-Ersetzen, Sicherheitsabfrage), Partner-Import und -Pflege, Widerspruch, Sperre, Warnung bei alten Daten | 5, 6.2, 6.7 | 1 |
| 3 | Gestaltung und Rendering | Speicher-Schnittstelle (R2, Vercel Blob, S3), CD, Standard-Layout, Bausteinmodell, Rendering mit React Email, Platzhalter (inkl. Briefanrede und Maskierung), Barrierefreiheits-Prüfungen, Klick-Editor, Vorschau, Bildverarbeitung, HTML-Import. Ein Design, zwei PRs: 3a (CSP, Speicher, CD, Rendering) und 3b (Vorlagen, Editor, Import) | 6.5, 7 (Dateien) | 1, 2 |
| 4 | Versand | Absender, Versand-Schnittstelle, Anbindungen für Graph und Resend, Postausgang (Drosselung, Tageslimit, Vorrang, Wiederholung, Selbst-Anstoß), manueller Versand mit Testmail, Entfernen doppelter Adressen, Abmelden, Rückläufer, Warnung vor Secret-Ablauf, Systemmails über den echten Absender | 6.4, 6.6 | 1–3 |
| 5 | Automatische Anlässe | Datumsregeln, Geburtstage und Jubiläen, Vorschau-Mail, Warn-Mails, Idempotenz, Nachholen, Dashboard | 6.3, 6.10 | 1–4 |
| 6 | Rechnungen und Einladungen | PDF-Upload, XRechnung (UBL/CII) und ZUGFeRD, Empfängervorschlag, .ics | 6.4 | 1–4 |
| 7 | Datenschutz-Funktionen | Löschfristen, Auskunfts-Export, Inhalte der Doku-Vorlagen | 6.8 | 1–6 |
| 8 | Doku-Website und Release | Astro und Starlight im Monorepo, zweisprachig (Deutsch und Englisch); Anleitungen für Installation, Entra und Resend; Handbuch; Entwickler-Doku; Release-Ablauf mit Versionen und Änderungsprotokoll | 8 | 1–7 |

## Werkzeuge (gelten für alle Teilpläne)

- **Versionen:** immer die neueste stabile Version von Node (derzeit 26 LTS), pnpm, TypeScript, allen Abhängigkeiten und Docker-Images.
- **Sicherheit:** GitHub Actions per Commit-SHA und Container-Images per Digest gepinnt, Renovate (Preset `github>mheob/renovate-config`) hält die Pins aktuell; CI über `voidzero-dev/setup-vp`; CI mit minimalen Rechten; pnpm-Lieferkettenschutz. Sicherheit hat in allen Teilplänen hohe Priorität.
- **Sprache der Doku:** `README.md` und andere Repo-Dateien für Entwickler sind englisch. Die Doku-Website (Teilplan 8) ist zweisprachig, Deutsch und Englisch.
- **Vite+** (`vite-plus`, CLI `vp`) ist die einzige Toolchain: Dev, Build, Test, Lint, Format, Typprüfung und Task-Runner. Konfiguriert wird nur in `vite.config.ts`.
- **pnpm** mit `catalogMode: strict`. Alle Versionen stehen im Catalog in `pnpm-workspace.yaml`, die `package.json`-Dateien nutzen `"catalog:"`.
- **Lint und Format:** `@mheob/oxlint-config` und `@mheob/oxfmt-config`, eingebunden in die `lint`- und `fmt`-Blöcke von Vite+.
- **Commits:** `@mheob/commitlint-config` mit czg.
- **Git-Hooks:** über Vite+ in `.vite-hooks/`: `pre-commit` ruft `vp staged` auf, `commit-msg` ruft commitlint auf.
- **Teilplan 8 (Astro):** `vp dev` und `vp build` starten immer reines Vite. Die Doku-Website läuft deshalb über `vp run --filter docs dev` bzw. `vp run --filter docs build`.

Die Details stehen in Teilplan 1 unter „Global Constraints“ und „Task 1“.

## Offene Punkte für spätere Teilpläne

- **Sprache der Mails an Mitglieder und Partner:** entschieden am 2026-11-24 (Design Teilplan 2): Kontakte haben keine Sprache, Mails an Kontakte sind deutsch, ein Anlass hat genau einen Text. Die Oberfläche bleibt zweisprachig; Systemmails gehen in der Sprache des Benutzers.

- **Aus dem Abschluss-Review von Teilplan 1** (verbindlich für die genannten Teilpläne):
  - Teilplan 3: vollständige Content-Security-Policy, bevor Editor, HTML-Import und Vorschau kommen.
  - Teilplan 4: Tageslimit pro Adresse für Anmeldelinks (Schutz des Versandkontingents); Bestätigungsschritt für Magic Links, damit Mail-Scanner sie nicht verbrauchen; AES-GCM mit zugeordneten Daten (AAD) pro gespeicherter Einstellung; fehlgeschlagene Einladungen erneut senden.
  - Teilplan 7: Aufbewahrungsfristen inkl. Aktivitätsprotokoll.
  - Teilplan 7 (aus dem Design von Teilplan 2): Ansicht und Löschfrist für verwaiste Sperren und Widersprüche (Kontakt nicht mehr im Bestand).
  - Später: automatisierter Smoke-Test der Cloudflare-Laufzeit in CI.

- **Aus Teilplan 2** (verbindlich für die genannten Teilpläne):
  - Teilplan 3 (CSP) – **erledigt in 3a:** zod v4 prüft beim Anlegen des ersten Objekt-Schemas mit `new Function("")`, ob es seinen JIT nutzen darf. Der Fehlschlag wird abgefangen, eine CSP ohne `unsafe-eval` meldet ihn aber als Verstoß (`securitypolicyviolation`, Report). Vor einer solchen CSP `z.config({ jitless: true })` setzen, bevor das erste Schema entsteht (ein eigenes Modul, das der Client-Einstieg zuerst importiert; dann entfällt die Prüfung), oder den Verstoß bewusst zulassen.
  - Teilplan 8 (Anleitung für Cloudflare), spätestens vor der Veröffentlichung: Die CPU-Zeit der Server-Hälfte eines Imports (gunzip, `JSON.parse`, zod, Umwandlung der Zeilen) ist gegen das Limit von Workers Free (10 ms CPU pro Aufruf) nicht gemessen. Einmal mit `wrangler` messen (Vorschau und Bestätigung eines Imports mit 10 000 Zeilen) oder für Importe „Workers Paid“ dokumentieren.
  - Teilplan 3 – **erledigt in 3a:** beide CSP-Punkte (vollständige CSP mit Nonce, zod `jitless`) sind umgesetzt (Design `2026-11-24-vereinsbote-03-gestaltung-design.md`, Abschnitt 17; `platform/security-headers.ts`, `zod-config.ts`). Gilt mit dem Merge von 3a.
  - Teilplan 7 (Doku-Vorlagen), bekannte Grenze: Die Import-Vorschau kann verraten, ob ein geschützter Wert, den der Importierende nicht sehen darf, einem geratenen Wert in der Datei gleicht (der Kontakt zählt als geändert oder nicht). Das folgt aus wahrheitsgemäßen Zahlen; der Importierende darf diese Werte ohnehin überschreiben.

- **Aus Teilplan 3** (Design `2026-11-24-vereinsbote-03-gestaltung-design.md`, verbindlich für die genannten Teilpläne):
  - Teilplan 4: Die kompilierte Fassung einer Vorlage (einmal gerendert, Platzhalter markiert) pro Versandwelle speichern; spätere Änderungen an der Vorlage ändern keine laufende Welle. Ein fehlender CD-Pflichtwert lässt die ganze Welle scheitern, bevor eine Mail entsteht; ein fehlender Kontakt-Pflichtwert nur die Mail dieses Empfängers. Das Löschen einer Vorlage sperren, die ein Anlass nutzt. Entscheiden, ob Systemmails im CD-Layout gehen (das Render-Modul nimmt eine Sprache). Testmail an sich selbst.
  - Teilplan 5: Platzhalter `occasion.*` (Alter, Jahre der Mitgliedschaft) in der Platzhalter-Registry ergänzen; Startvorlagen „Geburtstag“ und „Jubiläum“.
  - Teilplan 6: Platzhalter `invoice.*`; Startvorlage „Rechnung“.
  - Teilplan 7: Bilder und ersetzte Logos, die keine Vorlage und kein CD mehr nutzt, die aber verschickte Mails noch zeigen: Aufbewahrung und Löschfrist.

- **Nacharbeit aus Teilplan 2** (zurückgestellte Funde der Task-Reviews und des Abschluss-Reviews, nicht blockierend; aufgreifen, wenn ein Teilplan die Stelle ohnehin berührt, spätestens vor der Veröffentlichung):
  - **Leistung:**
    - `loadContactAccess` braucht 9 Abfragen in 5 Runden und läuft pro Seite mehrfach (Rahmen, `beforeLoad`, Loader, Partnerformular). Einstellungen, Zusatzfelder und Feldzuordnungen in einer Abfrage bündeln.
    - Gruppen- und Schlagwortlisten nur für die passende Kontaktart abfragen; die Seitenzahl vor den Zugriffsabfragen prüfen.
    - Kontakt-Einstellungen werden pro Dokument doppelt gelesen (Rahmen und Warnschritt).
    - Das Partnerformular erst bei „Bearbeiten“ laden statt bei jedem Aufruf der Detailseite.
    - `keepLeadingZeros` legt für jede Zelle eine Attribut-Map an (10 000 × 200 Zellen ≈ 2,5 s); zuerst das `s`-Attribut prüfen.
    - Die Lesebibliotheken (`papaparse`, `read-excel-file`, `fflate`) landen als nie ausgeführter Code in den Server-Bundles (≈ 250 KB). Eine Client-only-Grenze um das Einlesen ziehen, falls das wächst.
  - **Robustheit und Bedienung:**
    - Gruppen auf eigenen Zeilen einer Zelle verschmelzen, weil die Bereinigung Zeilenumbrüche vor dem Aufteilen zu Leerzeichen macht.
    - Unsichtbare Formatzeichen (`\p{Cf}`, z. B. U+200B, U+FEFF) bei der Bereinigung entfernen, damit Nummern als Schlüssel nicht unsichtbar abweichen.
    - Die Schlüssel von `genderValues` auch auf dem Server bereinigen.
    - Dezimalzahlen und Wahrheitswerte aus XLSX erscheinen in englischer Form („12.5“, „true“); Datums-Randfälle von `read-excel-file` (`t="d"`, `date1904="true"`, Serien vor 1900-03-01); eine fehlerhafte Zelle in einem anderen Blatt macht die ganze Datei unlesbar.
    - Die Liste der blockierenden Fehler ist nicht begrenzt (die Oberfläche zeigt 1 000). Übersprungene Partnerzeilen fehlen im Ergebnis und im Protokoll. Eine übersprungene namenlose Zeile reserviert ihre Adresse (eine spätere Zeile wird `emailRepeated`). Zeilen einer Datei können in einen Partner falten, den dieselbe Datei erst angelegt hat. Eine leere `Nr.` wird als „behaltener Wert“ gezeigt.
    - Der Gruppenfilter unterscheidet Groß- und Kleinschreibung, Schlagworte nicht.
    - Löschdialog: Escape schließt ihn während des Löschens; ein fehlgeschlagenes Löschen (Kontakt schon weg) lässt den Partner stehen.
    - Widerspruch-Kontrollkästchen und Feldschutz-Zeilen verhindern keine parallelen Klicks (Ansagen können in falscher Reihenfolge kommen).
    - Die Enter-Logik im Schlagwortfeld hängt an der Ereignisreihenfolge von React Aria.
    - Ein fehlendes Recht bei Änderungen kommt als Fehler statt als Ergebnis (wie in Teilplan 1); `renameArea` wirft für einen inzwischen entfernten Bereich einen einfachen Fehler.
    - Auf Admin-Seiten tragen zwei Links `aria-current="page"` („Verwaltung“ sollte `location` nutzen). Beim Entfernen der 50. Filterregel geht der Fokus verloren.
    - Die Kontaktliste übernimmt ihren Zustand nur einmal aus den Loader-Daten; `gcTime: 0` behebt nur das Symptom (die Liste über die Loader-Daten neu aufbauen).
    - Warn-Mail bei alten Daten: Schlägt das Protokoll nach dem Versand fehl, bleibt die Woche beansprucht; ein Zeitstempel in der Zukunft blockiert Warnungen, bis er erreicht ist.
  - **Tests:**
    - Identitätsprüfungen von `contacts` auf Constraint-Namen statt `toThrow(Error)`; Unit-Test für `protectedFieldOf`; ein Admin mit Leserecht in einem fremden Bereich sieht keine geschützten Felder; die Listen-Antwort enthält keine geschützten Werte (JSON-Prüfung); ein unterscheidender Backslash-Fall für das Escaping.
    - Ein abgelehnter Aufruf schreibt nichts (Sperre und Widerspruch; Partner-Import mit unzulässiger Löschauswahl prüft auch den Import-Status).
    - Der Zip-Bomb-Test soll Streaming-Abbruch von Entpacken-dann-Prüfen unterscheiden; CSV mit Semikolon und Dezimalkomma; Arbeitsmappe im 1904-Datumssystem.
    - PostgreSQL: Test-Sperre in `finally` freigeben; Warnungsfilter auch über `warning.name`; gleichzeitige Claims der Warn-Mail; Teilfehler beim Versand (eine von zwei Mails).
    - E2E: Ansicht ohne Kontaktzugriff, Warnbanner, Seitenwechsel der Liste, unbekannter Kontakt, Widerspruch aufheben, Bereichswechsel mit echter Änderung; axe auch für blockierte Vorschau, Blattwahl, Import ohne Recht, Zusatzfeld- und Filterfelder und die Liste „Nicht mehr im Export“; Zählungen exakt statt mit `toContainText`.
  - **Code-Pflege:**
    - Drei parallele Listen geschützter Spalten (`PROTECTED_VALUE_FIELDS`, `PROTECTED_INPUT_FIELDS`, `PROTECTED_FIELD_OF`) und den Typ `ProtectedValueField` aus einer Quelle ableiten; `isKeyMapped` steht doppelt (`rows.ts`, `build-payload.ts`).
    - Den Partner-Import für Schlüsselwechsel über `followKey` führen (eine Regel statt einer Invariante über Module).
    - `functions/contact-settings.ts` importiert `protectedFieldRows` aus `components/`, `list-query.ts` ganz `partner-form.ts` für eine Konstante; `search-result.ts` leiht den Typ `Translate` aus dem Import-Assistenten (gemeinsamen Typ in `@/i18n` anlegen); die Kontaktliste nutzt den Fehlertext `auth.requestFailed`.
    - `testing.ts` nutzt `node:crypto` statt `crypto.randomUUID()`; `setCustomFieldProtection` protokolliert auch unveränderte Werte; der Kommentar zu `MAX_DELETE_IDS` stimmt nicht; die Statuszeile des Import-Assistenten wiederholt die Überschrift; Tippfehler „without a area“ in `contacts-table.test.ts`.

- **Betriebsüberwachung (Wunsch des Projekts, nach Einarbeitung aller offenen Punkte):** Ein System, das sicherstellt, dass jede Instanz läuft, eingebaut und in der Doku beschrieben. Kandidaten: Better Stack (Uptime-Checks, Heartbeat für die Zeitsteuerung, Logs) und Sentry (Fehler-Tracking für Server und Browser). Rahmen: optional pro Instanz über Umgebungsvariablen, EU-Region, keine personenbezogenen Daten und keine Secrets in Events (Scrubbing wie bei `errorLabel`), Auftragsverarbeiter in der Datenschutz-Doku ergänzen, auf allen drei Plattformen (Node, Vercel, Cloudflare). Passt zu Teilplan 5 (Dashboard, `HEARTBEAT_URL`) bzw. als eigener Teilplan vor der Veröffentlichung; wird beim Schreiben dieses Teilplans im Brainstorming geklärt.

## Glossar: Fachbegriff und Name im Code

Alles, was Code ist, ist englisch: Bezeichner, Dateinamen, URL-Pfade, HTML-IDs, CSS-Klassen, Cookie-Namen und Testtitel. Die Oberfläche ist zweisprachig (Deutsch als Standard, Englisch). Diese Zuordnung gilt für alle Teilpläne.

| Spec | Code |
|---|---|
| Bereich | `area` |
| Stufe Lesen / Bearbeiten / Versenden | `AccessLevel`: `read` / `edit` / `send` |
| Kontakt, Mitglied, Partner | `contact`, `member`, `partner` |
| Mitgliedsnummer, Kundennummer | `memberNumber`, `customerNumber` |
| Anlass, Auslöser, Datumsregel | `occasion`, `trigger`, `dateRule` |
| Vorlage, CD, Layout, Baustein, Platzhalter | `template`, `brand`, `layout`, `block`, `placeholder` |
| Absender, Anbindung | `sender`, `transport` |
| Postausgang, Versandwelle | `outbox`, `wave` |
| Widerspruch, Sperre, Rückläufer | `optOut`, `suppression`, `bounce` |
| Lauf der Zeitsteuerung | `tick` |
| Aktivitätsprotokoll, Versandprotokoll | `auditLog`, `sendLog` |
| Ersteinrichtung | `setup` |
| Zuständige | `responsibles` |
| Firma, Geschlecht | `organization`, `gender` (`female` / `male` / `diverse` / `unspecified`) |
| Gruppe, Schlagwort, Zusatzfeld | `group`, `tag`, `customField` |
| Schutzstufe Basis / geschützt | `protection`: `base` / `protected` |
| Mitglieder-Bereich, Partner-Bereich | `membersArea`, `partnersArea` |
| Zuordnung (Import), Leerwert | `mapping`, `emptyMarker` |
