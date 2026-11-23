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
| 3 | Gestaltung und Rendering | Speicher-Schnittstelle (R2, Vercel Blob, S3), CD, Standard-Layout, Bausteinmodell, Rendering mit React Email, Platzhalter (inkl. Briefanrede und Maskierung), Barrierefreiheits-Prüfungen, Klick-Editor, Vorschau, Bildverarbeitung, HTML-Import | 6.5, 7 (Dateien) | 1, 2 |
| 4 | Versand | Absender, Versand-Schnittstelle, Anbindungen für Graph und Resend, Postausgang (Drosselung, Tageslimit, Vorrang, Wiederholung, Selbst-Anstoß), manueller Versand mit Testmail, Entfernen doppelter Adressen, Abmelden, Rückläufer, Warnung vor Secret-Ablauf, Systemmails über den echten Absender | 6.4, 6.6 | 1–3 |
| 5 | Automatische Anlässe | Datumsregeln, Geburtstage und Jubiläen, Vorschau-Mail, Warn-Mails, Idempotenz, Nachholen, Dashboard | 6.3, 6.10 | 1–4 |
| 6 | Rechnungen und Einladungen | PDF-Upload, XRechnung (UBL/CII) und ZUGFeRD, Empfängervorschlag, .ics | 6.4 | 1–4 |
| 7 | Datenschutz-Funktionen | Löschfristen, Auskunfts-Export, Inhalte der Doku-Vorlagen | 6.8 | 1–6 |
| 8 | Doku-Website und Release | Astro und Starlight im Monorepo; Anleitungen für Installation, Entra und Resend; Handbuch; Entwickler-Doku; Release-Ablauf mit Versionen und Änderungsprotokoll | 8 | 1–7 |

## Werkzeuge (gelten für alle Teilpläne)

- **Versionen:** immer die neueste stabile Version von Node (derzeit 26 LTS), pnpm, TypeScript, allen Abhängigkeiten und Docker-Images.
- **Sicherheit:** GitHub Actions per Commit-SHA und Container-Images per Digest gepinnt, Dependabot hält die Pins aktuell; CI mit minimalen Rechten; pnpm-Lieferkettenschutz. Sicherheit hat in allen Teilplänen hohe Priorität.
- **Vite+** (`vite-plus`, CLI `vp`) ist die einzige Toolchain: Dev, Build, Test, Lint, Format, Typprüfung und Task-Runner. Konfiguriert wird nur in `vite.config.ts`.
- **pnpm** mit `catalogMode: strict`. Alle Versionen stehen im Catalog in `pnpm-workspace.yaml`, die `package.json`-Dateien nutzen `"catalog:"`.
- **Lint und Format:** `@mheob/oxlint-config` und `@mheob/oxfmt-config`, eingebunden in die `lint`- und `fmt`-Blöcke von Vite+.
- **Commits:** `@mheob/commitlint-config` mit czg.
- **Git-Hooks:** über Vite+ in `.vite-hooks/`: `pre-commit` ruft `vp staged` auf, `commit-msg` ruft commitlint auf.
- **Teilplan 8 (Astro):** `vp dev` und `vp build` starten immer reines Vite. Die Doku-Website läuft deshalb über `vp run --filter docs dev` bzw. `vp run --filter docs build`.

Die Details stehen in Teilplan 1 unter „Global Constraints“ und „Task 1“.

## Offene Punkte für spätere Teilpläne

- **Sprache der Mails an Mitglieder und Partner:** Die Oberfläche ist zweisprachig. Ob Kontakte eine Sprache bekommen und Vorlagen Sprachvarianten haben, wird beim Schreiben von Teilplan 2 bzw. 3 geklärt.

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
