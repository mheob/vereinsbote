# Vereinsbote – Teilplan 2: Kontakte und Import – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mitglieder und Partner kommen in die App: Mitglieder-Import aus dem CSV- oder XLSX-Export der Mitgliederverwaltung (Zuordnung, Vorschau, Komplett-Ersetzen mit Sicherheitsabfrage), Partner-Import und Partnerpflege, Kontaktliste und Detailansicht mit Feldschutz je Bereich, Sperre und Widerspruch, die jeden Import überleben, und eine Warnung bei alten Daten.

**Architecture:**
- Die Importdatei wird im Browser gelesen (`read-excel-file`, `papaparse`, nachgeladen nur auf den Import-Seiten). An den Server gehen nur die zugeordneten Spalten, als gzip-komprimiertes JSON in **einer** Anfrage je Schritt (Vorschau, Bestätigen). Der Server prüft alles neu und ist maßgeblich; zwischen den Schritten speichert er nichts.
- Die Fachlogik liegt wie in Teilplan 1 in Modulen ohne Framework unter `apps/web/src/server/contacts/**`, getestet mit PGlite. Module, die auch der Browser nutzt (Felder, Kalender, Zuordnung, Nutzlast, Zeilenprüfung, Partnerformular), haben keine Server-Importe.
- Routen und Server-Funktionen sind dünne Hüllen. Der Rahmen jeder Seite (Root-Loader) liefert zusätzlich Navigation und Warnbanner.

**Tech Stack:** wie Teilplan 1, dazu `read-excel-file` (XLSX im Browser), `papaparse` (CSV im Browser), `write-excel-file` (nur Tests: erfundene XLSX-Dateien), Web-Standards `CompressionStream`/`DecompressionStream` (gzip in Browser, Node und Workers).

**Spec:** `docs/superpowers/specs/2026-11-24-vereinsbote-02-kontakte-design.md` (verbindlich; gilt vor der Master-Spec `docs/superpowers/specs/2026-11-23-vereinsbote-design.md`, Abschnitte 5, 6.2, 6.7)
**Fahrplan und Glossar:** `docs/superpowers/plans/2026-11-23-vereinsbote-00-fahrplan.md`
**Branch:** `feat/contacts` (existiert, enthält den Design-Commit)

## Global Constraints

- **Grundlage:** Alle Global Constraints von Teilplan 1 und alle Regeln aus `AGENTS.md` gelten unverändert. Für diesen Teilplan besonders: Vite+ (`vp`) als einzige Toolchain; pnpm-Catalog strikt (`"catalog:"`, `minimumReleaseAge: 1440`); neueste stabile Versionen; `@/`-Imports; alles, was Code ist, englisch (Glossar im Fahrplan: `contact`, `member`, `partner`, `memberNumber`, `customerNumber`, `organization`, `gender`, `group`, `tag`, `customField`, `protection`, `membersArea`, `partnersArea`, `mapping`, `emptyMarker`, `optOut`, `suppression`); sichtbare Texte nur in `de.ts`/`en.ts`; jede Route mit `pageHead`; Formulare mit `PostForm` und `SubmitButton`; Server-Funktionen mit zod, `requireRequestPrincipal` und Ablehnungen als Ergebnis; Server-Module nur in den Handlern importieren; WCAG 2.2 AA mit axe in E2E; TDD.
- **Rechte (Design 10):**
  - Kontaktliste und Basisfelder aller Kontakte: jeder mit mindestens `read` in irgendeinem Bereich.
  - Geschützte Felder: `read` in einem Bereich, dem das Feld **für diese Kontaktart** zugeordnet ist.
  - Mitglieder-Import, Sperre und Widerspruch an Mitgliedern: `edit` im Mitglieder-Bereich.
  - Partner-Import, Partner anlegen/bearbeiten/löschen, Schlagworte, Sperre und Widerspruch an Partnern: `edit` im Partner-Bereich.
  - Feldschutz, Mitglieder-/Partner-Bereich, Frist für alte Daten: Admin.
  - „Die Admin-Rolle allein gibt keinen Zugriff auf Kontakte (Spec 6.7).“
  - Jede Server-Funktion prüft selbst. „Geschützte Felder ohne Recht werden **nicht ausgeliefert**, nicht nur ausgeblendet; Suche und Filter über geschützte Felder gibt es nur für Benutzer, die das Feld sehen dürfen.“
- **Datenschutz (Design 13):**
  - „Keine Kontaktdaten in Logs, URLs oder Fehlermeldungen. Zeilennummern statt Werten in Server-Fehlern.“ Logs nur über `errorLabel`.
  - Suchbegriffe und Filterwerte gehen per POST, nie in die URL. In der URL der Kontaktliste steht nur die Kontaktart (`kind`).
  - „Die Importdatei verlässt den Browser nie; Beispielwerte in der Zuordnung entstehen nur im Browser.“ Nicht zugeordnete Spalten erreichen den Server nicht; nur ihre Spaltennamen gehen mit (für die gemerkte Zuordnung).
  - Aktivitätsprotokoll ohne Namen und Adressen: Nummern (`member:<nr>`, `partner:<nr>`) oder die interne ID (`contact:<uuid>`).
- **Testdaten:** „Testdaten sind immer erfunden. Die echten Exporte des Vereins kommen nie ins Repository, auch nicht gekürzt.“ Erfundene Adressen nutzen `example.org` bzw. `*.example`.
- **Plattform:** „Läuft gleich auf Node, Vercel und Cloudflare. Keine Bibliothek darf Node-Module voraussetzen, die im Browser oder auf Workers fehlen.“ Keine Bibliothek nutzt `eval` oder `new Function` (Teilplan 3 bringt eine CSP ohne `unsafe-eval`). `nodemailer` und `pg` bleiben aus dem Cloudflare-Bundle.
- **Grenzen:** „Ausgelegt wird für bis zu 10 000 Zeilen pro Import; größere Dateien werden mit einer klaren Meldung abgelehnt.“ Eine Anfrage bleibt unter Vercels Grenze von 4,5 MB.
- **Kalender:** Datumsfelder sind reine Kalenderdaten (`YYYY-MM-DD`, Postgres `date`). „Heute“ (Importtag, Austritt erreicht) ist der Kalendertag in `Europe/Berlin`, nie der des Servers (UTC) oder des Browsers.
- **Sonar-Abdeckung:** Neue Logik steht in reinen Modulen (`*.ts` unter `server/`, `components/`, `i18n/`) mit Unit-Tests. Routen, `components/**/*.tsx` und `functions/**` sind von der Abdeckung ausgenommen und werden per E2E geprüft.
- **Fertig heißt:** `vp check` meldet 0 Fehler und 0 Warnungen, `vp test` ist grün, die Postgres-Tests laufen mit `TEST_POSTGRES_URL` grün, und für Seiten und Abläufe ist `vp run --filter web e2e` grün. Jede neue Seite hat `pageHead` und einen axe-Check im E2E.
- **Commits:** GitButler, nie `git add`/`git commit`, nie `-s`. Jeder Task endet mit:

```bash
but commit -b feat/contacts -F - <die Dateien aus „Files“ dieses Tasks, inkl. erzeugter Migrationen> <<'EOF'
<type>(contacts): <beschreibung, höchstens 50 Zeichen, klein, ohne Punkt>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- **Release und Doku:** Ein `minor`-Changeset (`web`) und die Änderungen an `README.md`, `AGENTS.md` und `CONTRIBUTING.md` kommen in Task 14, im selben Pull Request.

## Entscheidungen dieses Plans

Was das Design dem Builder überlässt (Design 16), hier festgelegt:

1. **Transport der Zeilen:** eine Anfrage je Schritt. Der Browser schickt `FormData` mit dem Feld `payload` (gzip-komprimiertes JSON, `CompressionStream`). Grenzen: komprimiert 4 000 000 Byte, entpackt 16 MiB, 10 000 Zeilen. 10 000 typische Zeilen sind entpackt rund 2–3 MB, komprimiert einige hundert KB. Bestätigen schickt dieselbe Nutzlast noch einmal, der Server rechnet neu. So bleibt der Server zustandslos, nichts wird zwischen den Schritten gespeichert, und es klappt auf allen drei Plattformen.
2. **Schema:** eine Tabelle `contacts` für beide Arten. Gruppen und Schlagworte sind `text[]`, Zusatzfeldwerte `jsonb`. Die Spalte `contact_key` ist generiert (`nr:<Nummer>` bzw. `email:<Adresse>`) und verbindet Sperren und Widersprüche, die getrennt gespeichert sind.
3. **Zusatzfelder** gehören zu einer Kontaktart. Sie werden in Teilplan 2 nicht gelöscht.
4. **Feldschutz:** Zeilen in `protected_field_areas` überschreiben die Zuordnung eines Felds; ohne Zeilen gilt der Bereich der Kontaktart (Mitglieder- bzw. Partner-Bereich). So folgen Felder ohne eigene Zuordnung einem geänderten Mitglieder-Bereich.
5. **Bestandsstand:** `import_state.stock_version` je Kontaktart. Er steigt bei jedem bestätigten Import, jeder Sperre und jedem Widerspruch dieser Art und bei jeder Partnerpflege. Bestätigen sperrt die Zeile (`FOR UPDATE`) und vergleicht den Stand. So schließen sich zwei Importe aus.
6. **Sicherheitsabfrage:** nötig, wenn beim Ersetzen mehr als 20 % des Bestands gelöscht würden. Das umfasst die Regel des Designs (die Zahl sinkt um mehr als 20 %) und fängt zusätzlich eine falsche Datei gleicher Größe ab (Anti-Ziel 1). Beim Bestand 0 entfällt sie.
7. **Filter** wendet der Browser an: Zeilen außerhalb gehen nicht an den Server und gelten dort als fehlend. Die Filterregeln werden mit der Zuordnung gespeichert.
8. **Kontaktliste:** 50 je Seite, sortiert nach Firma, sonst Nachname, Vorname. Suche und Filter per POST, `kind` in der URL.
9. **Vorschau-Listen** (Änderungen, Feldfehler) sind auf je 1 000 Einträge begrenzt, dazu die Zahl der weiteren.
10. **Längen:** Nummern höchstens 50 Zeichen (sonst blockierend), Namen, Firma, Straße, Ort höchstens 200, PLZ 20, E-Mail 254, Gruppe 100, Zusatzfeld-Text 500 (sonst Feldfehler).
11. **Spaltenköpfe:** Ein leerer Kopf heißt `#<Spaltennummer>`, ein doppelter bekommt ` (2)`, ` (3)` …
12. **Partner** brauchen auch in der App einen Namen (Firma, Vor- oder Nachname) und eine Kundennummer oder E-Mail. Im Partner-Import wird eine Zeile ohne Kundennummer, deren E-Mail schon in einer früheren Zeile ohne Kundennummer stand, übersprungen (Zeilenfehler).
13. **Warn-Mail:** Der Tick-Schritt baut seinen Mailer aus `ctx.env` (`createSystemMailer`). Er beansprucht die Woche, bevor er sendet, schickt also höchstens eine Warnung pro Woche.
14. **Rahmen:** Der Root-Loader liefert Navigation und Hinweis (Banner, erster Import) einmal pro Dokument. Nach einem Import ruft die Seite `router.invalidate()` auf.
15. **E2E:** eigenes Playwright-Projekt `contacts` mit `dependencies: ['fundament']`. Die XLSX-Datei wird im Test mit `write-excel-file` gebaut, die CSV-Datei im Test als Windows-1252 kodiert. Es liegt keine Binärdatei im Repository.
16. **Instanzen, die vor diesem Teilplan eingerichtet wurden**, haben keine Mitglieder-/Partner-Bereiche gesetzt. Ein Admin wählt sie auf `/admin/contact-settings`; bis dahin hat niemand Import- oder Pflegerechte. Es gibt keine Datenmigration.

## Review Focus

1. **Importtag um Mitternacht:** Ein Import um 00:30 Uhr deutscher Zeit (22:30 UTC am Vortag) mit Austrittsdatum „heute“ behandelt das Mitglied als ausgetreten. Tests in Task 1 (`todayInClubZone`) und Task 6.
2. **Falsche Datei gleicher Größe:** Eine Datei mit ebenso vielen Zeilen, aber anderen Nummern (z. B. die falsche Spalte als Mitgliedsnummer), würde alle löschen. Die Sicherheitsabfrage muss kommen, obwohl die Zahl nicht sinkt. Test in Task 6.
3. **Excel-Werte und Zeitzone des Browsers:** `Nr.` als Excel-Zahl wird `100001`, nicht `100001.0`; ein Excel-Datum bleibt in jeder Browser-Zeitzone derselbe Tag. Tests in Task 5; das E2E läuft in Honolulu-Zeit und prüft das Datum in Task 12.
4. **Leere oder doppelte Spaltenköpfe:** Zwei Spalten „E-Mail“ oder eine Spalte ohne Kopf zerstören die Zuordnung nicht; jede Spalte bekommt einen eindeutigen, stabilen Namen. Test in Task 5.
5. **Suchbegriffe mit `%`, `_` oder `\`:** Sie werden wörtlich gesucht, nicht als Muster. Test in Task 2.

Die Dateien stehen im Block **Files** jedes Tasks; Tests liegen neben dem Code, E2E unter `apps/web/e2e`.

---

### Task 1: Kontaktmodell, Einstellungen und Feldschutz

**Files:**
- Create: `apps/web/src/server/db/schema/contacts.ts`, `apps/web/src/server/contacts/{fields,calendar,display-name,mailable,settings,import-state,testing}.ts`
- Modify: `apps/web/src/server/db/schema/index.ts` (`export * from './contacts'`), `apps/web/src/server/setup/setup.ts` (speichert die beiden Bereiche), `apps/web/src/server/audit/audit.ts` (`'contacts.settings_changed'`), Migration `apps/web/drizzle/0007_*.sql` und `drizzle/meta/*` (erzeugt)
- Test: `apps/web/src/server/contacts/{calendar,display-name,mailable,settings,import-state}.test.ts`, `apps/web/src/server/setup/setup.test.ts` (Ergänzung)

**Interfaces:**
- Consumes: `Db`, `createTestDb`, `Principal`, `assertAdmin`, `loadPrincipal`, `AccessLevel`, `writeAudit`, `completeSetup`, `insertUser`, `Locale` (Teilplan 1)
- Produces:

```ts
// server/contacts/fields.ts — ohne Server-Importe, der Browser nutzt es mit
export const CONTACT_KINDS = ['member', 'partner'] as const;  export type ContactKind = (typeof CONTACT_KINDS)[number]
export const GENDERS = ['female', 'male', 'diverse', 'unspecified'] as const;  export type Gender = (typeof GENDERS)[number]
export type ContactField = 'memberNumber' | 'customerNumber' | 'organization' | 'firstName' | 'lastName'
  | 'email' | 'gender' | 'birthDate' | 'entryDate' | 'exitDate' | 'street' | 'postalCode' | 'city'
export const CONTACT_FIELDS: Readonly<Record<ContactKind, readonly ContactField[]>>
  // member: alle außer customerNumber; partner: alle außer memberNumber, entryDate, exitDate
export type BuiltinProtectedField = 'birthDate' | 'entryDate' | 'exitDate' | 'address'
export const BUILTIN_PROTECTED_FIELDS: Readonly<Record<ContactKind, readonly BuiltinProtectedField[]>>  // partner: birthDate, address
export type FieldKey = BuiltinProtectedField | `custom:${string}`
export function customFieldKey(customFieldId: string): FieldKey
export function protectedFieldOf(field: ContactField): BuiltinProtectedField | null   // street/postalCode/city → 'address'
export const CUSTOM_FIELD_TYPES = ['text', 'date'] as const;  export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]
export const PROTECTIONS = ['base', 'protected'] as const;  export type Protection = (typeof PROTECTIONS)[number]
// server/contacts/calendar.ts — ohne Server-Importe
export const CLUB_TIME_ZONE = 'Europe/Berlin'
export function todayInClubZone(now: Date): string   // 'YYYY-MM-DD'
export type DateParseResult = { ok: true; value: string } | { ok: false; reason: 'invalidDate' | 'twoDigitYear' }
export function parseCalendarDate(input: string): DateParseResult   // 'TT.MM.JJJJ', 'T.M.JJJJ', 'JJJJ-MM-TT'
export function formatCalendarDate(value: string, locale: Locale): string   // Intl, dateStyle 'medium', timeZone 'UTC'
// server/contacts/display-name.ts — ohne Server-Importe
export interface NameParts { organization: string | null; firstName: string | null; lastName: string | null;
  email: string | null; memberNumber: string | null; customerNumber: string | null }
export interface DisplayName { primary: string; secondary: string | null }
export function displayName(c: Readonly<NameParts>): DisplayName
// server/contacts/mailable.ts
export function isMailable(c: Readonly<{ email: string | null; exitDate: string | null }>, suppressed: boolean, today: string): boolean
// server/db/schema/contacts.ts (zusätzlich zu den Tabellen)
export type ContactRecord = typeof contacts.$inferSelect
// server/contacts/settings.ts
export const DEFAULT_STALE_IMPORT_WEEKS = 8;  export const MAX_STALE_IMPORT_WEEKS = 52
export interface ContactSettings { membersAreaId: string | null; partnersAreaId: string | null; staleImportWeeks: number }
export function getContactSettings(db: Db): Promise<ContactSettings>   // ohne Zeile: null, null, 8
export function kindAreaId(settings: ContactSettings, kind: ContactKind): string | null
export function saveContactAreas(db: Db, ids: Readonly<{ membersAreaId: string; partnersAreaId: string }>): Promise<void>  // ohne Rechteprüfung (Setup)
export interface CustomFieldRecord { id: string; kind: ContactKind; name: string; type: CustomFieldType; protection: Protection }
export function listCustomFields(db: Db, kind: ContactKind): Promise<CustomFieldRecord[]>
export function getFieldAreas(db: Db, kind: ContactKind): Promise<ReadonlyMap<FieldKey, readonly string[]>>
  // jedes geschützte Feld der Art (eingebaut und geschützte Zusatzfelder) → wirksame Bereichs-IDs
export class FieldAreasEmptyError extends Error {}
export class StaleImportWeeksInvalidError extends Error {}
export function setContactAreas(db: Db, actor: Principal, ids: Readonly<{ membersAreaId: string; partnersAreaId: string }>): Promise<void>
export function setFieldAreas(db: Db, actor: Principal, input: Readonly<{ kind: ContactKind; fieldKey: FieldKey; areaIds: readonly string[] }>): Promise<void>
export function setCustomFieldProtection(db: Db, actor: Principal, input: Readonly<{ customFieldId: string; protection: Protection }>): Promise<void>
export function setStaleImportWeeks(db: Db, actor: Principal, weeks: number): Promise<void>
// server/contacts/import-state.ts
export interface ImportStateRecord { kind: ContactKind; stockVersion: number; lastConfirmedAt: Date | null; mapping: unknown }
export function getImportState(db: Db, kind: ContactKind): Promise<ImportStateRecord>    // ohne Zeile: Version 0
export function lockImportState(tx: Db, kind: ContactKind): Promise<ImportStateRecord>   // Zeile anlegen, falls nötig, dann FOR UPDATE
export function bumpStockVersion(tx: Db, kind: ContactKind): Promise<void>
export function recordConfirmedImport(tx: Db, kind: ContactKind, input: Readonly<{ at: Date; mapping: unknown }>): Promise<void>  // Version +1
// server/contacts/testing.ts (nur für Tests)
export function setUpClub(db: Db): Promise<{ admin: Principal; membersAreaId: string; partnersAreaId: string }>  // über completeSetup
export function userWith(db: Db, levels: Readonly<Record<string, AccessLevel>>, options?: { isAdmin?: boolean }): Promise<Principal>
export function insertContact(db: Db, values: Partial<typeof contacts.$inferInsert> & { kind: ContactKind }): Promise<string>
```

**Schema** (`server/db/schema/contacts.ts`; Zeitstempel `timestamptz`, Datumsfelder `date` mit `mode: 'string'`):
- **`contacts`:** `id uuid pk default gen_random_uuid()`, `kind text not null` (check), `member_number`, `customer_number`, `organization`, `first_name`, `last_name`, `email` (je `text`; E-Mail normalisiert), `gender text not null default 'unspecified'` (check), `groups text[] not null default '{}'`, `tags text[] not null default '{}'`, `birth_date`, `entry_date`, `exit_date date`, `street`, `postal_code`, `city text`, `custom_values jsonb not null default '{}'` (Zusatzfeld-ID → Wert), `created_at`, `updated_at`.
  - Checks: `(kind = 'member') = (member_number is not null)`; `kind = 'partner' or customer_number is null`; `kind = 'member' or customer_number is not null or email is not null`.
  - `contact_key text generated always as (case when kind = 'member' then 'nr:' || member_number when customer_number is not null then 'nr:' || customer_number else 'email:' || email end) stored`.
  - Unique-Index auf `member_number` where `kind = 'member'` und auf `customer_number` where `customer_number is not null`; Index auf `(kind, contact_key)`.
- **`custom_fields`:** `id uuid pk`, `kind`, `name`, `type` (check), `protection text not null default 'protected'` (check), `created_at`; Unique-Index auf `(kind, lower(name))`.
- **`protected_field_areas`:** `kind`, `field_key`, `area_id uuid references areas(id) on delete cascade`; Primärschlüssel `(kind, field_key, area_id)`.
- **`contact_settings`:** `id boolean pk default true check (id)`, `members_area_id` und `partners_area_id` (`uuid references areas(id) on delete restrict`, nullable), `stale_import_weeks integer not null default 8` (check 1–52).
- **`import_state`:** `kind text pk`, `stock_version integer not null default 0`, `last_confirmed_at timestamptz`, `mapping jsonb`.
- **`contact_suppressions`:** `kind`, `contact_key`, `created_by_user_id text references user(id) on delete set null`, `created_at`; Primärschlüssel `(kind, contact_key)`.
- **`contact_opt_outs`:** `id uuid pk`, `kind`, `contact_key`, `scope text not null` (check `area`/`occasion`), `area_id uuid references areas(id) on delete cascade`, `occasion_id uuid` (ohne Fremdschlüssel: die Tabelle der Anlässe kommt in Teilplan 4/5), `created_by_user_id`, `created_at`. Check: `scope = 'area'` genau dann, wenn `area_id is not null and occasion_id is null`. Unique-Index auf `(kind, contact_key, area_id)` where `scope = 'area'`.

**Regeln:**
- `getFieldAreas`: Für jedes Feld gelten seine Zeilen in `protected_field_areas`, sonst `[kindAreaId(...)]` (leer, solange der Bereich nicht gesetzt ist). Zusatzfelder mit `protection = 'base'` fehlen.
- `setFieldAreas`: leere `areaIds` → `FieldAreasEmptyError`; ersetzt die Zeilen des Felds dieser Art. Ein `fieldKey`, der kein geschütztes Feld der Art ist, wirft `Error`.
- Alle `set*`-Funktionen: `assertAdmin`, eine Transaktion, `writeAudit('contacts.settings_changed', details: { … })`, z. B. `{ kind, fieldKey, areaIds }`.
- `setStaleImportWeeks`: nur Ganzzahlen 1–52, sonst `StaleImportWeeksInvalidError`.
- `completeSetup` ruft in seiner Transaktion `saveContactAreas` mit „Mitglieder“ und „Finanzen“ auf.
- `displayName`: „Vorname Nachname“; mit Firma steht die Firma in `primary` und der Ansprechpartner in `secondary`; ohne Namen die E-Mail, sonst die Nummer.
- `isMailable`: false bei Sperre, ohne E-Mail oder wenn `exitDate <= today`.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// calendar.test.ts
it.each([['17.05.1980', '1980-05-17'], ['7.5.1980', '1980-05-07'], ['1980-05-17', '1980-05-17'], ['29.02.2024', '2024-02-29']])(
  'parses %s', (input, value) => expect(parseCalendarDate(input)).toEqual({ ok: true, value }))
it.each(['31.02.2020', '29.02.2023', '2020-13-01', '00.01.2020', 'gestern', '17.05.1980 10:00'])(
  'refuses %s', (input) => expect(parseCalendarDate(input)).toEqual({ ok: false, reason: 'invalidDate' }))
it('refuses two-digit years', () => expect(parseCalendarDate('17.05.80')).toEqual({ ok: false, reason: 'twoDigitYear' }))
it('takes today in Berlin, not in UTC', () => {   // Review Focus 1
  expect(todayInClubZone(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01')
  expect(todayInClubZone(new Date('2026-06-30T21:59:00Z'))).toBe('2026-06-30')
  expect(todayInClubZone(new Date('2026-06-30T22:00:00Z'))).toBe('2026-07-01')
})
it('formats without shifting the day', () => {
  expect(formatCalendarDate('1980-05-17', 'de')).toBe('17.05.1980'); expect(formatCalendarDate('1980-05-17', 'en')).toBe('May 17, 1980')
})

// display-name.test.ts — it.each, fehlende Teile null:
//   Anna Abel → { primary: 'Anna Abel', secondary: null }; Firma 'Bäckerei Körner GmbH' + Max Körner → { 'Bäckerei Körner GmbH', 'Max Körner' };
//   nur Firma 'Stadtwerke' → { 'Stadtwerke', null }; nur E-Mail und Kundennummer → die E-Mail; nur Mitgliedsnummer '42' → '42'
// mailable.test.ts — it.each mit today '2026-11-24': mit E-Mail ohne Austritt → true; Austritt '2026-11-25' → true;
//   Austritt '2026-11-24' → false; ohne E-Mail → false; gesperrt → false

// settings.test.ts
it('assigns protected fields to the area of their kind by default', async () => {
  const db = await createTestDb(); const { membersAreaId, partnersAreaId } = await setUpClub(db)
  expect(await getFieldAreas(db, 'member')).toEqual(new Map([['birthDate', [membersAreaId]], ['entryDate', [membersAreaId]],
    ['exitDate', [membersAreaId]], ['address', [membersAreaId]]]))
  expect((await getFieldAreas(db, 'partner')).get('birthDate')).toEqual([partnersAreaId])
})
it('overrides one field of one kind only', async () => { /* member/birthDate → [Mitglieder, Finanzen]; partner/birthDate bleibt [Finanzen] */ })
it('refuses to leave a protected field without an area', async () => { /* areaIds [] → FieldAreasEmptyError, Zuordnung unverändert */ })
it('lets fields without an override follow a new members area', async () => {
  // Bereich „Vorstand“ anlegen, setContactAreas(members → Vorstand) → member/exitDate [Vorstand]; überschriebenes birthDate bleibt
})
it('only admins change contact settings', async () => { /* userWith({ [membersAreaId]: 'edit' }) → jede set*-Funktion: ForbiddenError */ })
it('accepts stale import weeks from 1 to 52', async () => { /* 0, 53, 2.5 → StaleImportWeeksInvalidError; 12 → staleImportWeeks 12 */ })
it('switches a custom field between base and protected', async () => {
  // Zusatzfeld (member, 'Notiz', text) einfügen → getFieldAreas: `custom:<id>` → [membersAreaId];
  // setCustomFieldProtection('base') → fehlt in der Map; Protokoll 'contacts.settings_changed'
})

// import-state.test.ts
it('counts the stock version per kind and records a confirmed import', async () => {
  // Version 0; bumpStockVersion(member) 2× → 2; partner bleibt 0;
  // recordConfirmedImport(member, { at, mapping: { a: 1 } }) → Version 3, lastConfirmedAt at, mapping { a: 1 }
})

// setup.test.ts (Ergänzung)
it('stores Mitglieder and Finanzen as members and partners area', async () => {
  // completeSetup → getContactSettings() === { membersAreaId: <Mitglieder>, partnersAreaId: <Finanzen>, staleImportWeeks: 8 }
})
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/server/contacts apps/web/src/server/setup` meldet FAIL (Module fehlen).
- [ ] **Step 3: Umsetzen.** Schema, Module, Setup-Änderung; danach `vp run --filter web db:generate`. In der erzeugten Migration prüfen, dass generierte Spalte, Checks und Teil-Indizes stehen.
- [ ] **Step 4: Prüfen.** `vp test run apps/web/src/server/contacts apps/web/src/server/setup apps/web/src/server/db` meldet PASS (auch `bundled-migrations.test.ts`), `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(contacts): add contact model and settings`

---

### Task 2: Zugriff, Kontaktliste und Detailansicht (Server)

**Files:**
- Create: `apps/web/src/server/contacts/access.ts`, `apps/web/src/server/contacts/contacts.ts`
- Test: `apps/web/src/server/contacts/access.test.ts`, `apps/web/src/server/contacts/contacts.test.ts`

**Interfaces:**
- Consumes: Task 1 (`getContactSettings`, `kindAreaId`, `getFieldAreas`, `listCustomFields`, `displayName`, `todayInClubZone`, Schema, `testing.ts`); `canAccessArea`, `ForbiddenError`, `setAreaLevel`
- Produces:

```ts
// access.ts
export interface ContactAccess {
  readonly canList: boolean                                    // read in irgendeinem Bereich
  readonly canManage: Readonly<Record<ContactKind, boolean>>   // edit im Mitglieder- bzw. Partner-Bereich
  readonly visible: Readonly<Record<ContactKind, ReadonlySet<FieldKey>>>   // sichtbare geschützte Felder und alle Basis-Zusatzfelder
}
export function loadContactAccess(db: Db, principal: Principal): Promise<ContactAccess>
export function assertCanList(access: ContactAccess): void                       // ForbiddenError
export function assertCanManage(access: ContactAccess, kind: ContactKind): void  // ForbiddenError
// contacts.ts
export const CONTACTS_PAGE_SIZE = 50;  export const MAX_SEARCH_LENGTH = 100
export interface ContactFilters { group?: string; tag?: string; withoutEmail?: boolean; suppressed?: boolean; exit?: 'reached' | 'planned' }
export interface ContactListQuery { kind: ContactKind; page: number; query: string; filters: ContactFilters }   // page ab 1
export interface ContactListItem { id: string; number: string | null; name: DisplayName; email: string | null;
  groups: string[]; tags: string[]; suppressed: boolean }
export interface ContactListPage { items: ContactListItem[]; total: number; page: number;
  groups: string[]; tags: string[]; canFilterExit: boolean }   // groups/tags: alle Werte der Art, für die Filter
export function listContacts(db: Db, principal: Principal, query: Readonly<ContactListQuery>, now: Date): Promise<ContactListPage>
export type ProtectedValueField = 'birthDate' | 'entryDate' | 'exitDate' | 'street' | 'postalCode' | 'city'
export interface ContactDetail {
  id: string; kind: ContactKind; memberNumber: string | null; customerNumber: string | null; organization: string | null
  firstName: string | null; lastName: string | null; email: string | null; gender: Gender; groups: string[]; tags: string[]; name: DisplayName
  protectedValues: Partial<Record<ProtectedValueField, string>>   // nur sichtbare und gesetzte
  customValues: Array<{ id: string; name: string; type: CustomFieldType; value: string }>   // nur sichtbare und gesetzte
  suppression: { at: string } | null
  optOuts: Array<{ areaId: string; areaName: string; at: string }>
  canManage: boolean
  areas: Array<{ id: string; name: string }>   // alle Bereiche nach Name, nur mit canManage, sonst []
}
export function getContact(db: Db, principal: Principal, contactId: string): Promise<ContactDetail | null>
```

**Regeln:**
- `listContacts` und `getContact` rufen `assertCanList`; `getContact` liefert `null` für eine unbekannte ID.
- Geschützte Werte werden schon in der Abfrage weggelassen oder vor der Rückgabe aus dem Objekt entfernt, nie nur in der Oberfläche versteckt.
- Suche (getrimmt, auf 100 Zeichen gekürzt): `ILIKE` mit maskiertem `\`, `%`, `_` über Vorname, Nachname, „Vorname Nachname“, Firma, E-Mail, Mitglieds- und Kundennummer.
- Filter:
  - `group` (Mitglieder), `tag` (Partner, ohne Groß-/Kleinschreibung), `withoutEmail`, `suppressed` (über `contact_key`).
  - `exit` nur für Mitglieder: `reached` heißt `exit_date <= heute`, `planned` heißt `exit_date > heute` (heute = `todayInClubZone(now)`).
  - `exit` ohne Sicht auf `exitDate` → `ForbiddenError`; `canFilterExit` sagt der Seite, ob sie ihn anbietet.
- Sortierung: `lower(coalesce(organization, last_name, first_name, email, member_number, customer_number))`, `lower(first_name)`, `id`.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// access.test.ts
it('gives the admin role alone no access', async () => {
  const db = await createTestDb(); const { admin, membersAreaId } = await setUpClub(db)
  await setAreaLevel(db, admin, { areaId: membersAreaId, level: null, userId: admin.userId })   // das Setup gab edit
  expect(await loadContactAccess(db, (await loadPrincipal(db, admin.userId))!))
    .toMatchObject({ canList: false, canManage: { member: false, partner: false } })
})
it('lets edit in the kind area manage that kind only', async () => {
  // userWith({ [partnersAreaId]: 'edit' }) → canList true, canManage { member: false, partner: true },
  // visible.partner = {'birthDate', 'address'}, visible.member leer
})
it('shows a field assigned to a further area to readers of that area', async () => { /* member/birthDate → [Mitglieder, Finanzen] */ })
it('always shows base custom fields', async () => { /* Zusatzfeld protection 'base' → in visible.member jedes Lesers */ })

// contacts.test.ts
it('delivers protected member fields only with read in the members area', async () => {
  const db = await createTestDb(); const { membersAreaId, partnersAreaId } = await setUpClub(db)
  const id = await insertContact(db, { kind: 'member', memberNumber: '7', firstName: 'Anna', lastName: 'Abel',
    birthDate: '1980-05-17', exitDate: '2030-01-01', street: 'Lindenweg 3' })
  const seen = (await getContact(db, await userWith(db, { [partnersAreaId]: 'read' }), id))!
  expect(seen.protectedValues).toEqual({})
  expect(JSON.stringify(seen)).not.toMatch(/1980-05-17|2030-01-01|Lindenweg/u)
  expect((await getContact(db, await userWith(db, { [membersAreaId]: 'read' }), id))!.protectedValues)
    .toEqual({ birthDate: '1980-05-17', exitDate: '2030-01-01', street: 'Lindenweg 3' })
})
it('protects partner fields by the partner area', async () => { /* Mitglieder-Leser sieht Partner-Geburtsdatum nicht, Finanzen-Leser schon */ })
it('hides protected custom values and shows base ones', async () => { /* … */ })
it('searches name, organization, email and number ignoring case', async () => {
  // 'abel', 'körner' (Firma), 'EXAMPLE.ORG', '100001' (Kundennummer), 'anna abel' finden jeweils den passenden Kontakt
})
it('searches %, _ and backslash literally', async () => {   // Review Focus 5
  // Kundennummern '10_0' und '100' → query '10_' findet nur '10_0'; query '%' und query 'a\' finden nichts
})
it('refuses the exit filter without access to the exit date', async () => {
  // Finanzen-Leser: filters { exit: 'reached' } → ForbiddenError; ohne Filter canFilterExit false
})
it('filters by group, missing email, suppression and exit', async () => {
  // Gruppe 'Fußball' / keine; E-Mail null; Zeile in contact_suppressions; Austritt gestern / morgen (now fest)
})
it('pages by 50 sorted by organization or last name', async () => { /* 51 Mitglieder → Seite 1: 50, Seite 2: 1, total 51 */ })
it('shows suppression and opt-outs, and all areas only to managers', async () => { /* Leser: areas []; Mitglieder-edit: alle Bereiche */ })
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: `access.ts` und `contacts.ts` umsetzen.**
- [ ] **Step 4: Prüfen.** `vp test run apps/web/src/server/contacts` meldet PASS, `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(contacts): list and show contacts by access`

---

### Task 3: Sperre und Widerspruch (Server)

**Files:**
- Create: `apps/web/src/server/contacts/blocks.ts`
- Modify: `apps/web/src/server/audit/audit.ts` (`'contact.suppressed' | 'contact.unsuppressed' | 'contact.opted_out' | 'contact.opt_out_removed'`)
- Test: `apps/web/src/server/contacts/blocks.test.ts`

**Interfaces:**
- Consumes: `loadContactAccess`, `assertCanManage`, `listContacts`, `getContact` (Task 2); `bumpStockVersion` (Task 1); `writeAudit`
- Produces:

```ts
export function contactKey(c: Readonly<{ kind: ContactKind; memberNumber: string | null; customerNumber: string | null; email: string | null }>): string | null
  // 'nr:<Nummer>' bzw. 'email:<Adresse>', gleich der generierten Spalte; null ohne Schlüssel
export function auditTarget(c: Readonly<{ id: string; kind: ContactKind; memberNumber: string | null; customerNumber: string | null }>): string
  // 'member:<nr>' | 'partner:<nr>' | 'contact:<id>'
export function setSuppression(db: Db, principal: Principal, contactId: string, suppressed: boolean): Promise<void>
export function setOptOut(db: Db, principal: Principal, input: Readonly<{ contactId: string; areaId: string; optedOut: boolean }>): Promise<void>
export function rekeyBlocks(tx: Db, kind: ContactKind, from: string, to: string): Promise<void>   // verschiebt Sperre und Widersprüche
```

**Regeln:**
- Recht: `assertCanManage` für die Art des Kontakts. Unbekannter Kontakt → `Error`.
- Setzen ist idempotent (`on conflict do nothing`). Nur eine echte Änderung schreibt das Protokoll (`target: auditTarget(...)`, beim Widerspruch `details: { areaId }`) und erhöht `stock_version` der Art.
- `rekeyBlocks` übernimmt beim Ziel schon vorhandene Einträge, ohne zu duplizieren.

- [ ] **Step 1: Failing Tests schreiben**

```ts
it('agrees with the generated contact_key', async () => {
  // Mitglied 42, Partner 100001, Partner nur mit E-Mail → select contact_key gleich contactKey(...):
  // 'nr:42', 'nr:100001', 'email:info@example.org'
})
it('lets only edit in the members area suppress a member', async () => { /* read Mitglieder / edit Finanzen → ForbiddenError */ })
it('keeps a suppression when the member is deleted and applies it on return', async () => {
  // setSuppression(id, true); Zeile löschen; Mitglied 42 neu einfügen → listContacts(filters { suppressed: true }) findet es
})
it('keys a partner without customer number by email', async () => { /* contact_suppressions.contact_key === 'email:info@example.org' */ })
it('records opt-outs per area and drops them with their area', async () => {
  // Bereich „Jugend“ anlegen, Widerspruch für „Jugend“ → getContact().optOuts [{ areaName: 'Jugend' }];
  // „Jugend“ aus areas löschen → optOuts []
})
it('bumps the stock version of the kind only on a real change', async () => {
  // setSuppression true 2× → member +1; false → +1; partner unverändert
})
it('names the number in the audit log, never the address', async () => { /* Partner nur mit E-Mail → target 'contact:<id>', kein '@' */ })
it('rekeys suppression and opt-outs', async () => { /* rekeyBlocks(partner, 'email:x@example.org', 'nr:100009') */ })
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: `blocks.ts` umsetzen.**
- [ ] **Step 4: Prüfen.** `vp test run apps/web/src/server/contacts` meldet PASS, `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(contacts): add suppressions and opt-outs`

---

### Task 4: Import-Kern: Werte, Zuordnung, Nutzlast, Zeilenprüfung

Reine Module ohne Server-Importe: Der Browser nutzt sie für Vorschläge, Vorprüfung und Kodierung, der Server für die maßgebliche Prüfung.

**Files:**
- Create: `apps/web/src/server/contacts/import/{values,mapping,payload,rows,testing}.ts`
- Test: `apps/web/src/server/contacts/import/{values,mapping,payload,rows}.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ContactKind`, `ContactField`, `CONTACT_FIELDS`, `Gender`, `CustomFieldType`, `CustomFieldRecord`, `parseCalendarDate`); `normalizeEmail`
- Produces:

```ts
// values.ts
export const DEFAULT_EMPTY_MARKERS = ['', '-'] as const;  export const DEFAULT_GROUP_SEPARATORS = [',', ';'] as const
export const MAX_LENGTH: Readonly<Record<'number' | 'name' | 'postalCode' | 'email' | 'group' | 'customText', number>>  // 50, 200, 20, 254, 100, 500
export function cleanText(raw: string | null): string   // Steuerzeichen entfernen, trimmen
export function isEmptyValue(cleaned: string, markers: readonly string[]): boolean
export function splitGroups(cleaned: string, separators: readonly string[], markers: readonly string[]): string[]  // trimmen, Leere/Marker weg, ohne Groß-/Kleinschreibung entdoppelt
export function suggestGender(cleaned: string): Gender | null   // weiblich/w/female, männlich/m/male, divers/d, keine Angabe; sonst null
export function isValidContactEmail(cleaned: string): boolean
// mapping.ts
export type MappedTarget = { type: 'field'; field: ContactField } | { type: 'groups' }
  | { type: 'customField'; customFieldId: string } | { type: 'newCustomField'; name: string; valueType: CustomFieldType }
export type ColumnTarget = MappedTarget | { type: 'discard' }
export interface FilterRule { column: string; operator: 'is' | 'isNot'; value: string }
export interface ImportOptions { emptyMarkers: string[]; groupSeparators: string[];
  genderValues: Record<string, Gender>; organizationFromLastName: boolean }   // genderValues: bereinigter Wert → Geschlecht
export const DEFAULT_IMPORT_OPTIONS: ImportOptions
export interface SavedMapping { columns: Record<string, ColumnTarget>; filters: FilterRule[]; options: ImportOptions }
export const savedMappingSchema: z.ZodType<SavedMapping>
export function suggestTarget(header: string, kind: ContactKind): ColumnTarget
export function suggestMapping(headers: readonly string[], kind: ContactKind, saved: SavedMapping | null,
  customFields: readonly CustomFieldRecord[]): Record<string, ColumnTarget>
export function mappingChanges(headers: readonly string[], saved: SavedMapping): { missing: string[]; added: string[] }
export function rowPassesFilters(row: Readonly<Record<string, string | null>>, filters: readonly FilterRule[], markers: readonly string[]): boolean
// payload.ts
export const MAX_IMPORT_ROWS = 10_000;  export const MAX_COMPRESSED_PAYLOAD_BYTES = 4_000_000;  export const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024
export interface ImportPayload {
  kind: ContactKind
  columns: Array<{ header: string; target: MappedTarget }>
  discardedHeaders: string[]
  filters: FilterRule[]
  options: ImportOptions
  rows: Array<{ line: number; cells: Array<string | null> }>   // cells in der Reihenfolge von columns; line = Zeile in der Datei
}
export const importPayloadSchema: z.ZodType<ImportPayload>
export class ImportPayloadError extends Error { readonly reason: 'tooLarge' | 'invalid' }
export function encodeImportPayload(payload: ImportPayload): Promise<Blob>   // JSON → gzip
export function decodeImportPayload(blob: Blob): Promise<ImportPayload>     // Größen prüfen, entpacken, zod
export function toSavedMapping(payload: ImportPayload): SavedMapping
// rows.ts
export type BlankKey = ContactField | `custom:${string}`
export interface ImportedRow {
  line: number
  values: Partial<Record<ContactField, string | null>>   // gültige Werte; null = ausdrücklich leeren (Firmenregel); fehlt = nicht zugeordnet, leer oder Feldfehler
  groups: string[] | null                                // null: keine Gruppen-Spalte zugeordnet
  custom: Record<string, string>                         // customFieldId bzw. 'new:<Name>' → Wert
  blank: BlankKey[]                                      // zugeordnet, aber leer oder Feldfehler
}
export type FieldIssueReason = 'invalidEmail' | 'invalidDate' | 'twoDigitYear' | 'unknownGender' | 'tooLong'
export interface FieldIssue { line: number; column: string; reason: FieldIssueReason }
export type BlockingIssue =
  | { reason: 'tooManyRows'; count: number }
  | { reason: 'keyNotMapped' }                          // Mitglieder: Mitgliedsnummer; Partner: weder Kundennummer noch E-Mail
  | { reason: 'fieldMappedTwice'; field: ContactField }
  | { reason: 'customFieldInvalid'; column: string }    // Name leer, über 60 Zeichen, vergeben oder doppelt
  | { reason: 'memberNumberMissing' | 'numberTooLong' | 'partnerKeyMissing'; line: number }
  | { reason: 'numberDuplicate'; line: number; firstLine: number }
export interface TransformResult { rows: ImportedRow[]; fieldIssues: FieldIssue[]; blocking: BlockingIssue[] }
export function transformRows(payload: ImportPayload, customFields: readonly CustomFieldRecord[]): TransformResult
// testing.ts (nur für Tests, auch von Task 6 und 8 genutzt) — line = Index + 2, Geschlecht über weiblich/männlich/keine Angabe
export function memberPayload(rows: readonly (readonly string[])[], options?: Partial<ImportOptions>): ImportPayload
  // Spalten: Nr., Vorname, Nachname, E-Mail, Geburtstag, Mitglied bis, Abteilungen, Status, Geschlecht
export function partnerPayload(rows: readonly (readonly string[])[], options?: Partial<ImportOptions>): ImportPayload
  // Spalten: Nr., Nachname, Vorname, E-Mail, Geschlecht
```

**Regeln:**
- **`suggestTarget`** (Kopf getrimmt, ohne Groß-/Kleinschreibung, ohne Punkt am Ende; sonst `discard`):
  - Beide Arten: `Nr` → `memberNumber` (Partner: `customerNumber`), `Mitgliedsnummer`, `Kundennummer`, `Vorname`, `Nachname`, `E-Mail`/`Email`/`E-Mail-Adresse`, `Firma` → `organization`, `Geschlecht`, `Geburtstag`/`Geburtsdatum`, `Straße`/`Strasse`, `PLZ`, `Ort`.
  - Nur Mitglieder: `Mitglied seit`/`Eintritt`/`Eintrittsdatum` → `entryDate`; `Mitglied bis`/`Austritt`/`Austritt am`/`Austrittsdatum` → `exitDate`; `Abteilungen`/`Gruppen`/`Status` → `groups`.
- **`suggestMapping`** nimmt zuerst die gespeicherte Zuordnung, ein gespeichertes Zusatzfeld nur, wenn es noch existiert. **`rowPassesFilters`:** Alle Regeln müssen zutreffen; Leerwerte gelten als `''`.
- **`decodeImportPayload`:**
  - `blob.size > MAX_COMPRESSED_PAYLOAD_BYTES` → `tooLarge`, ohne zu entpacken.
  - Beim Entpacken mitzählen und bei mehr als `MAX_PAYLOAD_BYTES` abbrechen → `tooLarge`.
  - Kein gzip, kein JSON oder ein Schemafehler → `invalid`. Das Schema verlangt Ziele der Art (`CONTACT_FIELDS[kind]`, Gruppen nur bei Mitgliedern) und je Zeile so viele Zellen wie Spalten.
- **`transformRows`:**
  - Mehr als 10 000 Zeilen → nur `tooManyRows`.
  - Jede Zelle `cleanText`; ein Leerwert kommt nach `blank`.
  - Nummern über 50 Zeichen → blockierend; die zweite gleiche Nummer → `numberDuplicate`.
  - E-Mail über `normalizeEmail`; Datum über `parseCalendarDate`.
  - Geschlecht nur über `options.genderValues`; ein unbekannter Wert ist ein Feldfehler, der Wert fehlt dann.
  - Gruppen aus allen Gruppen-Spalten vereinigt.
  - Längen nach Entscheidung 10, sonst Feldfehler `tooLong`.
  - Partner ohne Kundennummer und ohne gültige E-Mail → `partnerKeyMissing`.
  - Firmenregel (nur Partner, `organizationFromLastName`): Ist der Vorname leer, wird `organization` = Nachname und `lastName` = `null`.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// values.test.ts
it('strips control characters and trims', () => expect(cleanText(' 0042\u0007\t')).toBe('0042'))
it('splits groups at comma and semicolon', () =>
  expect(splitGroups('Fußball, Danceaerobic;fußball; -', [',', ';'], ['', '-'])).toEqual(['Fußball', 'Danceaerobic']))
it.each([['weiblich', 'female'], ['männlich', 'male'], ['divers', 'diverse'], ['keine Angabe', 'unspecified'], ['Herr', null]])(
  'suggestGender(%s) is %s', (v, g) => expect(suggestGender(v)).toBe(g))

// mapping.test.ts — field(f) = { type: 'field', field: f }
const EXPORT = ['Nr.', 'Vorname', 'Nachname', 'Geburtstag', 'E-Mail', 'Typ', 'Status', 'Mitglied seit', 'Mitglied bis', 'Abteilungen', 'Geschlecht']
it('suggests the targets of the member export', () => expect(suggestMapping(EXPORT, 'member', null, [])).toEqual({
  'Nr.': field('memberNumber'), Vorname: field('firstName'), Nachname: field('lastName'), Geburtstag: field('birthDate'),
  'E-Mail': field('email'), Typ: { type: 'discard' }, Status: { type: 'groups' }, 'Mitglied seit': field('entryDate'),
  'Mitglied bis': field('exitDate'), Abteilungen: { type: 'groups' }, Geschlecht: field('gender') }))
it('suggests the customer number for Nr. in a partner export', () => expect(suggestTarget('Nr.', 'partner')).toEqual(field('customerNumber')))
it('prefers the saved mapping and reports missing and new columns', () => {
  // saved { 'Nr.': memberNumber, Nachname: discard, Notiz: groups } → suggestMapping(['Nr.', 'Nachname', 'Ort'], …).Nachname ist discard
  expect(mappingChanges(['Nr.', 'Nachname', 'Ort'], saved)).toEqual({ missing: ['Notiz'], added: ['Ort'] })
})
it('drops a saved custom field that no longer exists', () => { /* → Vorschlag aus dem Kopf */ })
it('keeps rows that match all filter rules', () => {
  const rules = [{ column: 'Status', operator: 'is', value: 'Aktiv' }, { column: 'Typ', operator: 'isNot', value: 'Kontakt' }]
  expect(rowPassesFilters({ Status: 'Aktiv', Typ: 'Mitglied' }, rules, ['', '-'])).toBe(true)
  expect(rowPassesFilters({ Status: 'Passiv', Typ: 'Mitglied' }, rules, ['', '-'])).toBe(false)
  expect(rowPassesFilters({ Status: '-' }, [{ column: 'Status', operator: 'is', value: '' }], ['', '-'])).toBe(true)
})

// payload.test.ts
it('round-trips a payload through gzip', async () => expect(await decodeImportPayload(await encodeImportPayload(p))).toEqual(p))
it('refuses a compressed payload above 4 000 000 bytes without unpacking', async () =>
  expect(decodeImportPayload(new Blob([new Uint8Array(4_000_001)]))).rejects.toMatchObject({ reason: 'tooLarge' }))
it('stops unpacking above 16 MiB', async () => {
  const bomb = await new Response(new Blob([new Uint8Array(17 * 1024 * 1024)]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
  await expect(decodeImportPayload(bomb)).rejects.toMatchObject({ reason: 'tooLarge' })
})
it.each(['not gzip', 'memberNumber target in a partner payload', 'fewer cells than columns'])('refuses %s as invalid', async () => {
  /* → reason 'invalid' */ })

// rows.test.ts
it('maps a row of the member export', () => {
  const { rows, fieldIssues, blocking } = transformRows(memberPayload([['42', 'Anna', 'Abel', 'anna.abel@example.org',
    '1980-05-17', '', 'Fußball, Danceaerobic', 'Aktiv', 'weiblich']]), [])
  expect(blocking).toEqual([]); expect(fieldIssues).toEqual([])
  expect(rows[0]).toEqual({ line: 2, values: { memberNumber: '42', firstName: 'Anna', lastName: 'Abel', email: 'anna.abel@example.org',
    birthDate: '1980-05-17', gender: 'female' }, groups: ['Fußball', 'Danceaerobic', 'Aktiv'], custom: {}, blank: ['exitDate'] })
})
it('treats "-" as empty and keeps leading zeros', () => { /* E-Mail '-' → blank enthält 'email'; Nr. '0042' bleibt '0042' */ })
it('warns about invalid email, impossible dates, two-digit years and unknown gender', () => {
  // 'anna@', '31.02.1980', '17.05.80', 'Herr' → fieldIssues mit line, column und reason; die Werte fehlen in values und stehen in blank
})
it('blocks a missing member number', () => { /* Zeile 3 ohne Nr. → { reason: 'memberNumberMissing', line: 3 } */ })
it('blocks duplicate member numbers after trimming', () => { /* '42' und ' 42' → { reason: 'numberDuplicate', line: 3, firstLine: 2 } */ })
it('blocks more than 10 000 rows', () => { /* 10 001 Zeilen → [{ reason: 'tooManyRows', count: 10001 }] */ })
it('blocks a member import without member number column', () => { /* → keyNotMapped */ })
it('blocks a partner row without customer number and email', () => { /* → partnerKeyMissing */ })
it('moves the last name into the organization when the first name is empty', () => {
  // partnerPayload, organizationFromLastName true, Vorname '-', Nachname 'Bäckerei Körner GmbH'
  // → values { organization: 'Bäckerei Körner GmbH', lastName: null }
})
it('validates date custom fields and blocks a taken custom field name', () => { /* … */ })
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Die Module umsetzen.**
- [ ] **Step 4: Prüfen.** `vp test run apps/web/src/server/contacts/import` meldet PASS, `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(contacts): add import mapping and row checks`

---

### Task 5: Importdatei im Browser lesen

**Files:**
- Modify: `pnpm-workspace.yaml` (Catalog: `read-excel-file`, `papaparse`, `@types/papaparse`, `write-excel-file`), `apps/web/package.json` (`dependencies`: `read-excel-file`, `papaparse`; `devDependencies`: `@types/papaparse`, `write-excel-file`), `pnpm-lock.yaml`
- Create: `apps/web/src/components/contacts/import/read-sheet.ts`
- Test: `apps/web/src/components/contacts/import/read-sheet.test.ts`

**Interfaces:**
- Produces:

```ts
export interface SheetRow { line: number; cells: Array<string | null> }   // line: Zeilennummer in der Datei, ab 1
export interface Sheet { headers: string[]; rows: SheetRow[] }            // headers eindeutig
export type ReadSheetResult =
  | { ok: true; sheetNames: string[]; sheetName: string | null; sheet: Sheet }   // sheetNames leer bei CSV
  | { ok: false; failure: 'unsupportedType' | 'unreadable' | 'empty' }
export function readSheetFile(file: File, sheetName?: string): Promise<ReadSheetResult>   // nach Endung .csv/.xlsx; Bibliotheken per import() in der Funktion
export function decodeCsvBytes(bytes: Uint8Array): string    // BOM oder gültiges UTF-8 → UTF-8, sonst windows-1252
export function normalizeCell(cell: unknown): string | null  // Date → 'YYYY-MM-DD' aus den UTC-Teilen; Zahl → String(n); '' → null
export function toSheet(grid: readonly (readonly unknown[])[]): Sheet | null   // erste nicht leere Zeile = Kopf; null ohne Kopf
```

- [ ] **Step 1: Bibliotheken prüfen, bevor sie aufgenommen werden.**
  - **Version:** `pnpm view <paket> version time --json` für `read-excel-file`, `papaparse`, `@types/papaparse`, `write-excel-file`. Es gilt die neueste stabile Version, und sie ist älter als 24 Stunden (`minimumReleaseAge: 1440`). Stand der Planung, alle MIT: `read-excel-file` 9.3.20 (2026-11-19), `papaparse` 5.7.1 (2026-11-11), `@types/papaparse` 5.5.2, `write-excel-file` 4.1.1. Dann Catalog-Einträge anlegen und `pnpm install`.
  - **Browser-tauglich:** Der genutzte Einstieg (`read-excel-file/universal`, sonst `/browser`) und `papaparse` importieren samt Abhängigkeiten (`fflate`, `saxen` …) keine Node-Module: `grep -rnE "from ['\"](node:)?(fs|path|stream|zlib|buffer|crypto|events|util)['\"]|require\(['\"](node:)?(fs|path|stream|zlib)" node_modules/<paket>/<einstieg>` findet nichts, `build:node` und `build:cloudflare` warnen nicht.
  - **Kein `eval`:** `grep -rnE "\beval\(|new Function\(" <dieselben Dateien>` findet nichts; der Einstieg startet keinen Worker aus `blob:`. Er läuft auch unter Vitest (Node), damit `read-sheet.test.ts` genau ihn prüft.
  - **Fällt eine Bibliothek durch:** eine gleichwertige wählen (MIT, gepflegt, Browser ohne Node-Module, kein `eval`) und die Wahl im Catalog-Kommentar begründen.
  - Danach `pnpm check:catalog`, `pnpm check:vite-plus` und `pnpm cve`.
- [ ] **Step 2: Failing Tests schreiben**

```ts
it('decodes UTF-8 with and without BOM and falls back to Windows-1252', () => {
  expect(decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Müller')]))).toBe('Müller')
  expect(decodeCsvBytes(utf8('Müller'))).toBe('Müller')
  expect(decodeCsvBytes(Uint8Array.from(Buffer.from('Müller;Straße', 'latin1')))).toBe('Müller;Straße')
})
it.each([';', ',', '\t'])('detects the delimiter %j', async (d) =>
  expect(await readSheetFile(new File([`Nr.${d}Name\r\n1${d}Anna\r\n`], 'export.csv')))
    .toMatchObject({ ok: true, sheet: { headers: ['Nr.', 'Name'], rows: [{ line: 2, cells: ['1', 'Anna'] }] } }))
it('honours RFC 4180 quotes', async () => { /* '"Abel; Anna";"Er sagte ""Hallo"""' → ['Abel; Anna', 'Er sagte "Hallo"'] */ })
it('names empty and duplicate headers uniquely', () =>   // Review Focus 4
  expect(toSheet([[], ['Nr.', '', 'E-Mail', 'E-Mail', 'E-Mail']])?.headers).toEqual(['Nr.', '#2', 'E-Mail', 'E-Mail (2)', 'E-Mail (3)']))
it('skips empty rows and keeps file line numbers', () => expect(toSheet([['Nr.'], [], ['7']])?.rows).toEqual([{ line: 3, cells: ['7'] }]))
it('reads Excel numbers and dates', async () => {   // Review Focus 3
  // write-excel-file (Node-Einstieg, als Buffer): Kopf ['Nr.', 'Geburtstag'],
  // Zeile [{ type: Number, value: 100001 }, { type: Date, value: new Date(Date.UTC(1980, 4, 17)), format: 'dd.mm.yyyy' }]
  expect(await readSheetFile(new File([buffer], 'export.xlsx'))).toMatchObject({ ok: true, sheet: { rows: [{ line: 2, cells: ['100001', '1980-05-17'] }] } })
})
it('keeps the day of a date in any time zone', () => {   // Review Focus 3
  for (const tz of ['Pacific/Honolulu', 'Pacific/Kiritimati']) {
    process.env.TZ = tz; expect(normalizeCell(new Date(Date.UTC(1980, 4, 17)))).toBe('1980-05-17')
  }
})
it('lists the sheets of a workbook and reads the chosen one', async () => { /* zwei Blätter → sheetNames, gewähltes sheetName */ })
it('refuses other types, broken and empty files', async () => {
  // 'x.xls' → unsupportedType; kaputte Bytes als 'x.xlsx' → unreadable; '' als 'x.csv' → empty
})
```

- [ ] **Step 3: Tests laufen lassen.** FAIL.
- [ ] **Step 4: `read-sheet.ts` umsetzen.** CSV: `decodeCsvBytes`, dann `papaparse` mit `delimitersToGuess: [';', ',', '\t']` ohne Kopfzeilen-Modus. XLSX: Blattnamen lesen, das gewählte (sonst erste) Blatt lesen. Beides über `toSheet`/`normalizeCell`.
- [ ] **Step 5: Prüfen.** `vp test run apps/web/src/components/contacts/import` meldet PASS, `vp check` 0/0, `vp run --filter web build:cloudflare` ohne Warnung zu Node-Modulen.
- [ ] **Step 6: Commit** – `feat(contacts): read import files in the browser`

---

### Task 6: Mitglieder-Import (Server)

**Files:**
- Create: `apps/web/src/server/contacts/import/plan.ts`, `apps/web/src/server/contacts/import/members.ts`
- Modify: `apps/web/src/server/audit/audit.ts` (`'import.members'`)
- Test: `apps/web/src/server/contacts/import/members.test.ts`, `apps/web/src/server/contacts/import/members.postgres.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ContactRecord`, `lockImportState`, `getImportState`, `recordConfirmedImport`, `todayInClubZone`, `displayName`, `listCustomFields`), Task 2 (`loadContactAccess`, `assertCanManage`), Task 3 (`setSuppression`, `setOptOut` in Tests), Task 4 (`ImportPayload`, `ImportedRow`, `transformRows`, `toSavedMapping`, `FieldIssue`, `BlockingIssue`, `memberPayload`)
- Produces:

```ts
// plan.ts — auch von Task 8 genutzt
export const MAX_LISTED_CHANGES = 1000;  export const MAX_LISTED_ISSUES = 1000
export type ChangedField = ContactField | 'groups' | `custom:${string}`
export interface ImportChange { type: 'created' | 'changed' | 'removed'; number: string | null; name: DisplayName
  fields: ChangedField[]    // bei 'changed': nur Felder, die der Benutzer sehen darf
  hiddenFields: boolean     // weitere, für ihn unsichtbare Felder haben sich geändert
  exited: boolean }         // bei 'removed': Austrittsdatum erreicht
export type ConfirmImportResult =
  | { ok: true; counts: { created: number; changed: number; removed: number; warnings: number } }
  | { ok: false; failure: 'blocked' | 'stockChanged' | 'confirmationRequired' }
export function changedFields(stored: ContactRecord, row: ImportedRow, mode: 'replace' | 'merge'): ChangedField[]
// members.ts
export const SAFETY_THRESHOLD = 0.2
export function needsSafetyConfirmation(stock: number, deletions: number): boolean   // stock > 0 && deletions > stock · 0,2
export interface MemberImportCounts { created: number; changed: number; unchanged: number; removed: number;
  removedExited: number; withoutEmail: number; futureExit: number | null }   // futureExit null ohne Sicht auf exitDate
export interface MemberImportPreview {
  stockVersion: number; counts: MemberImportCounts
  changes: ImportChange[]; moreChanges: number   // entfallende zuerst, dann geänderte, dann neue
  fieldIssues: FieldIssue[]; moreIssues: number
  blocking: BlockingIssue[]
  confirmation: { required: boolean; deletions: number }
}
export function previewMemberImport(db: Db, principal: Principal, payload: ImportPayload, now: Date): Promise<MemberImportPreview>
export function confirmMemberImport(db: Db, principal: Principal, payload: ImportPayload,
  input: Readonly<{ stockVersion: number; confirmedDeletions: number | null }>, now: Date): Promise<ConfirmImportResult>
```

**Ablauf:**
- Beide Funktionen verlangen `payload.kind === 'member'` und `assertCanManage(access, 'member')`, sonst `ForbiddenError`.
- **Plan** (gemeinsam für Vorschau und Bestätigen):
  - `transformRows`; heute = `todayInClubZone(now)`.
  - Zeilen mit `exitDate <= heute` sind ausgetreten und werden nicht übernommen.
  - Übrige Zeilen nach Mitgliedsnummer gegen den Bestand: neu, geändert (`changedFields(..., 'replace')`), unverändert.
  - Bestand ohne übernommene Zeile → entfällt; `exited`, wenn die Nummer als ausgetretene Zeile in der Datei steht.
- **Vorschau:** `stockVersion` aus `getImportState`; Listen auf 1 000 begrenzt.
- **Bestätigen** in **einer** Transaktion:
  1. `lockImportState`; anderer Stand → `stockChanged`.
  2. Plan neu berechnen; Blockierendes → `blocked`.
  3. `needsSafetyConfirmation` und `confirmedDeletions !== deletions` → `confirmationRequired`.
  4. Neue Zusatzfelder anlegen (`protection 'protected'`, ohne eigene Bereichszeilen, gehören also dem Mitglieder-Bereich).
  5. Entfallende löschen, Neue einfügen, Geänderte aktualisieren, je 500 Zeilen pro Anweisung. Nicht zugeordnete Felder werden `null`, Gruppen `[]`, Geschlecht ohne Wert `unspecified`.
  6. `recordConfirmedImport` mit `toSavedMapping(payload)`; neue Zusatzfelder stehen darin als `{ type: 'customField', customFieldId }`.
  7. `writeAudit('import.members', details: { created, changed, removed, warnings })`.
- Sperren und Widersprüche bleiben unberührt: Sie hängen am Schlüssel, nicht am Kontakt.

- [ ] **Step 1: Failing Tests schreiben** (`now = new Date('2026-11-24T10:00:00Z')`; `importer = userWith(db, { [membersAreaId]: 'edit' })`; `numbers(a, b)` baut Zeilen für die Nummern a…b; `stock(db, n)` importiert die Mitglieder 1…n)

```ts
it('creates all members on the first import without a safety check', async () => {
  const p = await previewMemberImport(db, importer, memberPayload(numbers(1, 3)), now)
  expect(p.counts).toMatchObject({ created: 3, changed: 0, removed: 0 }); expect(p.confirmation.required).toBe(false)
  expect(await confirmMemberImport(db, importer, memberPayload(numbers(1, 3)), { stockVersion: p.stockVersion, confirmedDeletions: null }, now))
    .toEqual({ ok: true, counts: { created: 3, changed: 0, removed: 0, warnings: 0 } })
})
it('replaces the stock: deletes missing, updates changed, keeps unchanged', async () => {
  // Bestand 1–3; Datei 1 (gleich), 2 (Nachname neu), 4 (neu) → counts { created: 1, changed: 1, unchanged: 1, removed: 1 };
  // changes: removed 3, changed 2 mit fields ['lastName'], created 4
})
it('deletes members whose exit date is reached and counts them as exited', async () => {
  // Bestand 1–3; Datei 1–3, Nr. 3 mit Mitglied bis '2026-11-24' → removed 1, removedExited 1; Nr. 3 gelöscht
})
it('reaches the exit date by the Berlin calendar', async () => {   // Review Focus 1
  // now = new Date('2026-03-31T22:30:00Z') (00:30 Uhr am 1. April in Berlin), Mitglied bis '2026-04-01' → ausgetreten
})
it('imports members with a future exit date', async () => { /* '2027-06-30' → übernommen, futureExit 1 */ })
it('asks for confirmation when more than 20 % would be deleted', async () => {
  await stock(db, 10)
  expect((await previewMemberImport(db, importer, memberPayload(numbers(1, 8)), now)).confirmation).toEqual({ required: false, deletions: 2 })
  const p = await previewMemberImport(db, importer, memberPayload(numbers(1, 7)), now)
  expect(p.confirmation).toEqual({ required: true, deletions: 3 })
  const confirm = async (n: number | null) => confirmMemberImport(db, importer, memberPayload(numbers(1, 7)),
    { stockVersion: p.stockVersion, confirmedDeletions: n }, now)
  expect(await confirm(null)).toEqual({ ok: false, failure: 'confirmationRequired' })
  expect(await confirm(3)).toMatchObject({ ok: true, counts: { removed: 3 } })
})
it('asks for confirmation when a file of the same size replaces most members', async () => {   // Review Focus 2
  await stock(db, 10)
  expect((await previewMemberImport(db, importer, memberPayload(numbers(101, 110)), now)).confirmation).toEqual({ required: true, deletions: 10 })
})
it('refuses to confirm after the stock changed', async () => {
  // Vorschau → setSuppression(db, admin, <Mitglied 1>, true) → confirm mit alter stockVersion → { ok: false, failure: 'stockChanged' }
})
it('refuses to confirm with blocking issues and changes nothing', async () => { /* doppelte Nr. → 'blocked' */ })
it('keeps suppressions and opt-outs of a deleted member and applies them on return', async () => {
  // Sperre und Widerspruch an Nr. 2 → Import ohne 2 → Import mit 2 → getContact zeigt Sperre und Widerspruch
})
it('saves the mapping and the import time only on confirm', async () => {
  // nach Vorschau: lastConfirmedAt null, mapping null; nach Bestätigen: lastConfirmedAt now,
  // savedMappingSchema.parse(mapping).columns['Nr.'] === { type: 'field', field: 'memberNumber' }
})
it('creates a new custom field as protected and keeps its values', async () => {
  // Spalte 'Spind' als newCustomField (text) → listCustomFields(member) [{ name: 'Spind', protection: 'protected' }],
  // getFieldAreas(member).get(`custom:<id>`) === [membersAreaId], die gespeicherte Zuordnung nennt die ID
})
it('lists changed protected fields only for users who may see them', async () => {
  // setFieldAreas(member, birthDate → [Finanzen]); Importeur (edit Mitglieder) ändert Geburtstag und Nachname
  // → changes[0] { type: 'changed', fields: ['lastName'], hiddenFields: true }
})
it('requires edit in the members area', async () => { /* read Mitglieder bzw. edit Finanzen → ForbiddenError */ })
it('writes an audit entry with counts and without names', async () => { /* 'import.members', { created: 3, … }; JSON ohne 'Anna' */ })

// members.postgres.test.ts — wie users.postgres.test.ts: eigene Datenbank, zwei Pool-Verbindungen, ohne TEST_POSTGRES_URL übersprungen
describe.skipIf(serverUrl === '')('member import on PostgreSQL (skipped without TEST_POSTGRES_URL)', () => {
  it('lets exactly one of two concurrent confirms win', async () => {
    // Bestand 1–5; zwei Vorschauen mit derselben stockVersion (Datei A: 1–6, Datei B: 1–5 und 7);
    // Promise.allSettled beider Bestätigungen → genau ein ok, ein { ok: false, failure: 'stockChanged' }; Bestand = Datei des Gewinners
  })
  it('refuses a confirm after another import changed the stock', async () => { /* … 'stockChanged' */ })
})
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/server/contacts/import` meldet FAIL, mit `TEST_POSTGRES_URL=postgres://vereinsbote:vereinsbote@localhost:5432/vereinsbote` auch die Postgres-Tests.
- [ ] **Step 3: `plan.ts` und `members.ts` umsetzen.**
- [ ] **Step 4: Prüfen.** Beide Läufe melden PASS, `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(contacts): import and replace members`

---

### Task 7: Partner pflegen (Server)

**Files:**
- Create: `apps/web/src/server/contacts/partner-form.ts`, `apps/web/src/server/contacts/partners.ts`
- Modify: `apps/web/src/server/audit/audit.ts` (`'partner.created' | 'partner.updated' | 'partner.deleted'`)
- Test: `apps/web/src/server/contacts/partner-form.test.ts`, `apps/web/src/server/contacts/partners.test.ts`

**Interfaces:**
- Consumes: Task 1–3 (`loadContactAccess`, `assertCanManage`, `contactKey`, `auditTarget`, `rekeyBlocks`, `bumpStockVersion`, `parseCalendarDate`), Task 4 (`MAX_LENGTH`, `isValidContactEmail`)
- Produces:

```ts
// partner-form.ts — Browser und Server
export type PartnerField = 'name' | 'customerNumber' | 'organization' | 'firstName' | 'lastName' | 'email' | 'tags'
  | 'birthDate' | 'street' | 'postalCode' | 'city'
export interface PartnerInput { customerNumber: string; organization: string; firstName: string; lastName: string;
  email: string; gender: Gender; tags: readonly string[];
  birthDate?: string; street?: string; postalCode?: string; city?: string;   // nur, wenn der Benutzer sie sehen darf
  custom?: Readonly<Record<string, string>> }                                // customFieldId → Wert, ebenso
export type PartnerFieldError = 'invalid' | 'required' | 'taken'
export type PartnerFieldErrors = Partial<Record<PartnerField, PartnerFieldError>>
export const MAX_TAGS = 20;  export const MAX_TAG_LENGTH = 40
export function invalidPartnerFields(input: Readonly<PartnerInput>): PartnerFieldErrors
export function normalizeTags(tags: readonly string[], existing: readonly string[]): string[]
// partners.ts
export class PartnerInputInvalidError extends Error { readonly fields: PartnerFieldErrors }
export class CustomerNumberTakenError extends Error {}
export function createPartner(db: Db, principal: Principal, input: Readonly<PartnerInput>): Promise<{ contactId: string }>
export function updatePartner(db: Db, principal: Principal, contactId: string, input: Readonly<PartnerInput>): Promise<void>
export function deletePartner(db: Db, principal: Principal, contactId: string): Promise<void>
export function listTags(db: Db): Promise<string[]>   // je Schlagwort eine Schreibweise, sortiert
```

**Regeln:**
- **`invalidPartnerFields`:**
  - `name: 'required'`, wenn Firma, Vor- und Nachname leer sind.
  - `email: 'required'`, wenn Kundennummer und E-Mail leer sind; `email: 'invalid'` bei ungültiger Adresse.
  - Längen nach Entscheidung 10 → `invalid`; `birthDate` muss `parseCalendarDate` bestehen.
  - `tags: 'invalid'` bei mehr als 20 Schlagworten oder einem über 40 Zeichen.
- **`normalizeTags`:** trimmen, Leere weg, ohne Groß-/Kleinschreibung entdoppeln; trifft ein Schlagwort ein vorhandenes, gilt dessen Schreibweise.
- **Schreibende Funktionen:**
  - `assertCanManage(access, 'partner')`; ein Mitglied als Ziel → `ForbiddenError` (Mitglieder sind schreibgeschützt).
  - Geschützte Felder oder Zusatzfelder, die der Benutzer nicht sehen darf → `ForbiddenError`; nicht übergebene bleiben unverändert.
  - Ungültige Eingabe → `PartnerInputInvalidError`; eine vergebene Kundennummer → `CustomerNumberTakenError` (Unique-Index, wie `withUniqueName` in `areas.ts`).
  - Ändert sich `contactKey`, ruft die Funktion `rekeyBlocks` in derselben Transaktion auf.
  - Jede Änderung: `bumpStockVersion('partner')` und `writeAudit` mit `target: auditTarget(...)`.
  - Löschen lässt Sperre und Widersprüche stehen.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// partner-form.test.ts
it('requires a name and a customer number or email', () => expect(invalidPartnerFields(emptyPartner)).toEqual({ name: 'required', email: 'required' }))
it('accepts an organization with an email only', () =>
  expect(invalidPartnerFields({ ...emptyPartner, organization: 'Stadtwerke', email: 'presse@stadtwerke.example' })).toEqual({}))
it('flags an invalid address, birth date and too many tags', () => { /* … */ })
it('merges tags ignoring case and keeps existing spellings', () =>
  expect(normalizeTags([' sponsor', 'Presse', 'SPONSOR', ''], ['Sponsor'])).toEqual(['Sponsor', 'Presse']))

// partners.test.ts
it('requires edit in the partner area', async () => { /* read Finanzen bzw. edit Mitglieder → ForbiddenError */ })
it('creates, updates and deletes a partner and bumps the stock version', async () => { /* partner-Version +3 */ })
it('refuses a customer number another partner has', async () => { /* → CustomerNumberTakenError */ })
it('never changes a member', async () => { /* updatePartner und deletePartner mit einer Mitglieds-ID → ForbiddenError */ })
it('refuses protected fields the user may not see', async () => {
  // setFieldAreas(partner, birthDate → [Mitglieder]); Partnerpfleger (edit Finanzen) übergibt birthDate → ForbiddenError
})
it('moves suppression and opt-outs when the key of a partner changes', async () => {
  // Partner nur mit E-Mail und Sperre → E-Mail ändern → Sperre unter neuer Adresse; Kundennummer setzen → unter 'nr:…'
})
it('keeps the suppression of a deleted partner', async () => { /* … */ })
it('lists each tag once', async () => { /* Partner mit ['Sponsor'] und ['sponsor', 'Presse'] → ['Presse', 'Sponsor'] */ })
it('audits by number or internal id, never by address', async () => { /* targets 'partner:100009', 'contact:<id>'; kein '@' */ })
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: `partner-form.ts` und `partners.ts` umsetzen.**
- [ ] **Step 4: Prüfen.** `vp test run apps/web/src/server/contacts` meldet PASS, `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(contacts): maintain partners with tags`

---

### Task 8: Partner-Import (Server)

**Files:**
- Create: `apps/web/src/server/contacts/import/partners.ts`
- Modify: `apps/web/src/server/audit/audit.ts` (`'import.partners'`)
- Test: `apps/web/src/server/contacts/import/partners.test.ts`

**Interfaces:**
- Consumes: Task 6 (`ImportChange`, `ConfirmImportResult`, `changedFields`, Listengrenzen), Task 3 (`rekeyBlocks`), Task 4 (`transformRows`, `partnerPayload`), Task 1
- Produces:

```ts
export interface PartnerRowIssue { line: number; reason: 'emailAmbiguous' | 'emailRepeated' }   // die Zeile wird übersprungen
export interface KeptValue { line: number; column: string }   // leere Zelle oder Feldfehler; der gespeicherte Wert bleibt
export interface PartnerImportPreview {
  stockVersion: number
  counts: { created: number; updated: number; unchanged: number; takenOver: number; skipped: number }
  changes: ImportChange[]; moreChanges: number
  notInExport: Array<{ id: string; customerNumber: string; name: DisplayName }>
  keptValues: KeptValue[]; rowIssues: PartnerRowIssue[]; fieldIssues: FieldIssue[]; moreIssues: number
  blocking: BlockingIssue[]
}
export function previewPartnerImport(db: Db, principal: Principal, payload: ImportPayload, now: Date): Promise<PartnerImportPreview>
export function confirmPartnerImport(db: Db, principal: Principal, payload: ImportPayload,
  input: Readonly<{ stockVersion: number; deleteIds: readonly string[] }>, now: Date): Promise<ConfirmImportResult>
  // counts: changed = aktualisiert + übernommen, removed = gelöscht
```

**Abgleich je Zeile** (in Dateireihenfolge):
1. **Mit Kundennummer, bekannt:** Dieser Partner wird aktualisiert.
2. **Mit Kundennummer, unbekannt:** Passt die E-Mail auf **genau einen** Partner ohne Kundennummer, wird er übernommen: Er bekommt die Nummer, `rekeyBlocks(email → nr)`, zählt als `takenOver`. Sonst wird ein neuer Partner angelegt.
3. **Ohne Kundennummer:** Stand die E-Mail schon in einer früheren Zeile ohne Kundennummer → `emailRepeated`, die Zeile wird übersprungen. Sonst: Trifft die E-Mail genau einen Partner, wird er aktualisiert; mehrere → `emailAmbiguous`, die Zeile wird übersprungen; keinen → neu.

**Weitere Regeln:**
- Aktualisieren heißt zusammenführen (`changedFields(..., 'merge')`): Nur Felder mit Wert werden geschrieben, `null` aus der Firmenregel leert. Felder in `blank` mit gespeichertem Wert stehen in `keptValues`. Schlagworte bleiben unberührt.
- Ein neuer Partner bekommt die Werte der Zeile; `gender` ohne Wert wird `unspecified`.
- `notInExport`: Partner mit Kundennummer, deren Nummer in keiner Zeile steht.
- Bestätigen sperrt, prüft und schreibt wie Task 6, ohne Sicherheitsabfrage. `deleteIds` muss eine Teilmenge des neu berechneten `notInExport` sein, sonst → `stockChanged`. Protokoll `'import.partners'` mit `{ created, updated, takenOver, deleted, warnings }`.

- [ ] **Step 1: Failing Tests schreiben**

```ts
it('updates a partner found by customer number and keeps its tags', async () => { /* tags ['Sponsor'] bleiben */ })
it('updates a partner without number found by email', async () => { /* … */ })
it('skips a row whose email matches several partners', async () => { /* rowIssues [{ line: 2, reason: 'emailAmbiguous' }] */ })
it('skips a repeated email among rows without customer number', async () => {
  // zwei Zeilen ohne Nr. mit info@baeckerei-koerner.example → { line: 3, reason: 'emailRepeated' }; nur ein Partner
})
it('takes over a manual partner and rekeys its blocks', async () => {
  // von Hand angelegter Partner (nur E-Mail) mit Sperre; Zeile 100007 mit derselben E-Mail → takenOver 1, kein neuer Partner,
  // Sperre unter 'nr:100007'
})
it('never overwrites stored values with empty cells or field errors and lists them', async () => {
  // gespeichert Vorname 'Lena', gültige E-Mail; Zeile Vorname '-', E-Mail 'lena@' → Werte bleiben;
  // keptValues [{ line: 2, column: 'Vorname' }, { line: 2, column: 'E-Mail' }]; fieldIssues invalidEmail
})
it('applies the organization rule', async () => { /* Vorname '-' → organization = Nachname, lastName null */ })
it('lists partners missing from the export and deletes only the ticked ones', async () => {
  // Bestand 100001–100003 und ein manueller Partner; Datei 100001 → notInExport 100002, 100003 (der manuelle nicht);
  // confirm deleteIds [100002] → 100003 und der manuelle bleiben
})
it('refuses a delete selection outside the list', async () => { /* deleteIds [manueller Partner] → 'stockChanged' */ })
it('blocks duplicate customer numbers and rows without number and email', async () => { /* → 'blocked' */ })
it('requires edit in the partner area', async () => { /* → ForbiddenError */ })
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: `import/partners.ts` umsetzen.**
- [ ] **Step 4: Prüfen.** `vp test run apps/web/src/server/contacts/import` meldet PASS, `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(contacts): import partners by matching`

---

### Task 9: Warnung bei alten Daten und Daten für den Rahmen (Server)

**Files:**
- Create: `apps/web/src/server/contacts/stale-import.ts`, `apps/web/src/server/frame.ts`
- Modify: `apps/web/src/server/tick/steps.ts` (`staleImportWarning` nach `pruneAuthRecords`), `apps/web/src/server/system-state.ts` (`StateKey` + `'stale_import_warned_at'`), `apps/web/src/server/audit/audit.ts` (`'import.stale_warning'`), `apps/web/src/server/contacts/calendar.ts` (`formatClubDate`), `apps/web/src/i18n/de.ts`, `apps/web/src/i18n/en.ts`
- Test: `apps/web/src/server/contacts/stale-import.test.ts`, `apps/web/src/server/frame.test.ts`, `calendar.test.ts` (Ergänzung)

**Interfaces:**
- Consumes: `TickStep`, `runTick`, `createSystemMailer`, `SystemMailer`, `CapturingMailer`, `translate`, `errorLabel` (Teilplan 1); `getContactSettings`, `getImportState`, `recordConfirmedImport` (Task 1); `loadContactAccess` (Task 2)
- Produces:

```ts
// calendar.ts (Ergänzung)
export function formatClubDate(at: Date, locale: Locale): string   // dateStyle 'long', timeZone CLUB_TIME_ZONE
// stale-import.ts
export const STALE_WARNING_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
export interface ImportFreshness { lastImportAt: Date | null; stale: boolean; weeks: number }
export function getImportFreshness(db: Db, now: Date): Promise<ImportFreshness>   // stale: lastImportAt + weeks · 7 Tage < now
export function createStaleImportWarningStep(createMailer?: (env: Env) => SystemMailer): TickStep   // name 'stale-import-warning'
export const staleImportWarning: TickStep
// server/frame.ts
export type FrameNotice = { kind: 'stale'; lastImportAt: string; weeks: number; canImport: boolean } | { kind: 'firstImport'; canImport: boolean }
export interface FrameInfo {
  nav: { admin: boolean; contacts: boolean; importMembers: boolean; importPartners: boolean }
  notice: FrameNotice | null   // nur bei read im Mitglieder-Bereich oder für Admins
}
export function loadFrameInfo(db: Db, principal: Principal, now: Date): Promise<FrameInfo>
```

**Ablauf des Schritts:**
1. Nicht `stale` (auch: noch nie ein Import) → `{ moreWork: false }`.
2. Die Woche beanspruchen: atomares Upsert auf `system_state('stale_import_warned_at')`, nur wenn der Eintrag fehlt oder älter als `STALE_WARNING_INTERVAL_MS` ist (wie `acquireLock` in `tick.ts`). Kommt keine Zeile zurück → fertig.
3. An jeden aktiven Admin (`is_admin`, `status = 'active'`) eine Mail in seiner Sprache. Ein Fehler je Empfänger wird nur mit `errorLabel` geloggt und gezählt; vor der nächsten Woche gibt es keinen weiteren Versuch.
4. `writeAudit('import.stale_warning', details: { sent, failed, error?: <errorLabel> })`.

**Mail-Texte** (verbindlich; `{date}` = `formatClubDate`, `{link}` = `new URL('/contacts/import/members', env.appUrl)`):
- `'mail.staleImport.subject'`: „Die Mitgliederdaten im Vereinsbote sind veraltet“ / „The member data in Vereinsbote is out of date“
- `'mail.staleImport.text'`: „Hallo {name},\n\nder letzte Mitglieder-Import war am {date}. Bitte lade einen aktuellen Export hoch:\n{link}“ / „Hello {name},\n\nthe last member import was on {date}. Please upload a current export:\n{link}“

- [ ] **Step 1: Failing Tests schreiben**

```ts
// calendar.test.ts (Ergänzung)
it('formats an instant as the Berlin day', () => {
  expect(formatClubDate(new Date('2026-09-30T22:30:00Z'), 'de')).toBe('1. Oktober 2026')
  expect(formatClubDate(new Date('2026-09-30T22:30:00Z'), 'en')).toBe('October 1, 2026')
})

// stale-import.test.ts — runTick({ db, env, steps: [createStaleImportWarningStep(() => mailer)], now: () => at })
it('warns nobody before the first import', async () => { /* mailer.sent [] */ })
it('sends one warning per week to active admins in their language', async () => {
  // Import vor 9 Wochen; aktive Admins (de, en), ein eingeladener Admin, ein aktiver Nicht-Admin
  // Tick → 2 Mails mit den Betreffen 'Die Mitgliederdaten im Vereinsbote sind veraltet' und 'The member data in Vereinsbote is out of date',
  //   Text enthält 'https://bote.example.org/contacts/import/members'
  // Tick 6 Tage später → keine weitere; Tick 7 Tage später → 2 weitere
})
it('does not retry within the week without a mailer', async () => {
  // createMailer = createSystemMailer (env ohne DEV_SMTP_URL) → Schritt 'done';
  // Protokoll { sent: 0, failed: 2, error: 'MailerNotConfiguredError' }; zweiter Tick am selben Tag versucht nichts
})
it('stops warning after a new import', async () => { /* recordConfirmedImport heute → kein Versand */ })
it('uses the configured weeks', async () => { /* staleImportWeeks 12, Import vor 9 Wochen → kein Versand */ })

// frame.test.ts
it('links contacts for any area, imports for the kind area and admin pages for admins', async () => {
  // edit Finanzen → nav { admin: false, contacts: true, importMembers: false, importPartners: true }
})
it('shows the first-import notice to members-area readers and admins only', async () => {
  // read Mitglieder → { kind: 'firstImport', canImport: false }; Admin ohne Bereich → firstImport; nur Finanzen → null
})
it('shows the stale notice after the deadline', async () => { /* Import vor 9 Wochen → { kind: 'stale', weeks: 8, … } */ })
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen**, `staleImportWarning` in `tickSteps` eintragen.
- [ ] **Step 4: Prüfen.** `vp test run apps/web/src/server` meldet PASS, `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(contacts): warn about stale member data`

---

### Task 10: Oberfläche: Rahmen, Navigation und Kontaktliste

**Files:**
- Create: `apps/web/src/components/main-nav.tsx`, `apps/web/src/components/contacts/{stale-import-banner,contact-search,contact-table}.tsx`, `apps/web/src/functions/contacts.ts`, `apps/web/src/routes/contacts/route.tsx`, `apps/web/src/routes/contacts/index.tsx`, `apps/web/e2e/contacts.e2e.ts`, `apps/web/e2e/helpers/sign-in.ts`
- Modify: `apps/web/src/routes/__root.tsx` (`loadFrame` liefert zusätzlich `frame: FrameInfo | null`), `apps/web/src/components/page-frame.tsx`, `apps/web/src/routes/index.tsx` (Hinweis „erster Import“), `apps/web/src/i18n/page-title.ts`, `apps/web/src/i18n/de.ts`, `en.ts`, `apps/web/playwright.config.ts`, `apps/web/src/components/post-form.test.tsx` (`ON_SUBMIT_FORMS` + Suchformular)
- Test: `apps/web/src/i18n/page-title.test.ts` (Ergänzung), `apps/web/e2e/contacts.e2e.ts`

**Interfaces:**
- Consumes: `loadFrameInfo`, `formatClubDate` (Task 9), `loadContactAccess`, `listContacts` (Task 2), `requireRequestPrincipal`, `pageHead`, `latestLink`, `expectNoA11yViolations`
- Produces:

```ts
// functions/contacts.ts
export const loadContactsAccess   // GET () → { canList: boolean; canManage: Record<ContactKind, boolean> }; HTTP 403 ohne canList
export const searchContacts       // POST (ContactListQuery, zod) → ContactListPage
// i18n/page-title.ts
export type ContactsTitleContext = TitleContext & { readonly match: TitleMatch & { readonly context:
  Readonly<{ access: Readonly<{ canList: boolean; canManage: Readonly<Record<ContactKind, boolean>> }> }> } }
export function contactsPageHead(context: ContactsTitleContext, page: MessageKey, manage?: ContactKind): { meta: [{ title: string }] }
  // ohne canList, oder mit manage ohne canManage[manage]: der Titel von 'admin.forbidden'
// e2e/helpers/sign-in.ts
export async function signIn(page: Page, email: string): Promise<void>   // /login → Link aus Mailpit → „Deine Bereiche“
```

**Oberfläche:**
- **Root:** `loadFrame` lädt bei gültiger Sitzung `loadPrincipal` und `loadFrameInfo`. Ein Fehler zählt wie bisher als abgemeldet und wird mit `errorLabelWithCause` geloggt.
- **`PageFrame`** zeigt für Angemeldete `MainNav` und bei `notice.kind === 'stale'` das Banner.
  - `MainNav`: `<nav aria-label="Hauptnavigation">` mit „Start“, „Kontakte“, „Mitglieder importieren“, „Partner importieren“, „Verwaltung“ je nach `nav`; `aria-current` wie `AdminNav`.
  - Banner: `<section aria-labelledby>` mit „Die Mitgliederdaten sind älter als {weeks} Wochen (letzter Import am {date}).“ und, mit `canImport`, dem Link „Jetzt importieren“.
- **Startseite:** Bei `notice.kind === 'firstImport'` steht „Es wurden noch keine Mitglieder importiert.“ und, mit `canImport`, der Link „Ersten Import starten“.
- **`routes/contacts/route.tsx`:** nach dem Muster von `admin/route.tsx`. `beforeLoad` legt `access` in den Routenkontext; ohne `canList` die Seite „Kein Zugriff“ mit „Du hast keinen Zugriff auf Kontakte.“
- **`/contacts`** (`head: contactsPageHead(context, 'contacts.title')`):
  - `validateSearch`: nur `kind` (`member`/`partner`, Standard `member`). React-Aria-`Tabs` „Mitglieder“/„Partner“ als Links.
  - Suchformular (`PostForm`, `TextField` „Suche“, Button „Suchen“). Filter: `Select` „Gruppe“ bzw. „Schlagwort“, Checkboxen „Ohne E-Mail“ und „Gesperrt“, `Select` „Austritt“ (nur mit `canFilterExit`).
  - React-Aria-`Table` mit Nummer, Name, E-Mail, Gruppen bzw. Schlagworte, Status „Gesperrt“. Seitenwechsel „Vorherige Seite“/„Nächste Seite“ mit „Seite {page} von {pages}“.
  - Suche, Filter und Seite sind Zustand der Komponente und gehen per `searchContacts` (POST). Der Live-Bereich meldet „{total} Kontakte gefunden.“; ohne Treffer steht „Keine Kontakte gefunden.“
- **Texte:** alle Schlüssel in `de.ts` und `en.ts`, englisch sinngemäß („Main navigation“, „Contacts“, „Import members“, „Import partners“, „No contacts found.“ …).
- **`playwright.config.ts`:**

```ts
projects: [
  { name: 'fundament', testMatch: 'fundament.e2e.ts', use: { ...devices['Desktop Chrome'] } },
  { name: 'contacts', testMatch: 'contacts.e2e.ts', dependencies: ['fundament'], use: { ...devices['Desktop Chrome'] } },
],
```

- [ ] **Step 1: Failing Tests schreiben**

```ts
// page-title.test.ts (Ergänzung)
it('names a contacts page as no access without the needed right', () => {
  // canList false → 'Kein Zugriff – Vereinsbote'; manage 'partner' ohne canManage.partner → ebenso; sonst 'Kontakte – Vereinsbote'
})

// contacts.e2e.ts
test.describe.configure({ mode: 'serial' })
let admin: Page
let uli: Page   // liest nur Finanzen (Partner-Bereich); angemeldet in Task 12, wiederverwendet in Task 13

test.beforeAll(async ({ browser }) => {
  // Weit weg von UTC: Ein Datum, das irgendwo über die Ortszeit liefe, wäre hier um einen Tag verschoben.
  admin = await (await browser.newContext({ locale: 'de-DE', timezoneId: 'Pacific/Honolulu' })).newPage()
  await signIn(admin, 'admin@verein.test')
})

test('prepares access and shows the empty contact list', async () => {
  await admin.goto('/admin/users')
  await admin.getByLabel('Finanzen für Alex Admin').click(); await admin.getByRole('option', { name: 'Bearbeiten' }).click()
  await expect(admin.getByRole('status')).toHaveText('Finanzen für Alex Admin: Bearbeiten')
  await admin.getByLabel('Name').fill('Uli'); await admin.getByLabel('E-Mail').fill('uli@verein.test')
  await admin.getByRole('button', { name: 'Einladen' }).click()
  await admin.getByLabel('Finanzen für Uli').click(); await admin.getByRole('option', { name: 'Lesen' }).click()
  await expect(admin.getByRole('status')).toHaveText('Finanzen für Uli: Lesen')

  await admin.goto('/')
  const nav = admin.getByRole('navigation', { name: 'Hauptnavigation' })
  await expect(nav.getByRole('link', { name: 'Mitglieder importieren' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Partner importieren' })).toBeVisible()
  await expect(admin.getByText('Es wurden noch keine Mitglieder importiert.')).toBeVisible()
  await expectNoA11yViolations(admin)
  await nav.getByRole('link', { name: 'Kontakte' }).click()
  await expect(admin).toHaveTitle('Kontakte – Vereinsbote')
  await expect(admin.getByRole('tab', { name: 'Mitglieder', selected: true })).toBeVisible()
  await expect(admin.getByText('Keine Kontakte gefunden.')).toBeVisible()
  await expectNoA11yViolations(admin)
})
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/i18n` und `vp run --filter web e2e` (Dienste aus `docker/compose.dev.yml` laufen) melden FAIL.
- [ ] **Step 3: Oberfläche bauen** wie beschrieben.
- [ ] **Step 4: Prüfen.** `vp test` und `vp run --filter web e2e` melden PASS (beide Projekte), `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(contacts): add navigation and contact list`

---

### Task 11: Oberfläche: Import-Assistent

**Files:**
- Create: `apps/web/src/server/contacts/import/form-data.ts`, `apps/web/src/components/contacts/import/build-payload.ts`, `apps/web/src/components/contacts/import/{import-wizard,file-step,mapping-step,preview-step,result-step}.tsx`, `apps/web/src/functions/contact-import.ts`, `apps/web/src/routes/contacts/import/members.tsx`, `apps/web/src/routes/contacts/import/partners.tsx`, `apps/web/e2e/fixtures/member-export.ts`, `apps/web/e2e/fixtures/partner-export.ts`
- Modify: `apps/web/src/i18n/de.ts`, `en.ts`, `apps/web/e2e/contacts.e2e.ts`, `apps/web/src/components/post-form.test.tsx` (`ON_SUBMIT_FORMS`)
- Test: `apps/web/src/server/contacts/import/form-data.test.ts`, `apps/web/src/components/contacts/import/build-payload.test.ts`, E2E

**Interfaces:**
- Consumes: Task 4 (`ImportPayload`, `encodeImportPayload`, `decodeImportPayload`, `ImportPayloadError`, `suggestMapping`, `mappingChanges`, `rowPassesFilters`, `suggestGender`, `savedMappingSchema`, `MAX_IMPORT_ROWS`, `MAX_COMPRESSED_PAYLOAD_BYTES`), Task 5 (`readSheetFile`, `Sheet`), Task 6 und 8 (Vorschau, Bestätigen), Task 1 (`listCustomFields`, `getImportState`)
- Produces:

```ts
// server/contacts/import/form-data.ts — Browser und Server
export interface ImportFormRequest { kind: ContactKind; payload: Blob; stockVersion: number | null;
  confirmedDeletions: number | null; deleteIds: string[] }
export function toImportFormData(request: ImportFormRequest): FormData   // Felder kind, payload, stockVersion, confirmedDeletions, deleteIds (JSON)
export function parseImportFormData(data: unknown): ImportFormRequest    // Validator der Server-Funktionen; zod für die Textfelder, wirft bei Fehlern
// components/contacts/import/build-payload.ts
export interface MappingDraft { columns: Record<string, ColumnTarget>; filters: FilterRule[]; options: ImportOptions }
export type BuildPayloadResult = { ok: true; payload: ImportPayload; filteredOut: number }
  | { ok: false; problem: 'keyNotMapped' | 'fieldMappedTwice' | 'tooManyRows' | 'noRows' }
export function buildPayload(kind: ContactKind, sheet: Sheet, draft: MappingDraft): BuildPayloadResult
export function sampleValues(sheet: Sheet, header: string, max?: number): string[]   // bis zu 3 verschiedene, nicht leere Werte
export function distinctValues(sheet: Sheet, header: string, markers: readonly string[]): string[]   // für die Geschlechts-Übersetzung
// functions/contact-import.ts
export const loadImportPage   // GET ({ kind }) → { canImport: boolean; savedMapping: SavedMapping | null;
                              //   customFields: CustomFieldRecord[]; lastImportAt: string | null }; HTTP 403 ohne Recht
export const previewImport    // POST (FormData) → { ok: true; preview: MemberImportPreview | PartnerImportPreview }
                              //   | { ok: false; failure: 'payloadTooLarge' | 'payloadInvalid' }
export const confirmImport    // POST (FormData) → ConfirmImportResult | { ok: false; failure: 'payloadTooLarge' | 'payloadInvalid' }
// e2e/fixtures — erfundene Daten in der Form des echten Exports
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export interface MemberExportRow { nr: number; firstName: string; lastName: string; birthday: Date; email: string;   // '-' ohne E-Mail
  status: 'Aktiv' | 'Passiv'; memberSince: Date; memberUntil: Date | null; departments: string; gender: 'männlich' | 'weiblich' | 'keine Angabe' }
export function memberExportRows(today: Date): MemberExportRow[]
export function memberExportXlsx(rows: readonly MemberExportRow[]): Promise<Buffer>   // write-excel-file (Node), ein Blatt
export function partnerExportCsv(): Buffer   // Windows-1252 über Buffer.from(text, 'latin1') (wirft bei Zeichen > 0xFF), ';', CRLF
```

**Fixtures** (erfunden):
- **Mitglieder:** 40 Zeilen; Spalten `Nr.`, `Vorname`, `Nachname`, `Geburtstag`, `E-Mail`, `Typ` (immer „Mitglied“), `Status`, `Mitglied seit`, `Mitglied bis`, `Abteilungen`, `Geschlecht`.
  - Daten als Excel-Datum (`dd.mm.yyyy`); `Nr.` als Zahl ab 1001.
  - Jede 7. E-Mail „-“, sonst `vorname.nachname@example.org`; `Abteilungen` reihum „Fußball“, „Fußball, Danceaerobic“, „-“, „Tischtennis“.
  - Zeile 39 hat `Mitglied bis` = gestern, Zeile 40 ein Datum im nächsten Jahr.
- **Partner:** `Nr.;Nachname;Vorname;E-Mail;Geschlecht;Typ` mit 6 Zeilen und `Typ` „Kontakt“:
  - 100001 „Bäckerei Körner GmbH“, 100002 „Getränke Weiß KG“, 100003 eine Organisation ohne E-Mail („-“), 100004 eine weitere Organisation; alle mit Vorname „-“ und „keine Angabe“.
  - 100005 und 100006 Personen, z. B. „Müller;Lena“.

**Assistent** (eine Komponente für beide Arten):
- **Ablauf:** Vier Schritte mit der Überschrift „Schritt {n} von 4: {Name}“ (Datei, Zuordnung, Vorschau, Ergebnis). Beim Wechsel bekommt die Überschrift den Fokus, der Live-Bereich sagt sie an. Die Seite hat genau einen Live-Bereich (`Announcements`) für Schrittwechsel und Ergebnisse; so bleibt `getByRole('status')` eindeutig, wie auf den Seiten aus Teilplan 1.
- **Datei:** React-Aria-`DropZone` mit `FileTrigger` (Button „Datei auswählen“, `.csv` und `.xlsx`); bei mehreren Blättern ein `Select` „Blatt“; Lesefehler als Meldung am Feld.
- **Zuordnung:**
  - Tabelle: Spaltenkopf, bis zu drei Beispielwerte, `Select` „{Spalte} zuordnen“ mit den Feldern der Art, „Zu Gruppen hinzufügen“ (Mitglieder), vorhandenen Zusatzfeldern, „Neues Zusatzfeld“ (dann Name und Typ) und „Verwerfen“.
  - „Geschlecht übersetzen“ (ein `Select` je vorkommendem Wert, vorbelegt mit `suggestGender`), Leerwerte (Text, Standard „-“), Trennzeichen für Gruppen (Checkboxen Komma, Semikolon), Filterregeln; nur Partner die Checkbox „Ist der Vorname leer, ist der Nachname die Firma“.
  - Mit gespeicherter Zuordnung: „Die Zuordnung vom letzten Import wurde übernommen.“ oder die fehlenden bzw. neuen Spalten (`mappingChanges`).
  - „Weiter zur Vorschau“ ruft `buildPayload` (Problem am Formular, z. B. „Ordne die Mitgliedsnummer zu.“, „Die Datei hat mehr als 10 000 Zeilen.“), dann `encodeImportPayload` (über der Grenze: „Die Datei ist zu groß.“).
- **Vorschau:**
  - Zahlen als Tabelle mit den Zeilen „Neu“, „Geändert“, „Unverändert“, „Entfällt“, „davon ausgetreten“, „Ohne E-Mail“, „Austritt geplant“ (Partner: „Neu“, „Aktualisiert“, „Übernommen“, „Unverändert“, „Übersprungen“); Änderungsliste; Fehlerliste mit „Zeile“, „Spalte“, „Grund“, nie mit Werten.
  - Blockierende Fehler sperren das Bestätigen und sagen, was in der Datei zu korrigieren ist.
  - Mit `confirmation.required` die Checkbox „Ich bestätige, dass {count} Mitglieder gelöscht werden.“; ohne Haken zeigt „Import bestätigen“ am Feld „Bitte bestätige die Löschungen.“ Partner: `CheckboxGroup` „Nicht mehr im Export – zum Löschen ankreuzen“ und die behaltenen Werte.
- **Bestätigen:** `stockChanged` → die Vorschau neu berechnen und ansagen: „Der Bestand hat sich geändert. Die Vorschau wurde neu berechnet.“ Erfolg → Schritt Ergebnis mit der Statusmeldung „Import abgeschlossen: {created} neu, {changed} geändert, {removed} gelöscht.“, Link „Zur Kontaktliste“, dann `router.invalidate()`.
- **Routen:** `/contacts/import/members` und `/contacts/import/partners` mit `head: contactsPageHead(context, 'import.membersTitle' | 'import.partnersTitle', kind)`, Titel „Mitglieder importieren“ bzw. „Partner importieren“.
- **Server-Funktionen:** `parseImportFormData` als Validator; `decodeImportPayload` im Handler (`ImportPayloadError` → `payloadTooLarge`/`payloadInvalid`); `payload.kind` muss zum Feld `kind` passen. Die Bibliotheken lädt nur `read-sheet.ts` per `import()`.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// form-data.test.ts
it('round-trips a confirm request', async () => { /* toImportFormData → parseImportFormData: gleiche Werte, payload als Blob */ })
it('refuses missing or malformed fields', () => { /* kein FormData, kind 'x', stockVersion 'abc', deleteIds kein JSON-Array → wirft */ })

// build-payload.test.ts
it('sends only mapped columns and the rows inside the filters', () => {
  // Sheet Nr., Vorname, Notiz, Status; Notiz → discard; Filter Status is 'Aktiv' → columns ohne Notiz,
  // discardedHeaders ['Notiz'], keine Notiz-Werte in den Zellen, filteredOut 1, line bleibt die Dateizeile
})
it('requires the member number before the preview', () => { /* → { ok: false, problem: 'keyNotMapped' } */ })
it('refuses more than 10 000 rows and empty sheets', () => { /* 10 001 Zeilen → tooManyRows; nur Kopf → noRows */ })
it('picks up to three distinct sample values', () => { /* ['a', 'a', '', 'b', 'c', 'd'] → ['a', 'b', 'c'] */ })

// contacts.e2e.ts
async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Datei auswählen' }).click(); await (await chooser).setFiles(file)
}
async function toPreview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Weiter zur Vorschau' }).click()
  await expect(page.getByRole('heading', { name: 'Schritt 3 von 4: Vorschau' })).toBeFocused()
}

test('imports members from an XLSX export', async () => {
  await admin.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Mitglieder importieren' }).click()
  await expect(admin).toHaveTitle('Mitglieder importieren – Vereinsbote')
  await expect(admin.getByRole('heading', { name: 'Schritt 1 von 4: Datei' })).toBeVisible(); await expectNoA11yViolations(admin)
  await upload(admin, { name: 'mitglieder.xlsx', mimeType: XLSX_MIME, buffer: await memberExportXlsx(memberExportRows(new Date())) })
  await expect(admin.getByRole('heading', { name: 'Schritt 2 von 4: Zuordnung' })).toBeFocused()
  await expect(admin.getByRole('button', { name: /^Nr\. zuordnen/u })).toContainText('Mitgliedsnummer')
  await expect(admin.getByRole('button', { name: /^Typ zuordnen/u })).toContainText('Verwerfen')
  await expect(admin.getByRole('button', { name: /^Abteilungen zuordnen/u })).toContainText('Zu Gruppen hinzufügen')
  await expectNoA11yViolations(admin)
  await toPreview(admin)
  await expect(admin.getByRole('row', { name: /^Neu\b/u })).toContainText('39')   // Zeile 39 ist ausgetreten
  await expectNoA11yViolations(admin)
  await admin.getByRole('button', { name: 'Import bestätigen' }).click()
  await expect(admin.getByRole('status')).toHaveText('Import abgeschlossen: 39 neu, 0 geändert, 0 gelöscht.')
  await expectNoA11yViolations(admin)
})

test('imports members again with the remembered mapping and the safety check', async () => {
  await admin.goto('/contacts/import/members')
  await upload(admin, { name: 'mitglieder.xlsx', mimeType: XLSX_MIME, buffer: await memberExportXlsx(memberExportRows(new Date()).slice(0, 30)) })
  await expect(admin.getByText('Die Zuordnung vom letzten Import wurde übernommen.')).toBeVisible()
  await toPreview(admin)
  await expect(admin.getByRole('row', { name: /^Entfällt\b/u })).toContainText('9')   // 9 von 39: mehr als 20 %
  await admin.getByRole('button', { name: 'Import bestätigen' }).click()
  await expect(admin.getByText('Bitte bestätige die Löschungen.')).toBeVisible()
  await admin.getByRole('checkbox', { name: 'Ich bestätige, dass 9 Mitglieder gelöscht werden.' }).check()
  await admin.getByRole('button', { name: 'Import bestätigen' }).click()
  await expect(admin.getByRole('status')).toHaveText('Import abgeschlossen: 0 neu, 0 geändert, 9 gelöscht.')
})

test('imports partners from a Windows-1252 CSV with semicolons', async () => {
  await admin.goto('/contacts/import/partners')
  await expect(admin).toHaveTitle('Partner importieren – Vereinsbote')
  await upload(admin, { name: 'partner.csv', mimeType: 'text/csv', buffer: partnerExportCsv() })
  await expect(admin.getByRole('button', { name: /^Nr\. zuordnen/u })).toContainText('Kundennummer')
  await admin.getByRole('checkbox', { name: 'Ist der Vorname leer, ist der Nachname die Firma' }).check()
  await expectNoA11yViolations(admin)
  await toPreview(admin)
  await expect(admin.getByRole('row', { name: /^Neu\b/u })).toContainText('6')
  await admin.getByRole('button', { name: 'Import bestätigen' }).click()
  await expect(admin.getByRole('status')).toHaveText('Import abgeschlossen: 6 neu, 0 geändert, 0 gelöscht.')
})
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/server/contacts/import/form-data.test.ts apps/web/src/components/contacts/import` und das E2E melden FAIL.
- [ ] **Step 3: Module, Server-Funktionen, Assistent, Routen und Fixtures bauen.**
- [ ] **Step 4: Prüfen.**
  - `vp test` und `vp run --filter web e2e` melden PASS, `vp check` 0/0.
  - Mit `vp dev`: Im Netzwerk-Tab lädt `/contacts` weder `papaparse` noch `read-excel-file`; `/contacts/import/members` lädt sie erst beim Lesen einer Datei. Die Anfrage der Vorschau enthält nur das Feld `payload` mit den zugeordneten Spalten.
- [ ] **Step 5: Commit** – `feat(contacts): add the import wizard`

---

### Task 12: Oberfläche: Detailansicht, Sperre, Widerspruch und Partnerpflege

**Files:**
- Create: `apps/web/src/routes/contacts/$contactId.tsx`, `apps/web/src/routes/contacts/new.tsx`, `apps/web/src/components/contacts/{contact-details,blocks-panel,partner-form,tag-field,delete-partner-dialog}.tsx`
- Modify: `apps/web/src/functions/contacts.ts`, `apps/web/src/components/contacts/contact-table.tsx` (Name als Link zur Detailansicht; Link „Partner anlegen“ im Reiter Partner mit `canManage.partner`), `apps/web/src/i18n/de.ts`, `en.ts`, `apps/web/e2e/contacts.e2e.ts`, `apps/web/src/components/post-form.test.tsx` (`ON_SUBMIT_FORMS`)
- Test: E2E

**Interfaces:**
- Consumes: `getContact` (Task 2), `setSuppression`, `setOptOut` (Task 3), `createPartner`, `updatePartner`, `deletePartner`, `listTags`, `invalidPartnerFields`, `PartnerFieldErrors` (Task 7), `listCustomFields`, `formatCalendarDate`, `contactsPageHead` (Task 10)
- Produces (in `functions/contacts.ts`):

```ts
export const loadContact          // GET ({ contactId: uuid }) → ContactDetail; unbekannt → notFound()
export const submitSuppression    // POST ({ contactId, suppressed: boolean }) → void
export const submitOptOut         // POST ({ contactId, areaId, optedOut: boolean }) → void
export const loadPartnerForm      // GET ({ contactId?: uuid }) → { values: PartnerInput | null; tagSuggestions: string[];
                                  //   protectedFields: ProtectedValueField[]; customFields: CustomFieldRecord[] }   (nur sichtbare)
export const submitPartner        // POST ({ contactId?: uuid } & PartnerInput) → { ok: true; contactId: string }
                                  //   | { ok: false; fields: PartnerFieldErrors }   (CustomerNumberTakenError → customerNumber 'taken')
export const submitDeletePartner  // POST ({ contactId }) → void
```

**Oberfläche:**
- **`/contacts/$contactId`** (`head: contactsPageHead(context, 'contact.title')`, Titel „Kontakt – Vereinsbote“):
  - Überschrift `name.primary`, darunter `secondary`; Beschreibungsliste der Basisfelder und der gelieferten geschützten und Zusatzfelder. Daten über `formatCalendarDate`, nie über `new Date()`.
  - Mitglieder: der Hinweis „Änderungen in der Mitgliederverwaltung vornehmen.“
  - „Sperre“: „Gesperrt seit {date}“; mit `canManage` der Button „Keine Mails mehr“ bzw. „Sperre aufheben“, Ansage „Der Kontakt bekommt keine Mails mehr.“ bzw. „Die Sperre ist aufgehoben.“
  - „Widersprüche“: ohne Recht eine Liste; mit Recht je Bereich eine Checkbox „Widerspruch für {area}“, Ansage „Widerspruch für {area} gespeichert.“ bzw. „… aufgehoben.“
  - Partner mit Recht: „Bearbeiten“ zeigt das Partnerformular an Ort und Stelle; „Löschen“ öffnet den Dialog „{name} löschen?“ mit „Ja, löschen“, danach zurück zur Liste mit „{name} wurde gelöscht.“
- **`/contacts/new`** (`head: contactsPageHead(context, 'partner.newTitle', 'partner')`, Titel „Partner anlegen – Vereinsbote“): das Partnerformular.
- **Partnerformular** (`PostForm`, Fehler am Feld über `FieldError`, Browser prüft vorab mit `invalidPartnerFields`):
  - „Kundennummer“, „Firma“, „Vorname“, „Nachname“, „E-Mail“, `Select` „Geschlecht“ (weiblich, männlich, divers, keine Angabe); sichtbare geschützte Felder (`DateField` „Geburtsdatum“, „Straße“, „PLZ“, „Ort“) und Zusatzfelder.
  - Schlagworte: `TagGroup` mit Entfernen je Schlagwort und `ComboBox` „Schlagwort hinzufügen“ mit Vorschlägen.
  - „Speichern“ führt zur Detailansicht mit der Ansage „Gespeichert.“
  - Feldtexte: „Bitte gib einen Namen oder eine Firma ein.“, „Bitte gib eine Kundennummer oder eine E-Mail-Adresse ein.“, „Diese Kundennummer hat schon ein anderer Partner.“, „Bitte prüfe die Eingabe.“

- [ ] **Step 1: Failing Tests schreiben**

```ts
async function openMember(page: Page, row: MemberExportRow): Promise<void> {
  await page.goto('/contacts')
  await page.getByLabel('Suche').fill(row.lastName); await page.getByRole('button', { name: 'Suchen' }).click()
  await page.getByRole('link', { name: `${row.firstName} ${row.lastName}` }).click()
}

test('shows a member, suppresses it and records an opt-out', async () => {
  const [first] = memberExportRows(new Date())
  await openMember(admin, first)
  await expect(admin).toHaveTitle('Kontakt – Vereinsbote')
  // In Honolulu-Zeit gelesen und trotzdem derselbe Tag (Review Focus 3)
  await expect(admin.getByText(first.birthday.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }))).toBeVisible()
  await expect(admin.getByText('Änderungen in der Mitgliederverwaltung vornehmen.')).toBeVisible()
  await admin.getByRole('button', { name: 'Keine Mails mehr' }).click()
  await expect(admin.getByRole('status')).toHaveText('Der Kontakt bekommt keine Mails mehr.')
  await admin.getByRole('checkbox', { name: 'Widerspruch für Finanzen' }).check()
  await expect(admin.getByRole('status')).toHaveText('Widerspruch für Finanzen gespeichert.')
  await expectNoA11yViolations(admin)
})

test('creates, edits and deletes a partner with tags', async () => {
  await admin.goto('/contacts?kind=partner'); await admin.getByRole('link', { name: 'Partner anlegen' }).click()
  await expect(admin).toHaveTitle('Partner anlegen – Vereinsbote')
  await admin.getByRole('button', { name: 'Speichern' }).click()
  await expect(admin.getByText('Bitte gib einen Namen oder eine Firma ein.')).toBeVisible(); await expectNoA11yViolations(admin)
  await admin.getByLabel('Firma').fill('Sportpresse Nord'); await admin.getByLabel('E-Mail').fill('redaktion@sportpresse.example')
  await admin.getByLabel('Schlagwort hinzufügen').fill('Presse'); await admin.keyboard.press('Enter')
  await admin.getByRole('button', { name: 'Speichern' }).click()
  await expect(admin.getByRole('heading', { name: 'Sportpresse Nord' })).toBeVisible()
  await admin.getByRole('button', { name: 'Bearbeiten' }).click()
  await admin.getByLabel('Kundennummer').fill('100001'); await admin.getByRole('button', { name: 'Speichern' }).click()   // die Bäckerei
  await expect(admin.getByText('Diese Kundennummer hat schon ein anderer Partner.')).toBeVisible()
  await admin.getByLabel('Kundennummer').fill('100099'); await admin.getByRole('button', { name: 'Speichern' }).click()
  await expect(admin.getByRole('status')).toHaveText('Gespeichert.')
  await admin.getByRole('button', { name: 'Löschen' }).click()
  await expect(admin.getByRole('dialog', { name: 'Sportpresse Nord löschen?' })).toBeVisible(); await expectNoA11yViolations(admin)
  await admin.getByRole('button', { name: 'Ja, löschen' }).click()
  await expect(admin.getByRole('status')).toHaveText('Sportpresse Nord wurde gelöscht.')
})

test('hides protected member fields from a reader of another area', async ({ browser }) => {
  uli = await (await browser.newContext({ locale: 'de-DE' })).newPage()
  await signIn(uli, 'uli@verein.test')
  await openMember(uli, memberExportRows(new Date())[0])
  await expect(uli.getByText('Geburtsdatum')).toHaveCount(0)
  await expect(uli.getByRole('button', { name: 'Keine Mails mehr' })).toHaveCount(0)
  await expect(uli.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Mitglieder importieren' })).toHaveCount(0)
  await expectNoA11yViolations(uli)
})
```

- [ ] **Step 2: Tests laufen lassen.** `vp run --filter web e2e` meldet FAIL.
- [ ] **Step 3: Server-Funktionen, Routen und Komponenten bauen.**
- [ ] **Step 4: Prüfen.** `vp test` und `vp run --filter web e2e` melden PASS, `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(contacts): show contacts and maintain partners`

---

### Task 13: Oberfläche: Kontakt-Einstellungen für Admins

**Files:**
- Create: `apps/web/src/routes/admin/contact-settings.tsx`, `apps/web/src/functions/contact-settings.ts`, `apps/web/src/components/admin/contact-settings/{contact-areas-form,field-areas-table,stale-weeks-form}.tsx`
- Modify: `apps/web/src/components/admin-nav.tsx` (Link „Kontakte“), `apps/web/src/i18n/de.ts`, `en.ts`, `apps/web/e2e/contacts.e2e.ts`, `apps/web/src/components/post-form.test.tsx` (`ON_SUBMIT_FORMS`)
- Test: E2E

**Interfaces:**
- Consumes: Task 1 (`getContactSettings`, `getFieldAreas`, `listCustomFields`, `setContactAreas`, `setFieldAreas`, `setCustomFieldProtection`, `setStaleImportWeeks`, Fehlerklassen), `listAreas`, `adminPageHead`
- Produces (in `functions/contact-settings.ts`):

```ts
export const loadContactSettingsPage      // GET () → { areas: Array<{ id; name }>; settings: ContactSettings;
                                          //   fields: Record<ContactKind, Array<{ key: FieldKey; customName: string | null; areaIds: string[] }>>;
                                          //   customFields: CustomFieldRecord[] }
export const submitContactAreas           // POST ({ membersAreaId: uuid; partnersAreaId: uuid }) → void
export const submitFieldAreas             // POST ({ kind; fieldKey; areaIds: uuid[] }) → { ok: true } | { ok: false; failure: 'noArea' }
export const submitCustomFieldProtection  // POST ({ customFieldId: uuid; protection }) → void
export const submitStaleImportWeeks       // POST ({ weeks: number }) → { ok: true } | { ok: false; failure: 'invalid' }
```

**Oberfläche** (`/admin/contact-settings`, `head: adminPageHead(context, 'contactSettings.title')`, Titel „Kontakt-Einstellungen – Vereinsbote“):
- Formular „Bereiche“ mit `Select` „Mitglieder-Bereich“ und „Partner-Bereich“. Ist einer nicht gesetzt (ältere Instanz), steht darüber „Wähle die Bereiche, damit Importe möglich sind.“
- Tabelle „Geschützte Felder“ je Art: eine Zeile je Feld (Geburtsdatum, Eintrittsdatum, Austrittsdatum, Adresse, geschützte Zusatzfelder), eine Spalte je Bereich, Checkbox „{field} ({kind}) für {area}“.
  - Jede Änderung speichert sofort und sagt an: „{field} ({kind}): {areas}“.
  - Das Abwählen des letzten Bereichs wird abgelehnt: Alert „Mindestens ein Bereich muss bleiben.“, die Checkbox bleibt gesetzt.
- Zusatzfelder: `Select` „Schutz von {name}“ mit „Basisfeld“ und „Geschützt“.
- Formular „Frist für alte Daten“: `NumberField` „Wochen“ (1–52), Fehler am Feld „Bitte gib 1 bis 52 Wochen ein.“

- [ ] **Step 1: Failing Test schreiben**

```ts
test('assigns a protected member field to another area', async () => {
  await admin.goto('/admin/contact-settings')
  await expect(admin).toHaveTitle('Kontakt-Einstellungen – Vereinsbote'); await expectNoA11yViolations(admin)
  const birthDateFor = (area: string) => admin.getByRole('checkbox', { name: `Geburtsdatum (Mitglieder) für ${area}` })
  await birthDateFor('Finanzen').check()
  await expect(admin.getByRole('status')).toHaveText('Geburtsdatum (Mitglieder): Mitglieder, Finanzen')
  await birthDateFor('Mitglieder').uncheck(); await birthDateFor('Finanzen').uncheck()
  await expect(admin.getByRole('alert')).toHaveText('Mindestens ein Bereich muss bleiben.')
  await expect(birthDateFor('Finanzen')).toBeChecked()
  await uli.reload()   // Uli liest Finanzen und sieht jetzt Geburtsdaten von Mitgliedern
  await expect(uli.getByText('Geburtsdatum')).toBeVisible()
})
```

- [ ] **Step 2: Test laufen lassen.** `vp run --filter web e2e` meldet FAIL.
- [ ] **Step 3: Seite, Server-Funktionen und Komponenten bauen.**
- [ ] **Step 4: Prüfen.** `vp test` und `vp run --filter web e2e` melden PASS, `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(contacts): add contact settings for admins`

---

### Task 14: Doku, Changeset und Abschluss

**Files:**
- Create: `.changeset/add-contacts.md`
- Modify: `README.md`, `AGENTS.md`, `CONTRIBUTING.md`

- [ ] **Step 1: Changeset anlegen** (`pnpm changeset`, `web`, `minor`):

```md
---
'web': minor
---

Add contacts and imports: members from the CSV or XLSX export of the membership software with a remembered column mapping, a preview with error list and a safety check before members are deleted; partners from their own export or maintained in the app with tags; protected fields per area and contact kind; suppressions and opt-outs that survive every import; and a weekly warning when the member data is out of date.
```

- [ ] **Step 2: Doku nachziehen.**
  - **`README.md`, „Operations“:**
    - Kontakteinstellungen auf `/admin/contact-settings`; Instanzen, die vor dieser Version eingerichtet wurden, wählen dort einmal Mitglieder- und Partner-Bereich.
    - Importdateien werden im Browser gelesen; nur zugeordnete Spalten erreichen den Server; höchstens 10 000 Zeilen.
    - Wöchentliche Warnung an aktive Admins bei alten Mitgliederdaten; bis Teilplan 4 nur über den Systemmailer, sonst wird der Fehlschlag protokolliert. Unter „Housekeeping“ den Tick-Schritt nennen.
  - **`README.md`, „End-to-end tests“:** die Projekte `fundament` und `contacts` (`contacts` hängt von `fundament` ab).
  - **`AGENTS.md`:**
    - „Plans“ um `…-02-kontakte.md` ergänzen.
    - Konventionen ergänzen:
      - Kontaktdaten nur über `loadContactAccess` ausliefern; geschützte Felder ohne Recht werden nicht geliefert.
      - Such- und Filterwerte nur per POST.
      - Import-Nutzlast als gzip-`FormData` (`encodeImportPayload`/`decodeImportPayload`, Grenzen in `server/contacts/import/payload.ts`).
      - „Heute“ ist `todayInClubZone`.
      - Testdaten sind erfunden, echte Exporte nie im Repository.
      - Jede E2E-Datei gehört zu einem Playwright-Projekt.
  - **`CONTRIBUTING.md`:** Regel zu erfundenen Testdaten; E2E-Projekte; XLSX-Dateien für Tests entstehen mit `write-excel-file`.
- [ ] **Step 3: Gesamtprüfung.**
  - `vp check` meldet 0 Fehler und 0 Warnungen.
  - `vp test` und `TEST_POSTGRES_URL=postgres://vereinsbote:vereinsbote@localhost:5432/vereinsbote vp test` melden PASS.
  - `vp test --coverage`: Jede neue Datei unter `server/` und `components/**/*.ts` ist abgedeckt.
  - `vp run --filter web e2e` meldet PASS.
  - `vp run --filter web build:node`, `build:vercel`, `build:cloudflare` laufen fehlerfrei, und `grep -rlE 'nodemailer|from "pg"|node_modules/(pg|pg-pool|pg-protocol)/' apps/web/dist/cloudflare` findet nichts.
  - `pnpm check:catalog`, `pnpm check:vite-plus` und `pnpm cve` enden mit Exit-Code 0.
  - `pnpm exec changeset status --since=origin/main` nennt `web` mit `minor`.
- [ ] **Step 4: Commit** – `docs(contacts): document contacts and import` (mit `.changeset/add-contacts.md`, `README.md`, `AGENTS.md`, `CONTRIBUTING.md`)
