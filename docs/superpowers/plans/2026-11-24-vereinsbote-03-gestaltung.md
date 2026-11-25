# Vereinsbote – Teilplan 3: Gestaltung und Rendering – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mails bekommen ihr Aussehen. Ein Admin stellt das CD ein, daraus entsteht ein Standard-Layout. Ehrenamtliche bauen Vorlagen im Klick-Editor und sehen die echte Mail daneben, Profis importieren HTML. Ein Render-Modul erzeugt einmal HTML und Nur-Text mit markierten Platzhaltern und setzt pro Empfänger nur noch maskierte Werte ein. Dazu kommen Bildspeicher, Bildauslieferung und die vollständige CSP.

**Architecture:**
- **Ein Render-Modul für Browser und Server** unter `apps/web/src/mail/**`, ohne Server-Importe. Es nutzt eigene Tabellen-Komponenten und `@react-email/render`. Die Live-Vorschau rendert im Browser und zeigt das Ergebnis in einem abgeschotteten Rahmen (`/preview-frame`) mit eigener CSP. Teilplan 4 rendert beim Versand mit demselben Modul.
- **Fachlogik in Modulen ohne Framework**, getestet mit PGlite: `server/storage`, `server/media`, `server/brand`, `server/templates`, `server/layouts`, `server/html-import`. Routen und Server-Funktionen bleiben dünne Hüllen.
- **Speicher:** Alles ist privat. Die App liefert Bilder unter `/media/<id>.<ext>` aus. Die Umsetzung hängt an der Build-Konstante: R2-Binding (Cloudflare), Vercel Blob (Vercel), S3 über `s3mini` (Node).

**Tech Stack:** wie Teilplan 2, dazu:
- `@react-email/render` (Rendern und `toPlainText`; nicht das Paket `react-email`)
- `@vercel/blob` und `s3mini`
- Tiptap 3: `@tiptap/core`, `@tiptap/react`, `@tiptap/pm` und die Erweiterungen für Absatz, Text, fett, kursiv, Link, Listen, Zeilenumbruch und Rückgängig
- HTML-Import: `hast-util-from-html`, `hast-util-sanitize`, `hast-util-to-html`, `css-tree` (mit `@types/css-tree`)
- nur Entwicklung: `simple-icons`
- Entwicklung und CI: SeaweedFS

Recherche-Stand der Versionen: 2026-11-24, siehe Design 5. Bei der Aufnahme gilt immer die neueste stabile Version.

**Spec:** `docs/superpowers/specs/2026-11-24-vereinsbote-03-gestaltung-design.md` (verbindlich; gilt vor der Master-Spec `docs/superpowers/specs/2026-11-23-vereinsbote-design.md`, Abschnitte 5, 6.5, 6.7, 7)
**Fahrplan und Glossar:** `docs/superpowers/plans/2026-11-23-vereinsbote-00-fahrplan.md`
**Branches:**
- **3a (Tasks 1–10):** `feat/design-foundation`. Enthält den Commit mit Design und Plan.
- **3b (Tasks 11–18):** `feat/templates-editor`, angelegt von `main`, nachdem 3a gemergt ist.

## Global Constraints

- **Grundlage:** Alle Global Constraints von Teilplan 1 und 2 und alle Regeln aus `AGENTS.md` gelten unverändert. Für diesen Teilplan besonders:
  - Vite+ (`vp`); pnpm-Catalog strikt (`"catalog:"`, `minimumReleaseAge: 1440`; ein neues Install-Skript braucht einen Eintrag in `allowBuilds` mit Grund); neueste stabile Versionen.
  - `@/`-Imports; alles, was Code ist, englisch (Glossar: `template`, `brand`, `layout`, `block`, `placeholder`, `area`); sichtbare Texte nur in `de.ts`/`en.ts`.
  - Jede Route mit `pageHead`. Formulare mit `PostForm` und `SubmitButton`.
  - Server-Funktionen mit zod, `requireRequestPrincipal` und Ablehnungen als Ergebnis; Server-Module nur in den Handlern importieren.
  - WCAG 2.2 AA mit axe in E2E; TDD.
- **Rechte (Design 4, 9, 15, 16):**
  - Vorlagen und Bildersammlung eines Bereichs: Ansehen und Vorschau ab `read`, Anlegen/Ändern/Duplizieren/Löschen/Hochladen ab `edit`.
  - CD, Logos und globale Layouts: Admin. „Die Admin-Rolle allein gibt keinen Zugriff“ auf Bereiche (Spec 6.7), also auch nicht auf Vorlagen.
- **Platzhalter (Design 10):**
  - Syntax `{{key}}` und `{{key | "Ersatztext"}}`. „Ohne Ersatztext ist ein Platzhalter Pflicht.“ Ein leerer Ersatztext macht ihn optional.
  - Kontaktdaten und `salutation` nur im Textinhalt, nie in Attributen, URLs oder `<style>`. CD-Werte werden beim Kompilieren eingesetzt.
  - „Werte werden in einem Durchgang eingesetzt und nie erneut ausgewertet.“
  - Globale Layouts: nur CD-Werte, Basisfelder und `content`.
- **Grenzen (Design):**
  - Betreff und Vorschautext je höchstens 200 Zeichen. Höchstens 100 Bausteine; Vorlage als JSON höchstens 256 KB.
  - Bild auf dem Server: JPEG oder PNG, höchstens 1200 × 4000 px und 2 MB. Im Browser auf höchstens 1200 px Breite verkleinert.
  - HTML-Import: höchstens 500 KB, Warnung ab 102 KB.
  - Höchstens 5 weitere Fußzeilen-Links.
  - Kontrastschwelle 4,5:1.
  - `/media`-Cache höchstens einen Tag.
  - Link-Schemata: CD nur `https:`/`mailto:`; Vorlagen `https:`/`mailto:`/`tel:`.
- **Datenschutz:**
  - Keine Kontaktdaten, Vorlagen-Inhalte oder Zugangsdaten in Logs, URLs oder Fehlermeldungen; Logs nur über `errorLabel`.
  - Das Aktivitätsprotokoll nennt IDs, keine Inhalte.
  - Mails aus dem Klick-Editor laden nichts von Dritten.
  - Testdaten sind erfunden (`example.org`, `*.example`).
- **Plattform:**
  - Alles unter `src/mail/**` läuft im Browser, auf Workers und auf Node: keine Node-Module, kein `eval`/`new Function`.
  - `@vercel/blob` nur hinter `import.meta.env.VITE_VB_PLATFORM === 'vercel'`, `s3mini` nur hinter `=== 'node'` (oder unter `vp dev`). Beide dynamisch importiert, wie `pg` und `nodemailer`.
- **Sonar-Abdeckung:**
  - Neue Logik steht in reinen Modulen mit Unit-Tests.
  - `src/mail/**/*.tsx` ist nicht ausgenommen; die Snapshot-Tests decken es ab.
  - Routen, `components/**/*.tsx` und `functions/**` prüft das E2E.
- **Fertig heißt:**
  - `vp check` meldet 0 Fehler und 0 Warnungen. `vp test` ist grün, mit `TEST_POSTGRES_URL` und `TEST_S3_URL` ebenso. `vp run --filter web e2e` ist grün.
  - Jede neue Seite hat `pageHead` und einen axe-Check. Kein E2E-Test sieht eine CSP-Verletzung.
- **Commits:** GitButler, nie `git add`/`git commit`, nie `-s`, **keine `Co-Authored-By`-Zeile**. Jeder Task endet mit:

```bash
but commit -b <branch> -F - <die Dateien aus „Files“ dieses Tasks, inkl. erzeugter Migrationen und pnpm-lock.yaml> <<'EOF'
<type>(<scope>): <beschreibung, höchstens 50 Zeichen, klein, ohne Punkt>
EOF
```

- **Release und Doku:**
  - Je PR ein `minor`-Changeset (`web`).
  - `README.md`, `AGENTS.md` und `CONTRIBUTING.md` ziehen Task 10 (3a) und Task 18 (3b) nach.

## Entscheidungen dieses Plans

Was das Design dem Builder überlässt (Design 23), hier festgelegt:

1. **Markierungen beim Kompilieren:**
   - Jeder Kontakt-Platzhalter wird vor dem Rendern durch `U+E000 <Index> U+E001` ersetzt. Der Index zeigt in die Platzhalter-Tabelle der kompilierten Mail.
   - Aus allen Texten der Vorlage werden `U+E000` und `U+E001` vorher entfernt, damit niemand eine Markierung fälschen kann.
   - HTML und Nur-Text werden danach an den Markierungen in Teile zerlegt. Werte kommen erst beim Füllen hinein und werden nie geparst.
   - CD-Werte werden vor dem Rendern eingesetzt.
2. **Leere Werte:** Ein leerer Text (`''`, auch nach `trim`) zählt beim Füllen als fehlend.
3. **CD:** eine Zeile `brand_settings` mit `settings jsonb` (zod-geprüft), `version integer` und Änderungszeit und -person. Ohne Zeile gilt `DEFAULT_BRAND`, `configured: false`.
4. **Bilder:**
   - Tabelle `media`. Die ID hat 22 Zeichen base64url (16 Zufallsbytes) und ist Primärschlüssel.
   - Speicherschlüssel `media/<id>`, Dateiname `<id>.jpg` bzw. `<id>.png`.
   - Die Nutzung führt `template_media`, beim Speichern aus Bausteinen und HTML ermittelt. Ein Fremdschlüssel `on delete restrict` sperrt das Löschen eines genutzten Bilds.
5. **Layout-Nutzung:** Die Spalte `templates.shared_layout_id` (Fremdschlüssel `on delete restrict`) spiegelt die Wahl eines globalen Layouts.
6. **Vorschau-Rahmen:**
   - Der Rahmen ist sandboxed und hat deshalb eine opake Herkunft. Beim Laden öffnet er einen `MessageChannel` und meldet `{ type: 'vb-preview-ready' }` per `window.parent.postMessage` mit der Herkunft von `APP_URL` als Ziel und `port2` als Transfer: Nur ein Elternfenster dieser Herkunft bekommt den Port.
   - Das Elternfenster nimmt die Meldung nur an, wenn `source` das Fenster des Rahmens ist, `origin` `'null'` (so heißt eine opake Herkunft in einem Nachrichtenereignis), die Daten passen und ein Port dabei ist. Es behält den Port und schickt `{ type: 'vb-preview', html }` darauf. Eine neue Meldung (der Rahmen lädt neu) ersetzt den Port und schließt den alten; das Aushängen schließt ihn ebenfalls. Nichts geht an `'*'`.
   - Der Rahmen nimmt HTML nur auf seinem Port an, keine Nachricht am Fenster. Er ersetzt den Inhalt von `document.documentElement` durch Kopf und Körper aus `DOMParser`.
7. **`/media`-Cache:** `Cache-Control: public, max-age=86400`. Auf Vercel zusätzlich `CDN-Cache-Control: public, max-age=86400`. Auf Workers kein Cache-API-Aufwand, R2-Lesen ist billig.
8. **caniemail-Auszug:** CSS-Eigenschaften und -Funktionen, die „Outlook Windows“ (klassisch) laut caniemail nicht unterstützt (`n`). JSON `apps/web/src/server/html-import/caniemail-outlook.json` mit Quelle, Lizenz (MIT) und Datum. Erzeugt von `apps/web/scripts/update-caniemail.ts`, das von Hand laufen gelassen wird.
9. **Social-Media-Icons:**
   - Plattformen: `instagram`, `facebook`, `youtube`, `tiktok`, `linkedin`, `mastodon`, `bluesky`, `threads`, `x`, `whatsapp`.
   - Erkennung über den Host (inklusive `www.`; Mastodon über den Pfad `/@name` auf jedem Host).
   - Varianten `dark` (`#1f2937`), `light` (`#ffffff`), `brand` (Farbe aus `simple-icons`), je 48 × 48 px PNG, angezeigt in 24 px.
   - Erzeugt von `apps/web/scripts/build-social-icons.ts` (`simple-icons`, gerastert mit Playwright-Chromium) nach `apps/web/public/social/<platform>-<variant>.png`. Die Dateien werden eingecheckt; Lizenzhinweis CC0 und Markenhinweis im README.
10. **Vorschau verzögert** um 300 ms nach der letzten Änderung. Auf schmalen Bildschirmen (unter 1024 px) liegt sie auf einem Reiter.
11. **Beispielmails im E2E:** Mailpits HTML-Prüfung (`GET /api/v1/message/{id}/html-check`, `Total.Supported`) ergibt mindestens 80 % für jede Beispielmail.
12. **E2E-Projekte:** `design` (3a, hängt von `fundament` ab) und `templates` (3b, hängt von `contacts` und `design` ab).
13. **Vorschaukontakte:** Die Suche nutzt `listContacts` (Seite 1, höchstens 10 Treffer) und liefert nur ID, Art und Anzeigename.
14. **Bilder in den Beispielmails** (`mail:sample`) gehen als Inline-Anhänge (`cid:`) mit, weil echte Postfächer `localhost` nicht erreichen.

## Review Focus

1. **Werte, die wie Platzhalter oder Markierungen aussehen:** Ein Vorname `{{contact.email}}` oder mit `U+E000 0 U+E001` erscheint wörtlich in Mail und Betreff; nichts wird ersetzt. Tests in Task 5 und Task 7.
2. **Gefährliche Zeichen in Namen:** `Anna <b>&"'` erscheint im HTML maskiert, im Nur-Text unverändert. Ein Zeilenumbruch im Wert wird im Betreff zum Leerzeichen und kann keine Kopfzeile anhängen. Tests in Task 5 und Task 7.
3. **Zwei gleichzeitige Speichervorgänge** (zwei Tabs, zwei Admins) an derselben Vorlage oder am CD: Der zweite wird mit „geändert“ abgelehnt, nichts geht still verloren. Tests in Task 6 und Task 11.
4. **Ungewöhnliche Bilder:**
   - Ein 20-MB-Handyfoto im Hochformat mit EXIF-Drehung ergibt ein richtig gedrehtes JPEG mit höchstens 1200 px Breite. Ein PNG mit Transparenz bleibt PNG.
   - Ein Banner mit 1 × 10 000 px wird abgelehnt.
   - Eine als `.png` umbenannte HTML-Datei lehnt der Server ab, auch wenn der Browser umgangen wird.
   - Tests in Task 3 und Task 4.
5. **Feldschutz ändert sich nach dem Speichern:** Ein Admin nimmt dem Bereich das Geburtsdatum. Danach liefert die Vorschau mit echtem Kontakt den Wert nicht mehr, der Ersatztext greift bzw. die Vorschau zeigt den Fehler, und der Editor meldet den Platzhalter beim Speichern. Tests in Task 11 und Task 15.

Die Dateien stehen im Block **Files** jedes Tasks. Tests liegen neben dem Code, E2E unter `apps/web/e2e`.

---

# Teil 3a – Fundament der Gestaltung (`feat/design-foundation`)

### Task 1: Content-Security-Policy und zod `jitless`

**Files:**
- Create: `apps/web/src/platform/csp-nonce.ts`, `apps/web/src/zod-config.ts`, `apps/web/e2e/helpers/test.ts`
- Modify:
  - `apps/web/src/platform/security-headers.ts`, `apps/web/src/start.ts` (die Middleware `securityHeaders` setzt die Kopfzeilen pro Route)
  - `apps/web/src/router.tsx` (`ssr: { nonce }`, erster Import `./zod-config`)
  - `apps/web/src/platform/static-headers.ts` (zusätzlich `/social/**`)
  - `apps/web/e2e/fundament.e2e.ts`, `apps/web/e2e/contacts.e2e.ts` (importieren `test` aus `./helpers/test`)
- Test: `apps/web/src/platform/security-headers.test.ts`, `apps/web/src/platform/csp-nonce.test.ts`, `apps/web/src/platform/static-headers.test.ts` (Ergänzung)

**Interfaces:**
- Consumes: `getRequest`, `setResponseHeaders` (Start), `getAppEnv`
- Produces:

```ts
// platform/csp-nonce.ts
export function cspNonceFor(request: object): string      // 16 Zufallsbytes, base64; pro Request-Objekt stabil (WeakMap)
// platform/security-headers.ts
export const BASE_SECURITY_HEADERS: Readonly<Record<string, string>>   // referrer-policy, x-content-type-options, x-frame-options DENY, csp frame-ancestors 'none'
export type HeaderRoute = 'page' | 'previewFrame' | 'media'
export function headerRouteOf(pathname: string): HeaderRoute   // '/preview-frame' → previewFrame; '/media/…' → media
export function securityHeadersFor(route: HeaderRoute, options: Readonly<{ nonce: string; https: boolean }>): Record<string, string>
// e2e/helpers/test.ts
export const test   // @playwright/test erweitert um eine automatische Fixture, die `securitypolicyviolation` sammelt und am Testende leer erwartet
export { expect } from '@playwright/test'
```

**Policies:** genau die Direktiven aus Design 17.
- **`page`:** `default-src 'self'; script-src 'nonce-…' 'strict-dynamic'; style-src-elem 'self' 'nonce-…'; style-src-attr 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. Mit `https` zusätzlich `upgrade-insecure-requests`.
- **`previewFrame`:** die Policy aus Design 17 und `x-frame-options: SAMEORIGIN`.
- **`media`:** `default-src 'none'; sandbox` und `cross-origin-resource-policy: cross-origin`.
- **Dev:** Unter `import.meta.env.DEV` darf `page` `'unsafe-inline'` in `script-src` und `style-src-elem` bekommen, falls Vites Client es verlangt. Build und E2E laufen ohne.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// security-headers.test.ts
it('sends a nonce-based page policy without unsafe-eval', () => {
  const csp = securityHeadersFor('page', { https: true, nonce: 'abc' })['content-security-policy']
  expect(csp).toContain("script-src 'nonce-abc' 'strict-dynamic'"); expect(csp).toContain("style-src-attr 'unsafe-inline'")
  expect(csp).toContain('upgrade-insecure-requests'); expect(csp).not.toMatch(/unsafe-eval/u)
})
it('lets only the app frame the preview', () => { /* previewFrame: frame-ancestors 'self', x-frame-options SAMEORIGIN, style-src 'unsafe-inline' */ })
it('sandboxes images', () => { /* media: default-src 'none'; sandbox, cross-origin-resource-policy cross-origin */ })
it.each([['/preview-frame', 'previewFrame'], ['/media/abc.png', 'media'], ['/', 'page'], ['/mediathek', 'page']])('routes %s', …)
// csp-nonce.test.ts
it('keeps one nonce per request and differs between requests', () => { /* gleiches Objekt → gleicher Wert; zwei Objekte → verschieden; /^[A-Za-z0-9+/]{22}==$/ */ })
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/platform` meldet FAIL.
- [ ] **Step 3: Umsetzen.**
  - `securityHeaders` in `start.ts` liest `getRequest()` und setzt `securityHeadersFor(headerRouteOf(url.pathname), { nonce: cspNonceFor(request), https: appUrl.protocol === 'https:' })`.
  - `getRouter` setzt `ssr: { nonce }` über `createIsomorphicFn().server(() => cspNonceFor(getRequest()))` (Muster: TanStack/router `e2e/react-start/csp`; Nonce beim Erzeugen setzen, Issue #8789).
  - `zod-config.ts` ruft `z.config({ jitless: true })` auf; es ist der erste Import in `router.tsx` und `start.ts`.
  - Die E2E-Fixture registriert per `page.addInitScript` einen Listener auf `securitypolicyviolation`, der in `window.__cspViolations` sammelt, und prüft am Ende `[]`.
- [ ] **Step 4: Prüfen.**
  - `vp test run apps/web/src/platform` meldet PASS.
  - `vp run --filter web e2e` ist grün mit der Fixture. Damit laufen auch Import (read-excel-file, papaparse, fflate) und Anmeldung unter voller CSP.
  - `vp check` meldet 0/0.
- [ ] **Step 5: Commit** – `feat(security): add content security policy`

---

### Task 2: Speicher-Schnittstelle, Umsetzungen und SeaweedFS

**Files:**
- Create:
  - `apps/web/src/server/storage/{storage,memory,r2,vercel-blob,s3,open-storage}.ts`
  - `apps/web/src/server/storage/storage-contract.ts` (gemeinsame Testfälle für alle Umsetzungen)
- Modify:
  - `apps/web/src/server/env.ts` (`S3_*`, `BLOB_READ_WRITE_TOKEN`)
  - `apps/web/src/platform/context.ts`:
    - `AppContext.storage: ObjectStorage | null`.
    - Auf Cloudflare gehen nur String-Bindings an `parseEnv` (wie `variablesOf` in `cloudflare-worker.ts`), das R2-Binding `MEDIA_BUCKET` getrennt.
  - `apps/web/wrangler.jsonc` (`r2_buckets`: `binding: "MEDIA_BUCKET"`, `bucket_name: "vereinsbote-media"`, `jurisdiction: "eu"`)
  - `docker/compose.dev.yml` (Dienst `seaweedfs`: `weed mini`, Port `127.0.0.1:8333`, Bucket `vereinsbote`, per Digest gepinnt)
  - `.github/workflows/ci.yml` (SeaweedFS-Dienst im `test`- und `e2e`-Job; `TEST_S3_URL` im `test`-Job)
  - `apps/web/.env.example`, `apps/web/e2e/env.ts` (`S3_*` auf SeaweedFS)
  - `pnpm-workspace.yaml`, `apps/web/package.json` (`@vercel/blob`, `s3mini`)
- Test: `apps/web/src/server/storage/{memory,r2,vercel-blob,s3,open-storage}.test.ts`, `apps/web/src/server/storage/s3.seaweedfs.test.ts`, `apps/web/src/server/env.test.ts` (Ergänzung)

**Interfaces:**
- Consumes: `Env`, `parseEnv`, `platformName`
- Produces:

```ts
// storage/storage.ts
export interface StoredObject { body: ReadableStream<Uint8Array>; contentType: string; size: number }
export interface ObjectStorage {
  put(key: string, bytes: Uint8Array, options: Readonly<{ contentType: string }>): Promise<void>
  get(key: string): Promise<StoredObject | null>
  delete(key: string): Promise<void>          // fehlender Schlüssel ist kein Fehler
}
export class StorageNotConfiguredError extends Error {}
// storage/memory.ts (Tests)          export function createMemoryStorage(): ObjectStorage
// storage/r2.ts                      export interface R2BucketLike { put; get; delete }   // Teilmenge von R2Bucket
//                                    export function createR2Storage(bucket: R2BucketLike): ObjectStorage
// storage/vercel-blob.ts             export interface VercelBlobClient { put; get; del }  // die Funktionen aus '@vercel/blob'
//                                    export function createVercelBlobStorage(client: VercelBlobClient, token: string): ObjectStorage
// storage/s3.ts                      export interface S3Config { endpoint: URL; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }
//                                    export function createS3Storage(config: S3Config): Promise<ObjectStorage>   // importiert s3mini dynamisch
// storage/open-storage.ts            export function openStorage(env: Env, bindings: Readonly<Record<string, unknown>> | null): Promise<ObjectStorage | null>
// env.ts (Env ergänzt)               s3: S3Config | null; blobToken: string | null
```

**Regeln:**
- **`S3_*`:** alle fünf oder keine (wie `MS_LOGIN_*`). `S3_ENDPOINT` muss `https:` sein; `http:` nur für `localhost`/`127.0.0.1`.
- **`openStorage`:**
  - `cloudflare` → R2, wenn `MEDIA_BUCKET` ein Objekt ist.
  - `vercel` → Blob mit `blobToken`, privater Zugriff (`access: 'private'`, `addRandomSuffix: false`, `allowOverwrite: false`).
  - `node` → S3.
  - Sonst `null`.
- **Fehler:** Die Umsetzungen werfen eigene Fehler ohne Schlüssel, Werte oder Zugangsdaten in der Meldung.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// storage-contract.ts: export function describeStorageContract(name: string, open: () => Promise<ObjectStorage>): void
//   'stores and reads bytes with their type' (put → get: Bytes gleich, contentType 'image/png', size 4)
//   'returns null for a missing key'; 'deletes, and deleting twice is fine'
// memory.test.ts / r2.test.ts (Fake-Bucket) / vercel-blob.test.ts (Fake-Client; prüft access 'private') rufen describeStorageContract
// s3.seaweedfs.test.ts: describe.skipIf(!TEST_S3_URL)('S3 against SeaweedFS (needs TEST_S3_URL)') + describeStorageContract
// env.test.ts
it('needs all S3 variables or none', …)   // nur S3_BUCKET → EnvError(['S3_ENDPOINT', …])
it('refuses plain http for S3 except locally', …)   // http://s3.example → EnvError; http://localhost:8333 → ok
// open-storage.test.ts: je Plattform die richtige Umsetzung (Plattformname als Parameter injiziert), ohne Konfiguration null
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/server/storage apps/web/src/server/env.test.ts` meldet FAIL.
- [ ] **Step 3: Umsetzen.**
  - Pakete in den Catalog. `TEST_S3_URL` hat die Form `http://<key>:<secret>@localhost:8333/vereinsbote`.
  - Den CI-Bundle-Check um `s3mini` und `@vercel/blob` im Cloudflare-Bundle erweitern.
- [ ] **Step 4: Prüfen.**
  - `docker compose -f docker/compose.dev.yml up -d`.
  - `TEST_S3_URL=… vp test run apps/web/src/server/storage` meldet PASS, auch den SeaweedFS-Teil.
  - `vp run --filter web build:cloudflare` und der Bundle-Check finden weder `s3mini` noch `@vercel/blob`.
- [ ] **Step 5: Commit** – `feat(storage): add object storage adapters`

---

### Task 3: Bilder speichern und unter `/media` ausliefern

**Files:**
- Create:
  - `apps/web/src/server/db/schema/media.ts`
  - `apps/web/src/server/media/{ids,image-header,media}.ts`
  - `apps/web/src/functions/media.ts`
  - `apps/web/src/routes/media/$file.ts`
- Modify: `apps/web/src/server/db/schema/index.ts`, `apps/web/src/server/audit/audit.ts` (`'media.uploaded'`, `'media.deleted'`), Migration `apps/web/drizzle/0008_*.sql` (erzeugt)
- Test: `apps/web/src/server/media/{ids,image-header,media}.test.ts`

**Interfaces:**
- Consumes: `ObjectStorage`, `createMemoryStorage` (Task 2); `assertAdmin`, `assertArea`, `writeAudit`, `createTestDb`, `setUpClub`, `userWith`
- Produces:

```ts
// media/ids.ts — ohne Server-Importe
export function newMediaId(): string                         // 22 Zeichen base64url
export type ImageType = 'jpeg' | 'png'
export function mediaFileName(id: string, type: ImageType): string            // '<id>.jpg' | '<id>.png'
export function parseMediaFileName(file: string): { id: string; type: ImageType } | null
export function mediaPath(id: string, type: ImageType): string                // '/media/<file>'
// media/image-header.ts — ohne Server-Importe
export interface ImageHeader { type: ImageType; width: number; height: number }
export function readImageHeader(bytes: Uint8Array): ImageHeader | null        // PNG IHDR, JPEG SOF0–SOF15 (ohne DHT/DAC)
// media/media.ts
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; export const MAX_IMAGE_WIDTH = 1200; export const MAX_IMAGE_HEIGHT = 4000
export type MediaPurpose = 'brand' | 'library'
export interface MediaRecord { id: string; purpose: MediaPurpose; areaId: string | null; type: ImageType; width: number; height: number; bytes: number; name: string; createdAt: Date }
export class InvalidImageError extends Error {}   // Signatur, Typ, Maße oder Größe
export function storeImage(db: Db, storage: ObjectStorage, actor: Principal,
  target: Readonly<{ purpose: 'brand' } | { purpose: 'library'; areaId: string }>,
  file: Readonly<{ name: string; bytes: Uint8Array }>): Promise<MediaRecord>
export function openMedia(db: Db, storage: ObjectStorage, file: string): Promise<{ record: MediaRecord; object: StoredObject } | null>
export function mediaResponse(found: Awaited<ReturnType<typeof openMedia>>, method: 'GET' | 'HEAD', platform: PlatformName): Response
// functions/media.ts
export const uploadImage   // POST FormData { file, purpose, areaId? } → { ok: true; media: MediaRecord } |
                           // { ok: false; failure: 'invalidImage' | 'storageMissing' | 'gone' }
```

**Schema `media`:**
- Spalten: `id text pk`, `purpose text not null` (check `brand`/`library`), `area_id uuid references areas(id) on delete restrict`, `type text not null` (check `jpeg`/`png`), `width`, `height`, `bytes integer not null`, `name text not null` (bereinigter Dateiname ohne Pfad, höchstens 200 Zeichen), `created_by_user_id text references user(id) on delete set null`, `created_at timestamptz`.
- Check: `(purpose = 'library') = (area_id is not null)`.

**Regeln:**
- **Rechte:** `brand` braucht Admin; `library` braucht `edit` im Bereich (`ForbiddenError`). Ein unbekannter Bereich ergibt `UnknownAreaError`.
- **Prüfung:** Typ und Maße kommen aus `readImageHeader`, nicht aus Dateiname oder `File.type`.
- **Reihenfolge:** erst den Speicher schreiben, dann die Zeile. Schlägt die Zeile fehl, wird das Objekt gelöscht.
- **Protokoll:** `media.uploaded`, Ziel `media:<id>`, Details `{ purpose, areaId }`.
- **`mediaResponse`:**
  - 404 mit leerem Körper bei `null`.
  - Sonst Typ, Länge, `Cache-Control`/`CDN-Cache-Control` (Entscheidung 7), `Content-Disposition: inline` und die `media`-Kopfzeilen aus Task 1.
  - `HEAD` ohne Körper.
- **Route:** `/media/$file` ruft `openMedia` mit `getAppContext().storage`. Ohne Speicher antwortet sie mit 404.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// ids.test.ts: newMediaId() 1000× → /^[\w-]{22}$/ und alle verschieden; parseMediaFileName('x.gif'), ('../a.png'), ('<22>.png.png') → null
// image-header.test.ts (Bytes im Test gebaut): PNG 1200×800 → { png, 1200, 800 }; JPEG mit APP1(EXIF) vor SOF2 → richtige Maße;
//   HTML-Text, 'GIF89a…', abgeschnittenes PNG, JPEG ohne SOF → null
// media.test.ts
it('stores a library image for editors of the area', …)   // edit → Zeile + Objekt 'media/<id>', Protokoll media.uploaded
it('refuses readers, other areas and non-admins for brand images', …)
it('refuses what is no JPEG or PNG, whatever its name says', …)   // 'logo.png' mit HTML-Bytes → InvalidImageError, kein Objekt
it.each([[1201, 100], [1, 10_000]])('refuses %d×%d pixels', …)   // Review Focus 4
it('refuses more than 2 MB', …)
it('removes the object when the row cannot be written', …)
it('serves an image with cache and sandbox headers and nothing for unknown files', …)   // mediaResponse
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/server/media` meldet FAIL.
- [ ] **Step 3: Umsetzen.** `vp run --filter web db:generate`.
- [ ] **Step 4: Prüfen.** `vp test run apps/web/src/server/media apps/web/src/server/db` meldet PASS. `vp check` meldet 0/0.
- [ ] **Step 5: Commit** – `feat(media): store and serve images`

---

### Task 4: Bildverarbeitung im Browser

**Files:**
- Create: `apps/web/src/components/images/{process-image,browser-image,image-size}.ts`, `apps/web/src/components/images/image-upload.tsx`
- Modify: `apps/web/src/i18n/de.ts`, `en.ts`
- Test: `apps/web/src/components/images/{process-image,image-size}.test.ts`

**Interfaces:**
- Consumes: `uploadImage` (Task 3), `MAX_IMAGE_WIDTH`, `MAX_IMAGE_HEIGHT`, `settle`
- Produces:

```ts
// image-size.ts
export function fitWidth(size: Readonly<{ width: number; height: number }>, maxWidth: number): { width: number; height: number }
export function chooseOutputType(hasAlpha: boolean): 'image/jpeg' | 'image/png'
export const JPEG_QUALITY = 0.85
// process-image.ts
export interface DecodedImage {
  width: number; height: number; hasAlpha: boolean; animated: boolean; isSvg: boolean
  encode(type: 'image/jpeg' | 'image/png', quality: number, width: number, height: number): Promise<Blob>
}
export interface ImageDeps { decode(file: Blob): Promise<DecodedImage | null> }   // im Test gefälscht, im Browser aus browser-image.ts
export type ProcessResult =
  | { ok: true; blob: Blob; name: string; width: number; height: number; before: number; after: number; flattenedGif: boolean }
  | { ok: false; reason: 'unreadable' | 'svgNotAllowed' | 'tooTall' | 'tooLarge' }
export function processImage(file: File, options: Readonly<{ allowSvg: boolean }>, deps?: ImageDeps): Promise<ProcessResult>
// image-upload.tsx
export function ImageUpload(props: { target: { purpose: 'brand' } | { purpose: 'library'; areaId: string }; allowSvg: boolean; onUploaded(media: MediaRecord): void }): ReactNode
```

**Regeln:**
- **Dekodieren:** `createImageBitmap(file, { imageOrientation: 'from-image' })`, also mit angewandter EXIF-Drehung. SVG (nur mit `allowSvg`) über `<img>` und Canvas.
- **Verkleinern** mit `fitWidth(…, 1200)`.
- **Kodieren:** `chooseOutputType(hasAlpha)`, JPEG mit `JPEG_QUALITY`. Ist das Ergebnis höher als 4000 px: `tooTall`; größer als 2 MB: `tooLarge`.
- **GIF** wird zum Standbild (`flattenedGif: true`, Hinweis im Dialog).
- **Dateiname:** Er endet auf `.jpg`/`.png`.
- **`ImageUpload`:**
  - `FileTrigger` und Ablagefläche (`DropZone`), beides per Tastatur bedienbar.
  - Der Live-Bereich meldet „Bild verkleinert: {before} → {after}“ bzw. den Grund des Fehlschlags.
  - Danach `uploadImage` mit `settle`.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// image-size.test.ts: fitWidth({4000,3000},1200) → {1200,900}; fitWidth({800,600},1200) → {800,600}; chooseOutputType(true) → 'image/png'
// process-image.test.ts (Fake-Deps)
it('turns a large photo into a JPEG of at most 1200 px', …)    // 4032×3024 → encode('image/jpeg', 0.85, 1200, 900), name 'urlaub.jpg'
it('keeps transparency as PNG', …)
it('refuses SVG unless allowed', …)                            // allowSvg false → svgNotAllowed
it('refuses an image taller than 4000 px after resizing', …)  // 1×10000 → tooTall (Review Focus 4)
it('flattens an animated GIF and says so', …)
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/components/images` meldet FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** `vp test run apps/web/src/components/images` meldet PASS. `vp check` meldet 0/0.
- [ ] **Step 5: Commit** – `feat(media): process images in the browser`

---

### Task 5: Platzhalter, Briefanrede und Maskierung

**Files:**
- Create:
  - `apps/web/src/mail/escape.ts`
  - `apps/web/src/mail/placeholders/{syntax,registry,salutation,contact-values}.ts`
  - `apps/web/src/server/contacts/placeholder-key.ts`
- Modify:
  - `apps/web/src/server/db/schema/contacts.ts`: `custom_fields.placeholder_key text not null`, eindeutig pro `(kind, placeholder_key)`.
  - `apps/web/src/server/contacts/import/plan.ts` (neues Zusatzfeld bekommt einen Schlüssel), `apps/web/src/server/contacts/settings.ts` (`CustomFieldRecord.placeholderKey`)
  - Migration `0009_*.sql` (erzeugt, plus Füllen vorhandener Zeilen)
- Test: `apps/web/src/mail/escape.test.ts`, `apps/web/src/mail/placeholders/{syntax,registry,salutation,contact-values}.test.ts`, `apps/web/src/server/contacts/placeholder-key.test.ts`, `apps/web/src/server/contacts/import/members.test.ts` (Ergänzung)

**Interfaces:**
- Consumes: `ContactKind`, `Gender`, `FieldKey`, `CustomFieldRecord`, `ContactRecord`, `formatCalendarDate`
- Produces:

```ts
// mail/escape.ts
export function escapeHtml(value: string): string                      // & < > " '
export function cleanHeaderText(value: string): string                 // Steuerzeichen raus, \r\n|\r|\n → ' ', trim
export function stripMarkers(value: string): string                    // entfernt U+E000 und U+E001
// mail/placeholders/syntax.ts
export interface PlaceholderRef { key: string; fallback: string | null }   // null = Pflicht, '' = optional
export type TextSegment = { kind: 'text'; value: string } | { kind: 'placeholder'; ref: PlaceholderRef }
export type ParseResult = { ok: true; segments: TextSegment[] } | { ok: false; error: 'unclosed' | 'invalidKey' | 'invalidFallback'; index: number }
export function parsePlaceholders(text: string): ParseResult            // Schlüssel /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9_]*)*$/
export function formatPlaceholder(ref: PlaceholderRef): string          // Gegenstück für Import und Tests
// mail/placeholders/registry.ts
export type PlaceholderGroup = 'contact' | 'brand' | 'salutation' | 'layout'
export interface PlaceholderDefinition { key: string; group: PlaceholderGroup; labelKey: MessageKey; field: FieldKey | null; base: boolean; context: 'text' | 'attribute' }
export const BUILTIN_PLACEHOLDERS: readonly PlaceholderDefinition[]    // die Liste aus Design 10.1 und 7
export function customPlaceholderKey(placeholderKey: string): string   // 'contact.custom.<key>'
export const CONTENT_KEY = 'content'; export const SALUTATION_KEY = 'salutation'
// mail/placeholders/salutation.ts
export type SalutationForm = 'du' | 'sie'
export type SalutationCase = 'female' | 'male' | 'other' | 'organization' | 'noName'
export type SalutationTexts = Readonly<Record<SalutationCase, string>>
export const DEFAULT_SALUTATIONS: Readonly<Record<SalutationForm, SalutationTexts>>   // Tabelle Design 10.3, Texte mit {{contact.firstName}} usw.
export function salutationFor(texts: SalutationTexts, contact: Readonly<{ gender: Gender; firstName: string | null; lastName: string | null; organization: string | null }>): string
// mail/placeholders/contact-values.ts
export interface ContactValueSource extends Pick<ContactRecord, 'kind' | 'firstName' | 'lastName' | 'organization' | 'email' | 'memberNumber'
  | 'customerNumber' | 'gender' | 'groups' | 'tags' | 'birthDate' | 'entryDate' | 'exitDate' | 'street' | 'postalCode' | 'city' | 'customValues'> {}
export function contactPlaceholderValues(contact: Readonly<ContactValueSource>, delivered: ReadonlySet<FieldKey>,
  customFields: readonly CustomFieldRecord[], salutation: SalutationTexts): Map<string, string>
// server/contacts/placeholder-key.ts
export function placeholderKeyFromName(name: string, taken: ReadonlySet<string>): string   // 'Mitglied seit (alt)' → 'mitgliedSeitAlt', bei Kollision 'mitgliedSeitAlt2'
```

**Regeln:**
- **Briefanrede:**
  - `organization`: Firma gesetzt und Vorname leer.
  - `noName`: Der Text des Falls braucht einen Namen (er enthält `contact.firstName` oder `contact.lastName`), und der ist leer.
  - `other` gilt für `diverse` und `unspecified`.
- **`contactPlaceholderValues`:**
  - Basisfelder immer. Geschützte Felder nur, wenn ihr `FieldKey` in `delivered` steht; Adressteile hängen an `address`.
  - Zusatzfelder per `placeholderKey`, Datumstypen formatiert.
  - Gruppen und Schlagworte mit `', '` verbunden, Datumsfelder als `TT.MM.JJJJ`.
  - `salutation` ist immer gesetzt. Leere Werte fehlen in der Map.
- **Migration:** Sie füllt `placeholder_key` für vorhandene Zeilen mit derselben Regel wie `placeholderKeyFromName`, in SQL oder per Datenmigrations-Schritt im erzeugten SQL.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// syntax.test.ts
it.each([
  ['Hallo {{contact.firstName}}!', [text 'Hallo ', ph {contact.firstName, null}, text '!']],
  ['{{contact.city | "unbekannt"}}', [ph {contact.city, 'unbekannt'}]], ['{{contact.city | ""}}', [ph {contact.city, ''}]],
  ['{{ salutation }}', [ph {salutation, null}]], ['a {{x', error unclosed], ['{{1a}}', invalidKey], ['{{a | unquoted}}', invalidFallback],
  ['{{a | "mit \\" Anführung"}}', ph fallback 'mit " Anführung'],
])('parses %s', …)
// escape.test.ts
it('escapes the five HTML characters, backslashes stay', …)   // `Anna <b>&"'\` → `Anna &lt;b&gt;&amp;&quot;&#39;\` (Review Focus 2)
it('turns line breaks in header text into spaces', …)          // 'A\r\nBcc: x' → 'A Bcc: x'
// salutation.test.ts: it.each über die ganze Matrix aus Design 10.3 (du/sie × female/male/diverse/unspecified/Firma/ohne Namen)
//   z. B. sie + female + lastName null → 'Guten Tag'; du + Firma 'Bäckerei Körner GmbH' ohne Vorname → 'Sehr geehrte Damen und Herren'
// contact-values.test.ts
it('delivers protected fields only when the area may see them', …)   // delivered ohne 'birthDate' → kein contact.birthDate
it('formats dates, joins groups and names custom fields by key', …)  // '1980-05-17' → '17.05.1980'; ['Fußball','Tennis'] → 'Fußball, Tennis'
it('leaves out empty values', …)
// placeholder-key.test.ts: 'Mitglied seit (alt)' → 'mitgliedSeitAlt'; 'Größe' → 'groesse'; '123' → 'field123'; Kollision → …2
// members.test.ts (Ergänzung): ein neues Zusatzfeld aus der Zuordnung hat placeholderKey
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/mail apps/web/src/server/contacts` meldet FAIL.
- [ ] **Step 3: Umsetzen.** `vp run --filter web db:generate`. Danach ergänzt die Migration das Füllen vorhandener Zeilen vor dem `not null`.
- [ ] **Step 4: Prüfen.** Dieselben Tests und `apps/web/src/server/db` melden PASS. `vp check` meldet 0/0.
- [ ] **Step 5: Commit** – `feat(mail): add placeholders and salutation`

---

### Task 6: CD (Modell, Kontrast, Schriften, Social Links)

**Files:**
- Create:
  - `apps/web/src/server/db/schema/brand.ts`
  - `apps/web/src/mail/brand/{brand-schema,contrast,fonts,social,brand-values}.ts`
  - `apps/web/src/server/brand/brand.ts`
  - `apps/web/scripts/build-social-icons.ts`, `apps/web/public/social/*.png` (erzeugt)
- Modify: `apps/web/src/server/db/schema/index.ts`, `apps/web/src/server/audit/audit.ts` (`'brand.changed'`), Migration (erzeugt), `apps/web/package.json` (Skript `icons:social`, `simple-icons` dev), `pnpm-workspace.yaml`
- Test: `apps/web/src/mail/brand/{brand-schema,contrast,fonts,social,brand-values}.test.ts`, `apps/web/src/server/brand/brand.test.ts`

**Interfaces:**
- Consumes: `MediaRecord`, `mediaPath` (Task 3), `escapeHtml` (Task 5), `assertAdmin`, `writeAudit`
- Produces:

```ts
// mail/brand/brand-schema.ts — ohne Server-Importe
export const FONT_STACKS = ['arial', 'verdana', 'tahoma', 'trebuchet', 'georgia', 'times'] as const; export type FontStackId = (typeof FONT_STACKS)[number]
export const SOCIAL_PLATFORMS = ['instagram','facebook','youtube','tiktok','linkedin','mastodon','bluesky','threads','x','whatsapp'] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]; export type IconVariant = 'dark' | 'light' | 'brand'
export interface BrandLogo { mediaId: string; type: ImageType; width: number; height: number; alt: string }
export interface Brand {
  name: string
  headerLogo: BrandLogo | null; footerLogo: BrandLogo | null; logoAlign: 'left' | 'center'
  colors: { primary: string; secondary: string; text: string; background: string; link: string }   // '#rrggbb'
  fonts: { text: FontStackId; heading: FontStackId; textWish: string | null; headingWish: string | null }
  footer: { address: string; register: string; imprintUrl: string | null; privacyUrl: string | null; websiteUrl: string | null; text: string
            links: { url: string; label: string; display: 'text' | 'icon' }[]; iconVariant: IconVariant }   // links höchstens 5
}
export const brandSchema: z.ZodType<Brand>      // Hex-Farben, URLs https:/mailto:, Wunschschrift /^[\p{L}\p{N} -]{1,60}$/u, Längen
export const DEFAULT_BRAND: Brand               // 'Verein', Grau/Blau, arial, alles Optionale leer
// mail/brand/contrast.ts
export function contrastRatio(a: string, b: string): number
export function readableTextOn(background: string): '#000000' | '#ffffff'
export interface ContrastFinding { pair: 'textOnBackground' | 'linkOnBackground' | 'buttonText' | 'footerText'; ratio: number }
export function contrastFindings(colors: Brand['colors']): ContrastFinding[]   // nur Paare unter 4.5
// mail/brand/fonts.ts
export function fontFamilyCss(stack: FontStackId, wish: string | null): string   // '"Open Sans", Arial, Helvetica, sans-serif'
// mail/brand/social.ts
export function detectPlatform(url: string): SocialPlatform | null
export function socialIconPath(platform: SocialPlatform, variant: IconVariant): string   // '/social/<platform>-<variant>.png'
// mail/brand/brand-values.ts
export function brandPlaceholderValues(brand: Brand, appOrigin: string): Map<string, string>   // die brand.*-Schlüssel aus Design 7
// server/brand/brand.ts
export interface BrandState { brand: Brand; version: number; configured: boolean }
export function getBrand(db: Db): Promise<BrandState>
export class BrandChangedError extends Error {}       // Version passt nicht (Review Focus 3)
export class UnknownLogoError extends Error {}        // mediaId fehlt oder ist kein brand-Bild
export function saveBrand(db: Db, actor: Principal, input: Readonly<{ brand: Brand; version: number }>): Promise<{ version: number }>
```

**Regeln:**
- **`saveBrand`:**
  - `assertAdmin`, eine Transaktion, `SELECT … FOR UPDATE` bzw. Einfügen bei Version 0.
  - Logos müssen `media`-Zeilen mit `purpose = 'brand'` sein.
  - Protokoll `brand.changed` ohne Inhalte.
  - Ersetzte Logos bleiben als Datei und Zeile erhalten (Design 7).
- **`contrastFindings`:** Buttonschrift ist `readableTextOn(primary)`, Fußzeilenschrift `readableTextOn(secondary)`.
- **`detectPlatform`:** nur `https:`-URLs.
- **Icon-Skript:** Entscheidung 9. Die PNGs sind klein (unter 2 KB).

- [ ] **Step 1: Failing Tests schreiben**

```ts
// contrast.test.ts: contrastRatio('#000000','#ffffff') ≈ 21; ('#777777','#ffffff') ≈ 4.48 → Finding; readableTextOn('#0b5394') → '#ffffff'
// fonts.test.ts: ('arial', 'Open Sans') → '"Open Sans", Arial, Helvetica, sans-serif'; Wunsch mit '";}' scheitert im Schema
// social.test.ts: it.each https://www.instagram.com/verein → instagram; https://social.example/@verein → mastodon;
//   http://instagram.com/x → null; https://example.org → null
// brand-schema.test.ts: 6 Links → Fehler; 'javascript:alert(1)' als imprintUrl → Fehler; Farbe 'red' → Fehler
// brand-values.test.ts: logoUrl absolut 'https://verein.example/media/<id>.png'; ohne Logo fehlt brand.logoUrl
// brand.test.ts
it('returns the default brand until an admin saves one', …)   // configured false, version 0
it('saves for admins only and logs without content', …)
it('refuses a stale version', …)                               // zwei saveBrand mit version 1 → zweiter BrandChangedError
it('accepts only brand images as logos', …)                    // library-Bild → UnknownLogoError
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/mail/brand apps/web/src/server/brand` meldet FAIL.
- [ ] **Step 3: Umsetzen.** `vp run --filter web db:generate`; `vp run --filter web icons:social` erzeugt die PNGs.
- [ ] **Step 4: Prüfen.** Dieselben Tests melden PASS. `vp check` meldet 0/0.
- [ ] **Step 5: Commit** – `feat(brand): add brand settings`

---

### Task 7: Mail-Komponenten, Bausteinmodell, Standard-Layout und Kompilieren

**Files:**
- Create:
  - `apps/web/src/mail/blocks/{block-schema,text-doc}.ts`
  - `apps/web/src/mail/components/{mail-shell,container,row,column,heading,text,button,image,link,divider,spacer,preheader}.tsx`
  - `apps/web/src/mail/render/{standard-layout,render-blocks,render-text-doc}.tsx`
  - `apps/web/src/mail/render/{compile,fill,parts}.ts`
  - `apps/web/src/mail/sample.ts`
- Modify: `pnpm-workspace.yaml`, `apps/web/package.json` (`@react-email/render`)
- Test:
  - `apps/web/src/mail/blocks/{block-schema,text-doc}.test.ts`, `apps/web/src/mail/render/{compile,fill}.test.ts`
  - `apps/web/src/mail/render/render.snapshot.test.tsx` mit `__snapshots__/`

**Interfaces:**
- Consumes: Task 5 (`parsePlaceholders`, `stripMarkers`, `escapeHtml`, `cleanHeaderText`, Registry), Task 6 (`Brand`, `brandPlaceholderValues`, `fontFamilyCss`, `readableTextOn`, `socialIconPath`, `detectPlatform`), `mediaPath`
- Produces:

```ts
// mail/blocks/text-doc.ts — Tiptap-JSON, eingeschränkt
export type InlineNode = { type: 'text'; text: string; marks?: ({ type: 'bold' } | { type: 'italic' } | { type: 'link'; attrs: { href: string } })[] }
  | { type: 'hardBreak' } | { type: 'placeholder'; attrs: { key: string; fallback: string | null } }
export type TextDoc = { type: 'doc'; content: ({ type: 'paragraph'; content?: InlineNode[] } | { type: 'bulletList' | 'orderedList'; content: { type: 'listItem'; content: { type: 'paragraph'; content?: InlineNode[] }[] }[] })[] }
export const textDocSchema: z.ZodType<TextDoc>                 // strikt; Link-href nur https:/mailto:/tel:
export const inlineContentSchema: z.ZodType<InlineNode[]>      // für Überschrift und Button: nur text und placeholder, ohne Marken
// mail/blocks/block-schema.ts
export type Block =
  | { id: string; type: 'heading'; level: 1 | 2 | 3; content: InlineNode[] }
  | { id: string; type: 'text'; doc: TextDoc }
  | { id: string; type: 'image'; mediaId: string | null; alt: string; decorative: boolean; href: string | null }
  | { id: string; type: 'button'; label: InlineNode[]; href: string; align: 'left' | 'center' }
  | { id: string; type: 'divider' } | { id: string; type: 'spacer'; size: 'small' | 'medium' | 'large' }
  | { id: string; type: 'columns'; left: ColumnBlock[]; right: ColumnBlock[] }
  | { id: string; type: 'placeholderLine'; ref: { key: string; fallback: string | null } }
export type ColumnBlock = Exclude<Block, { type: 'columns' }>
export const MAX_BLOCKS = 100; export const MAX_TEMPLATE_JSON_BYTES = 256 * 1024
export const blockListSchema: z.ZodType<Block[]>               // MAX_BLOCKS inkl. Spalten-Inhalt; Ids eindeutig
export function collectPlaceholderRefs(blocks: readonly Block[]): PlaceholderRef[]
export function collectMediaIds(blocks: readonly Block[]): string[]
// mail/render/parts.ts
export type Part = { kind: 'text'; value: string } | { kind: 'slot'; index: number }
// mail/render/compile.ts
export interface MailSource {
  subject: string; preheader: string                            // mit Platzhalter-Syntax
  body: { kind: 'blocks'; blocks: Block[]; layout: { kind: 'standard' } | { kind: 'html'; html: string } }
      | { kind: 'html'; html: string }                          // bereinigtes HTML (Task 16); hier nur Platzhalter im Text
  media: ReadonlyMap<string, { type: ImageType; width: number; height: number }>   // für Bausteine
}
export interface CompiledMail { slots: PlaceholderRef[]; subject: Part[]; preheader: Part[]; html: Part[]; text: Part[] }
export type CompileResult = { ok: true; mail: CompiledMail } | { ok: false; missingBrand: string[] } | { ok: false; invalid: string }
export function compileMail(source: Readonly<MailSource>, brand: Readonly<Brand>, appOrigin: string, locale?: Locale): Promise<CompileResult>
// mail/render/fill.ts
export interface FilledMail { subject: string; preheader: string; html: string; text: string }
export type FillResult = { ok: true; mail: FilledMail } | { ok: false; missing: string[] }
export function fillMail(compiled: Readonly<CompiledMail>, values: ReadonlyMap<string, string>): FillResult
// mail/sample.ts
export const SAMPLE_CONTACTS: Readonly<Record<'female' | 'male' | 'diverse' | 'organization', ContactValueSource>>   // erfunden
export const SAMPLE_BLOCKS: readonly Block[]        // jeder Baustein einmal, zwei Spalten, Anrede-Zeile
```

**Regeln:**
- **Komponenten:**
  - Tabellen mit `role="presentation"`, `cellPadding`/`cellSpacing` 0, Inline-Styles aus dem CD.
  - `Button`: Tabellen-Button mit `mso`-Padding und VML-Fallback in `<!--[if mso]>` (über `dangerouslySetInnerHTML` nur mit festen Werten und maskierten CD-Werten).
  - `Image`: absolute URL über `appOrigin` + `mediaPath`, `width` aus den Maßen (höchstens 600 bzw. 280 in Spalten), `alt` bzw. `alt=""` bei `decorative`.
  - `MailShell`: `<html lang>`, `meta charset`, Viewport, `<title>`, eine `<style>`-Regel für mobil (Spalten untereinander, volle Breite).
- **Links in Bausteinen:** `href` von Button und Bild nutzt dieselben Schemata wie Text-Links. Ein Button darf im Schema `href: ''` haben; die Speicherprüfung (Task 11) meldet ihn als `linkMissing`.
- **Standard-Layout:** Design 8; leere CD-Werte lassen ihr Element weg (Design 7). Fußzeilen-Links als Text oder Icon (`socialIconPath`, Alt = Plattformname). Feste Texte nach `locale` (Standard `de`).
- **`compileMail`:**
  1. CD-Platzhalter auflösen. Ein fehlender Pflicht-CD-Wert ergibt `missingBrand` (Design 10.1).
  2. Kontakt-Platzhalter und `salutation` werden Markierungen (Entscheidung 1).
  3. Rendern mit `render()`, Nur-Text mit `toPlainText()`.
  4. Betreff und Vorschautext per `cleanHeaderText`.
  5. In Teile zerlegen. Ein `slot` im HTML wird beim Füllen maskiert, im Text nicht.
  - Ein `{{content}}` im HTML-Layout nimmt den gerenderten Inhalt auf.
- **`fillMail`:** Wert aus `values`, sonst Ersatztext (`''` erlaubt), sonst fehlt der Schlüssel. Alle fehlenden Schlüssel sortiert (`compareCodePoints`).

- [ ] **Step 1: Failing Tests schreiben**

```ts
// block-schema.test.ts: 101 Bausteine → Fehler; Spalten in Spalten → Fehler; doppelte id → Fehler; image ohne alt und nicht decorative ist
//   im Schema erlaubt (die Speicherprüfung in Task 11/14 blockiert); Link 'javascript:x' → Fehler; unbekannter Knoten 'codeBlock' → Fehler
// compile.test.ts / fill.test.ts
it('fills a value once and never parses it again', …)   // firstName '{{contact.email}}' → wörtlich im HTML und Text (Review Focus 1)
it('drops forged markers from template text and values', …)
it('escapes values in HTML but not in plain text', …)    // `Anna <b>&"'` (Review Focus 2)
it('keeps the subject on one line', …)                    // lastName 'Abel\r\nBcc: x@example.org' → Betreff ohne Zeilenumbruch
it('uses the fallback, accepts an empty one and reports missing keys', …)
it('fails the whole compile when a required brand value is missing', …)   // {{brand.website}} ohne Website → missingBrand
it('omits empty brand elements from the standard layout', …)   // ohne Logo kein <img> im Kopf, ohne imprintUrl kein Impressum-Link
it('puts the rendered blocks into {{content}} of an HTML layout', …)
// render.snapshot.test.tsx: toMatchSnapshot für HTML und Text: DEFAULT_BRAND + SAMPLE_BLOCKS; volles CD mit Logos, 5 Links (3 Icons);
//   jeder Baustein einzeln; Sie-Form mit Firma; prüft zusätzlich: jede <table> hat role="presentation", <html lang="de">, Überschriften h1–h3
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/mail` meldet FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.**
  - `vp test run apps/web/src/mail` meldet PASS. Die Snapshots sind von Hand gelesen: kein `{{`, keine Markierungszeichen, keine leeren Links.
  - `vp check` meldet 0/0.
- [ ] **Step 5: Commit** – `feat(mail): render mails with markers`

---

### Task 8: Vorschau-Rahmen und Vorschau-Komponente

**Files:**
- Create:
  - `apps/web/src/routes/preview-frame.ts` (Server-Route, GET)
  - `apps/web/src/server/preview/frame-page.ts`
  - `apps/web/src/components/preview/{mail-preview.tsx,use-compiled-preview.ts,preview-protocol.ts}`
  - `apps/web/src/components/preview/readable-stream-polyfill.ts` (`ReadableByteStreamController` für Safari)
- Modify: `apps/web/src/i18n/de.ts`, `en.ts`
- Test: `apps/web/src/server/preview/frame-page.test.ts`, `apps/web/src/components/preview/{preview-protocol,use-compiled-preview}.test.ts`

**Interfaces:**
- Consumes: `cspNonceFor`, `securityHeadersFor` (Task 1), `compileMail`, `fillMail`, `MailSource` (Task 7), `Brand`
- Produces:

```ts
// server/preview/frame-page.ts
export function previewFramePage(nonce: string, appOrigin: string): string   // HTML mit einem Inline-Skript (nonce) für das Protokoll
// components/preview/preview-protocol.ts
export const PREVIEW_MESSAGE = 'vb-preview'; export const PREVIEW_READY = 'vb-preview-ready'
export const SANDBOXED_ORIGIN = 'null'
export function previewReadyListener(frame: () => Window | null, onPort: (port: MessagePort) => void): (event: Pick<MessageEvent, 'data' | 'origin' | 'ports' | 'source'>) => void
// components/preview/use-compiled-preview.ts
export type PreviewState = { kind: 'pending' } | { kind: 'ready'; mail: FilledMail } | { kind: 'missing'; keys: string[]; brand: boolean } | { kind: 'invalid' }
export function computePreview(source: MailSource, brand: Brand, appOrigin: string, values: ReadonlyMap<string, string>): Promise<PreviewState>
export function useCompiledPreview(source: MailSource, brand: Brand, appOrigin: string, values: ReadonlyMap<string, string>, delayMs?: number): PreviewState   // 300 ms
// components/preview/mail-preview.tsx
export function MailPreview(props: { state: PreviewState; title: string }): ReactNode
  // Umschalter Desktop/Mobil/Nur-Text (React Aria ToggleButtonGroup), Betreff und Vorschautext darüber,
  // <iframe sandbox="allow-scripts" title={title} src="/preview-frame"> mit 600 bzw. 375 px, Nur-Text als <pre>
```

**Regeln:**
- **Rahmen-Skript:** Entscheidung 6. Es verwirft Nachrichten fremder Fenster.
- **Route:** antwortet mit `text/html`, den `previewFrame`-Kopfzeilen und `Cache-Control: no-store`.
- **Fehlerzustände:** `missing` zeigt „Für diesen Kontakt fehlt: {Liste übersetzter Namen}“ bzw. „Im CD fehlt: …“ statt der Mail.
- **Ladegrenze:** Die Vorschau-Komponente lädt `@react-email/render` und den Polyfill nur im Browser, per dynamischem `import()` in `computePreview`.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// frame-page.test.ts: enthält <script nonce="n1">, keinen weiteren <script>; das Skript gibt einen Port nur an die App-Herkunft, zeigt HTML vom Port und hört nicht am Fenster
// preview-protocol.test.ts: previewReadyListener gibt den Port nur weiter bei data.type 'vb-preview-ready', source === frame, origin 'null' und vorhandenem Port
// use-compiled-preview.test.ts: computePreview mit SAMPLE_BLOCKS → ready; ohne Website bei {{brand.website}} → missing brand true;
//   Kontaktwert fehlt → missing keys ['contact.city']
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/server/preview apps/web/src/components/preview` meldet FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** Dieselben Tests melden PASS. `vp check` meldet 0/0.
- [ ] **Step 5: Commit** – `feat(mail): add the sandboxed mail preview`

---

### Task 9: CD-Seite, Startseiten-Hinweis und Admin-Navigation

**Files:**
- Create:
  - `apps/web/src/functions/brand.ts`, `apps/web/src/routes/admin/brand.tsx`
  - `apps/web/src/components/admin/brand/{brand-form,color-field,logo-field,footer-links-field,contrast-notice}.tsx`, `apps/web/src/components/admin/brand/brand-draft.ts`
  - `apps/web/e2e/design.e2e.ts`
- Modify:
  - `apps/web/src/components/admin-nav.tsx` (Eintrag „CD“; „Verwaltung“ ohne zweites `aria-current`, Nacharbeit aus Teilplan 2)
  - `apps/web/src/routes/index.tsx` (Admins: „CD einrichten“, solange `configured` false)
  - `apps/web/src/i18n/{de,en,page-title}.ts`, `apps/web/playwright.config.ts` (Projekt `design`)
- Test: `apps/web/src/components/admin/brand/brand-draft.test.ts`, `apps/web/e2e/design.e2e.ts`

**Interfaces:**
- Consumes: Task 3 (`ImageUpload` mit `purpose: 'brand'`), Task 6 (`getBrand`, `saveBrand`, `brandSchema`, `contrastFindings`, `detectPlatform`), Task 8 (`MailPreview`, `useCompiledPreview`, `SAMPLE_BLOCKS`, `SAMPLE_CONTACTS`)
- Produces:

```ts
// functions/brand.ts
export const loadBrandPage   // GET → { brand: Brand; version: number; configured: boolean; appOrigin: string; storageReady: boolean } (Admin, sonst 403)
export const submitBrand     // POST { brand: Brand; version: number } → { ok: true; version } | { ok: false; failure: 'changed' | 'unknownLogo' | 'invalid' }
// components/admin/brand/brand-draft.ts
export function brandFromDraft(draft: BrandDraft): { ok: true; brand: Brand } | { ok: false; errors: Partial<Record<BrandDraftField, MessageKey>> }
```

**Oberfläche** (`/admin/brand`, links Formular, rechts `MailPreview` des Standard-Layouts mit `SAMPLE_BLOCKS` und Beispielkontakt):
- **Felder:**
  - Name; Kopf- und Fuß-Logo (`ImageUpload` mit `allowSvg: true`, Alternativtext, Entfernen); Ausrichtung.
  - Fünf Farben (React Aria `ColorField` und `ColorPicker`, Hex).
  - Zwei Schriftstapel (`Select`) mit je einer Wunschschrift.
  - Fußzeile: Anschrift, Register, Impressum, Datenschutz, Website, freier Text. Bis zu 5 Links, je Anzeige „Text“ oder „Icon“; „Icon“ ist nur wählbar, wenn `detectPlatform` eine Plattform erkennt. Dazu die Icon-Variante.
- **Hinweise:**
  - Kontrast-Warnungen am Feld: „Kontrast {ratio}:1, empfohlen mindestens 4,5:1“.
  - Hinweis „Impressum und Datenschutz werden empfohlen“.
  - Ohne Speicher: „Dateispeicher nicht eingerichtet“ statt Upload.
- **Speichern:** Bei `changed` erscheint „Das CD wurde inzwischen geändert. Neu laden?“.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// brand-draft.test.ts: leerer Name → errors.name; 6 Links nicht möglich; 'http://…' als Impressum → errors.imprintUrl; gültiger Entwurf → ok
// design.e2e.ts (Projekt design, hängt von fundament ab)
test('an admin sets up the brand', …)
  // Startseite zeigt „CD einrichten“ → /admin/brand; SVG-Logo hochladen (im Test als Text gebaut) → Vorschau zeigt <img src$=".png">;
  // Textfarbe #777777 → Kontrastwarnung; Instagram-Link als Icon; speichern; Hinweis auf der Startseite ist weg;
  // GET /media/<id>.png → 200, image/png; axe auf /admin/brand
test('the admin navigation marks only the current page', …)
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/components/admin/brand` meldet FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** Unit-Tests PASS. `vp run --filter web e2e` ist grün (alle drei Projekte, ohne CSP-Verletzung). `vp check` meldet 0/0.
- [ ] **Step 5: Commit** – `feat(brand): add the brand settings page`

---

### Task 10: Beispielmails, Doku, Changeset und Abnahme 3a

**Files:**
- Create:
  - `apps/web/src/server/mail/sample-cli.ts`, `apps/web/src/server/mail/sample-mails.ts`
  - `docker/compose.relay.yml`, `docker/mailpit-relay.example.yaml`
  - `.changeset/add-design-foundation.md`
- Modify:
  - `.gitignore` (`docker/mailpit-relay.yaml`), `apps/web/package.json` (Skript `mail:sample`)
  - `apps/web/e2e/design.e2e.ts` (HTML-Prüfung)
  - `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/superpowers/plans/2026-11-23-vereinsbote-00-fahrplan.md` (CSP und zod `jitless` erledigt)
- Test: `apps/web/src/server/mail/sample-mails.test.ts`

**Interfaces:**
- Consumes: `compileMail`, `fillMail`, `SAMPLE_*`, `DEFAULT_BRAND`, `contactPlaceholderValues`, `DEFAULT_SALUTATIONS`, `openSmtpTransport`, `parseEnv`
- Produces:

```ts
// server/mail/sample-mails.ts
export interface SampleMail { name: string; mail: FilledMail; attachments: { cid: string; path: string; contentType: string }[] }
export function buildSampleMails(appOrigin: string): Promise<SampleMail[]>
  // Standard-Layout mit allen Bausteinen (du, weiblich); Sie-Form an eine Firma; zwei Spalten; volles CD mit Icon-Links.
  // Bild- und Icon-URLs werden zu cid:-Verweisen (Entscheidung 14), Bilder aus einem erfundenen, im Test erzeugten PNG
```

- [ ] **Step 1: Failing Test schreiben**

```ts
// sample-mails.test.ts: 4 Mails; keine enthält 'http://localhost' in <img src>; jede hat Text und HTML; Betreff ohne '{{'
```

- [ ] **Step 2: Test laufen lassen.** `vp test run apps/web/src/server/mail` meldet FAIL.
- [ ] **Step 3: Umsetzen.**
  - `mail:sample` liest `DEV_SMTP_URL` (Pflicht) und `APP_URL` und schickt jede Beispielmail an `sample@example.org`.
  - Das E2E startet das Skript mit der E2E-Umgebung und holt jede Mail aus Mailpit.
    - Es erwartet `Total.Supported >= 80` (Entscheidung 11).
    - Es lädt jedes HTML per `page.setContent` und ruft `expectNoA11yViolations` auf (axe auf der gerenderten Mail, Design 22).
- [ ] **Step 4: Changeset anlegen** (`web`, `minor`):

```md
---
'web': minor
---

Add the brand settings: club name, logos, colours with a contrast check, font stacks and a footer with links or social media icons. Mails render from a standard layout built from the brand, with placeholders, a salutation in the informal or formal form, escaped values and a plain-text version. Images are stored privately (Cloudflare R2, Vercel Blob or S3) and served by the app. Every page now sends a full Content Security Policy.
```

- [ ] **Step 5: Doku nachziehen.**
  - **`README.md`:**
    - Speicher je Plattform: R2-Bucket mit `--jurisdiction eu` und Binding `MEDIA_BUCKET`; privater Vercel-Blob-Store in `fra1`; `S3_*` für Docker.
    - SeaweedFS in Compose; `TEST_S3_URL`.
    - CSP (Nonce; Abweichungen für `/media` und `/preview-frame`).
    - `/media` und Cache.
    - `mail:sample` und das Mailpit-Relay (`compose.relay.yml`, lokale Datei mit Zugangsdaten, nie einchecken).
    - Social-Icons: Quelle `simple-icons` (CC0), Markenhinweis.
    - Smoke-Test: `/media` aus lokalem R2 unter `wrangler dev`.
  - **`AGENTS.md`:**
    - Plans um `…-03-gestaltung.md` ergänzen.
    - Konventionen:
      - `src/mail/**` ohne Server-Importe.
      - Platzhalter nur im Text, CD-Werte beim Kompilieren.
      - Werte nie erneut parsen.
      - Neue Seiten bekommen die volle CSP; die E2E-Fixture `test` aus `e2e/helpers/test.ts` ist Pflicht.
      - Speicherpakete nur hinter Build-Konstanten.
      - Bilder nur über `storeImage`.
  - **`CONTRIBUTING.md`:** SeaweedFS starten; `mail:sample`; Snapshots bewusst aktualisieren (`vp test -u`) und lesen.
- [ ] **Step 6: Gesamtprüfung.**
  - `vp check` meldet 0/0.
  - `vp test` meldet PASS, mit `TEST_POSTGRES_URL` und `TEST_S3_URL` ebenso.
  - `vp test --coverage`: neue Dateien unter `server/`, `mail/`, `components/**/*.ts` sind abgedeckt.
  - `vp run --filter web e2e` ist grün.
  - Die drei Builds laufen; der Bundle-Check ist sauber.
  - `pnpm check:catalog`, `pnpm check:vite-plus` und `pnpm cve` enden mit 0.
  - `pnpm exec changeset status --since=origin/main` nennt `web` `minor`.
- [ ] **Step 7: Commit** – `docs(mail): document design foundation`
- [ ] **Step 8: Abnahme von Hand (Design 19).**
  - Der Projektinhaber führt `vp run --filter web mail:sample` aus und leitet die Mails über das Mailpit-Relay an eigene Postfächer.
  - Er prüft sie in Outlook klassisch und neu, Gmail Web und App, Apple Mail und iOS-Mail.
  - Befunde werden vor dem Merge als eigene Commits in Task 7 bzw. 6 behoben, mit aktualisierten Snapshots.
  - Erst dann wird der PR für 3a geöffnet bzw. zum Merge freigegeben.

---

# Teil 3b – Vorlagen und Editor (`feat/templates-editor`, von `main` nach dem Merge von 3a)

### Task 11: Vorlagen (Modell und Server)

**Files:**
- Create:
  - `apps/web/src/server/db/schema/templates.ts` (`templates`, `layouts`, `template_media`)
  - `apps/web/src/server/templates/{templates,allowed-placeholders,save-checks,errors}.ts`
  - `apps/web/src/mail/starters/{invitation,starters}.ts`
- Modify: `apps/web/src/server/db/schema/index.ts`, `apps/web/src/server/audit/audit.ts` (`'template.created'`, `'template.updated'`, `'template.duplicated'`, `'template.deleted'`), `apps/web/src/server/contacts/settings.ts` (`areaFieldKeys`), Migration (erzeugt)
- Test: `apps/web/src/server/templates/{templates,allowed-placeholders,save-checks}.test.ts`, `apps/web/src/mail/starters/starters.test.ts`

**Interfaces:**
- Consumes: Task 3 (`media`), Task 5 (Registry, `parsePlaceholders`, `SalutationForm`, `SalutationTexts`, `DEFAULT_SALUTATIONS`), Task 7 (`blockListSchema`, `collectPlaceholderRefs`, `collectMediaIds`, `MAX_TEMPLATE_JSON_BYTES`), `getFieldAreas`, `listCustomFields`, `assertArea`, `canAccessArea`
- Produces:

```ts
// server/contacts/settings.ts (Ergänzung)
export function areaFieldKeys(db: Db, areaId: string): Promise<Record<ContactKind, ReadonlySet<FieldKey>>>   // geschützte Felder, die dem Bereich zugeordnet sind
// server/templates/allowed-placeholders.ts
export interface AllowedPlaceholders { keys: ReadonlySet<string>; deliveredByKind: Record<ContactKind, ReadonlySet<FieldKey>> }
export function allowedTemplatePlaceholders(db: Db, areaId: string): Promise<AllowedPlaceholders>   // Basis + Bereichsfelder + CD + salutation
export function allowedLayoutPlaceholders(scope: 'global' | 'template', template?: AllowedPlaceholders): ReadonlySet<string>  // global: CD + Basis + content
// server/templates/templates.ts
export type TemplateLayout = { kind: 'standard' } | { kind: 'shared'; layoutId: string } | { kind: 'own'; html: string }
export type TemplateBody = { kind: 'blocks'; blocks: Block[]; layout: TemplateLayout } | { kind: 'html'; html: string }
export interface TemplateInput { name: string; subject: string; preheader: string; salutationForm: SalutationForm; salutationTexts: SalutationTexts; body: TemplateBody }
export interface TemplateRecord extends TemplateInput { id: string; areaId: string; version: number; updatedAt: Date; updatedByName: string | null }
export interface TemplateSummary { id: string; areaId: string; name: string; bodyKind: 'blocks' | 'html'; updatedAt: Date }
export function listTemplates(db: Db, actor: Principal): Promise<TemplateSummary[]>      // alle Bereiche mit read, nach Name
export function getTemplate(db: Db, actor: Principal, id: string): Promise<TemplateRecord>  // read im Bereich
export function createTemplate(db: Db, actor: Principal, areaId: string, input: TemplateInput): Promise<{ id: string }>
export function createFromStarter(db: Db, actor: Principal, areaId: string, starter: StarterId, names: Readonly<{ name: string; subject: string }>): Promise<{ id: string }>
export function saveTemplate(db: Db, actor: Principal, id: string, input: TemplateInput, version: number): Promise<{ version: number }>
export function duplicateTemplate(db: Db, storage: ObjectStorage | null, actor: Principal, id: string, targetAreaId: string, name: string): Promise<{ id: string }>
export function deleteTemplate(db: Db, actor: Principal, id: string, version: number): Promise<void>
export function listLayoutChoices(db: Db): Promise<{ id: string; name: string }[]>   // globale Layouts für die Layout-Wahl, nach Name
// server/templates/save-checks.ts — ohne DB
export type SaveProblem =
  | { kind: 'nameEmpty' } | { kind: 'subjectEmpty' } | { kind: 'tooLong'; field: 'name' | 'subject' | 'preheader' }
  | { kind: 'altMissing'; blockId: string } | { kind: 'placeholderUnknown'; key: string; where: string }
  | { kind: 'placeholderForbidden'; key: string; where: string } | { kind: 'syntax'; where: string } | { kind: 'tooBig' }
  | { kind: 'mediaForeign'; mediaId: string } | { kind: 'linkMissing'; blockId: string } | { kind: 'htmlNotYetSupported' }
export function checkTemplateForSave(input: TemplateInput, allowed: AllowedPlaceholders, areaMediaIds: ReadonlySet<string>): SaveProblem[]
// server/templates/errors.ts
export class TemplateNotFoundError extends Error {}; export class TemplateChangedError extends Error {}
export class TemplateInvalidError extends Error { constructor(readonly problems: readonly SaveProblem[]) }
export class TemplateNameTakenError extends Error {}; export class LayoutInUseError extends Error {}
// mail/starters/starters.ts
export const STARTER_IDS = ['invitation'] as const; export type StarterId = (typeof STARTER_IDS)[number]
export function starterTemplate(id: StarterId): Omit<TemplateInput, 'name' | 'subject'> & { defaultName: string; defaultSubject: string }
```

**Schema:**
- **`templates`:**
  - `id uuid pk`, `area_id uuid not null references areas(id) on delete restrict`, `name text not null`, `subject`, `preheader text not null default ''`.
  - `salutation_form text` (check `du`/`sie`), `salutation_texts jsonb`, `body jsonb not null`.
  - `shared_layout_id uuid references layouts(id) on delete restrict`, `version integer not null default 1`.
  - Erstellt und geändert von und am.
  - Unique-Index `(area_id, lower(name))`.
- **`layouts`:** `id uuid pk`, `name text`, `html text`, `version`, Erstellt und geändert von und am; Unique-Index `lower(name)`.
- **`template_media`:** `template_id` (cascade), `media_id text references media(id) on delete restrict`; Primärschlüssel aus beiden.

**Regeln:**
- **Jede schreibende Funktion:**
  - prüft `edit` im Bereich, lädt `allowedTemplatePlaceholders` vor der Transaktion und führt `checkTemplateForSave` aus (Problem → `TemplateInvalidError`).
  - In der Transaktion: Version mit `FOR UPDATE` vergleichen (`TemplateChangedError`) und `template_media` aus `collectMediaIds` neu setzen. Die `/media`-Adressen im HTML kommen mit Task 16 dazu.
  - Protokoll mit `template:<id>`, Details `{ areaId }`.
- **`checkTemplateForSave`:**
  - prüft Betreff, Vorschautext, Anredetexte (nur `contact.firstName`, `contact.lastName`, `contact.organization`) und alle Bausteine; dazu Bilder ohne Alternativtext und Buttons ohne Link (`linkMissing`).
  - HTML-Teile (HTML-Vorlage, eigenes Layout) meldet es bis Task 16 als `htmlNotYetSupported`; Task 16 ersetzt das durch die Prüfung mit `importHtml`.
- **`duplicateTemplate`:**
  - `read` im Quellbereich, `edit` im Zielbereich.
  - Bilder aus einem anderen Bereich werden kopiert: neues Objekt und neue `media`-Zeile im Zielbereich. Die Bausteine zeigen dann auf die Kopien.
  - Ohne Speicher wird ein Duplikat mit fremden Bildern abgelehnt (`StorageNotConfiguredError`).
- **Starter „Einladung“:** Design 9; `checkTemplateForSave` ergibt `[]`.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// allowed-placeholders.test.ts
it('allows base fields everywhere and protected fields of the area only', …)   // Mitglieder-Bereich: contact.birthDate ja; Bereich „Veranstaltungen“: nein
it('allows a field assigned to the area for one kind and delivers it for that kind only', …)
it('limits global layouts to brand, base fields and content', …)
// save-checks.test.ts: it.each der SaveProblem-Fälle (leerer Betreff, Bild ohne alt, {{contact.birthDate}} im fremden Bereich, {{foo.bar}},
//   '{{x' im Text, 257 KB, Anredetext mit {{contact.city}} → forbidden, Bild eines anderen Bereichs → mediaForeign)
// templates.test.ts
it('creates, reads and lists templates by area rights', …)    // read sieht, kein Recht sieht nichts, Admin ohne Bereich sieht nichts
it('refuses a stale version and keeps the newer text', …)     // Review Focus 3
it('refuses a second template with the same name in the area, case-insensitive', …)
it('tracks images and blocks deleting a used one', …)         // FK restrict
it('duplicates into another area with copies of the images', …)
it('refuses to duplicate when a placeholder is not allowed in the target area', …)
it('reports a placeholder that the field protection no longer allows', …)   // Review Focus 5: nach setFieldAreas → saveTemplate TemplateInvalidError
// starters.test.ts: Einladung besteht checkTemplateForSave in jedem Bereich (nur Basis- und CD-Platzhalter)
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/server/templates apps/web/src/mail/starters` meldet FAIL.
- [ ] **Step 3: Umsetzen.** `vp run --filter web db:generate`.
- [ ] **Step 4: Prüfen.** Dieselben Tests und `apps/web/src/server/db` melden PASS. `vp check` meldet 0/0.
- [ ] **Step 5: Commit** – `feat(templates): add templates`

---

### Task 12: Bildersammlung

**Files:**
- Create:
  - `apps/web/src/server/media/library.ts`, `apps/web/src/functions/images.ts`
  - `apps/web/src/routes/images.tsx`
  - `apps/web/src/components/images/{image-library,image-picker-dialog,delete-image-dialog}.tsx`
- Modify: `apps/web/src/server/frame.ts` (`nav.templates`), `apps/web/src/components/main-nav.tsx` („Vorlagen“, „Bilder“), `apps/web/src/i18n/{de,en,page-title}.ts`
- Test: `apps/web/src/server/media/library.test.ts`

**Interfaces:**
- Consumes: `storeImage`, `MediaRecord` (Task 3), `ImageUpload` (Task 4), `template_media` (Task 11)
- Produces:

```ts
// server/media/library.ts
export interface LibraryImage extends MediaRecord { usedBy: { id: string; name: string }[] }
export function listLibrary(db: Db, actor: Principal, areaId: string): Promise<LibraryImage[]>   // read; neueste zuerst
export function renameImage(db: Db, actor: Principal, id: string, name: string): Promise<void>   // edit
export class ImageInUseError extends Error { constructor(readonly templates: readonly { id: string; name: string }[]) }
export function deleteImage(db: Db, storage: ObjectStorage, actor: Principal, id: string): Promise<void>
  // edit; genutzt → ImageInUseError; erst Zeile löschen, dann Objekt; Protokoll media.deleted
// functions/images.ts
export const loadImages     // GET { areaId } → { areas: { id; name; canEdit }[]; images: LibraryImage[]; storageReady: boolean }
export const submitImageName, submitImageDelete   // Ergebnis-Typen mit 'gone' | 'inUse' (mit Vorlagennamen)
```

**Oberfläche:**
- **`/images`:** Bereichsauswahl (nur Bereiche mit `read`), `ImageUpload` (ab `edit`). Darunter ein Raster (`GridList`) mit Vorschaubild, Name, Maßen, Größe und „genutzt in N Vorlagen“.
- **Löschdialog:** nennt die nutzenden Vorlagen bzw. warnt „Das Bild fehlt danach auch in schon verschickten Mails.“
- **`ImagePickerDialog`:** dieselbe Liste als Auswahl, mit Hochladen; für den Editor (Task 14).
- **Navigation:** „Vorlagen“ und „Bilder“ für alle mit `read` in irgendeinem Bereich.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// library.test.ts
it('lists the images of an area for readers only', …)
it('refuses to delete an image a template uses and names the template', …)
it('deletes the row, then the object, and logs it', …)
it('renames within 200 characters', …)
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/server/media` meldet FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** Unit-Tests PASS. `vp check` meldet 0/0.
- [ ] **Step 5: Commit** – `feat(media): add the image library`

---

### Task 13: Vorlagen-Liste und Anlegen

**Files:**
- Create:
  - `apps/web/src/functions/templates.ts`
  - `apps/web/src/routes/templates/{route,index,new}.tsx`
  - `apps/web/src/components/templates/{template-table,create-template-form,duplicate-dialog,delete-template-dialog}.tsx`
  - `apps/web/e2e/templates.e2e.ts`
- Modify: `apps/web/src/i18n/{de,en,page-title}.ts`, `apps/web/playwright.config.ts` (Projekt `templates`), `apps/web/src/router.tsx` (`HistoryState.templateNotice`)
- Test: `apps/web/e2e/templates.e2e.ts`

**Interfaces:**
- Consumes: Task 11 (alle `templates.ts`-Funktionen, `STARTER_IDS`), `history-notice.ts`
- Produces:

```ts
// functions/templates.ts
export const loadTemplateList      // GET → { templates: TemplateSummary[]; areas: { id; name; canEdit }[] }
export const submitCreateTemplate  // POST { areaId; start: 'empty' | StarterId; name; subject } → { ok: true; id } | { ok: false; failure: 'nameTaken' | 'invalid' | 'gone' }
export const submitDuplicate       // POST { id; targetAreaId; name } → { ok: true; id } | { ok: false; failure: 'nameTaken' | 'forbiddenPlaceholders' | 'storageMissing' | 'gone'; keys?: string[] }
export const submitDeleteTemplate  // POST { id; version } → { ok: true } | { ok: false; failure: 'changed' | 'gone' }
```

**Oberfläche:**
- **`/templates`:** Tabelle mit Name, Bereich, Art (Bausteine/HTML) und geändert am, Filter nach Bereich. Aktionen „Bearbeiten“, „Duplizieren“ und „Löschen“ ab `edit`. Knopf „Neue Vorlage“, wenn der Benutzer irgendwo `edit` hat.
- **`/templates/new`:** Bereich (nur `edit`), Start (Leer, „Einladung“, HTML importieren → Task 17), Name und Betreff (bei Startvorlagen vorbelegt). Danach geht es zu `/templates/$id`.
- Die Hinweise „gelöscht“ und „dupliziert“ laufen über den History-State, nie über die URL.

- [ ] **Step 1: Failing E2E schreiben** (Projekt `templates`, hängt von `contacts` und `design` ab)

```ts
test('an editor creates a template from the invitation starter', …)   // Benutzer mit edit in „Veranstaltungen“ (vom Admin angelegt);
  // /templates/new → Einladung → Name vorbelegt → speichern → Editor; axe auf /templates und /templates/new
test('a reader sees templates but cannot change them', …)
test('duplicating into an area that may not see the birth date is refused with the placeholder named', …)
```

- [ ] **Step 2: E2E laufen lassen.** `vp run --filter web e2e -- --project templates` meldet FAIL.
- [ ] **Step 3: Umsetzen** (`$templateId` zunächst als leere Editor-Seite mit Titel; Task 14 füllt sie).
- [ ] **Step 4: Prüfen.** Das E2E-Projekt `templates` ist grün. `vp check` meldet 0/0.
- [ ] **Step 5: Commit** – `feat(templates): add template list and creation`

---

### Task 14: Klick-Editor

**Files:**
- Create:
  - `apps/web/src/routes/templates/$templateId.tsx`
  - `apps/web/src/components/editor/{template-editor,block-list,block-form,text-block-editor,inline-editor,placeholder-menu,settings-panel,findings-panel,salutation-fields}.tsx`
  - `apps/web/src/components/editor/{editor-state,block-factory,placeholder-node}.ts`
  - `apps/web/src/mail/checks/{block-checks,vague-links}.ts`
- Modify: `apps/web/src/functions/templates.ts` (`loadTemplateEditor`, `submitTemplate`), `apps/web/src/i18n/de.ts`, `en.ts`, `pnpm-workspace.yaml`, `apps/web/package.json` (Tiptap)
- Test:
  - `apps/web/src/components/editor/{editor-state,block-factory}.test.ts`, `apps/web/src/mail/checks/{block-checks,vague-links}.test.ts`
  - `apps/web/e2e/templates.e2e.ts` (Ergänzung)

**Interfaces:**
- Consumes: Task 11 (`TemplateRecord`, `TemplateInput`, `SaveProblem`, `allowedTemplatePlaceholders`), Task 12 (`ImagePickerDialog`), Task 7 (`Block`, Schemata), Task 5 (Registry), Task 8 (`MailPreview`, `useCompiledPreview`)
- Produces:

```ts
// mail/checks/block-checks.ts — Warnungen (blockieren nicht)
export type Warning = { kind: 'headingOrder'; blockId: string; level: number } | { kind: 'vagueLink'; blockId: string; text: string }
export function blockWarnings(blocks: readonly Block[]): Warning[]
// mail/checks/vague-links.ts
export const VAGUE_LINK_TEXTS: readonly string[]   // 'hier', 'hier klicken', 'klicke hier', 'klicken sie hier', 'mehr', 'weiter', 'weiterlesen', 'mehr lesen', 'link', 'details'
export function isVagueLinkText(text: string): boolean   // auch nackte Adressen (https://…, www.…); Vergleich ohne Groß-/Kleinschreibung und Satzzeichen
// components/editor/editor-state.ts
export interface EditorState { input: TemplateInput; version: number; selectedId: string | null; dirty: boolean }
export type EditorAction = { type: 'add'; block: Block; afterId: string | null; column?: { parentId: string; side: 'left' | 'right' } }
  | { type: 'move'; id: string; toIndex: number; column?: … } | { type: 'update'; block: Block } | { type: 'remove'; id: string }
  | { type: 'settings'; patch: Partial<Omit<TemplateInput, 'body'>> } | { type: 'layout'; layout: TemplateLayout } | { type: 'saved'; version: number }
export function editorReducer(state: EditorState, action: EditorAction): EditorState
export function moveAnnouncement(state: EditorState, id: string): { blockType: Block['type']; position: number; total: number }
// components/editor/block-factory.ts
export function newBlock(type: Block['type']): Block   // crypto.randomUUID(); Text leerer Absatz; Abstand 'medium'; Button align 'left', href ''
// functions/templates.ts (Ergänzung)
export const loadTemplateEditor   // GET { id } → { template: TemplateRecord; canEdit; brand: Brand; appOrigin; placeholders: { key; group; labelKey }[];
                                  //   layouts: { id; name }[] (listLayoutChoices); media: Record<string, MediaInfo>; problems: SaveProblem[] }
                                  // problems = checkTemplateForSave beim Laden: ein inzwischen geänderter Feldschutz zeigt sich sofort (Design 9)
export const submitTemplate       // POST { id; version; input } → { ok: true; version } | { ok: false; failure: 'changed' | 'gone' } | { ok: false; failure: 'invalid'; problems: SaveProblem[] }
```

**Oberfläche** (Design 13, Variante A):
- **Kopf:** Name, Speichern (`SubmitButton`), Zustand „ungespeichert“. Zuklappbar „Einstellungen“: Betreff, Vorschautext, Briefanrede-Form, Anredetexte (zurücksetzbar auf Standard) und Layout-Wahl (Standard, globale Layouts, „eigenes Layout importieren“ → Task 17).
- **Links:** `GridList` mit `useDragAndDrop` (Tastatur-Drag-and-Drop von React Aria). Jede Zeile hat ein Menü mit „nach oben“, „nach unten“, „duplizieren“ und „löschen“. Der gewählte Baustein klappt zum Formular auf. „Baustein hinzufügen“ öffnet ein Menü mit allen Typen; bei Spalten je Seite.
- **Text:** Tiptap mit `injectCSS: false`, Werkzeugleiste (fett, kursiv, Link, Listen, Platzhalter); Alt+F10 springt in die Werkzeugleiste. `placeholder-node.ts` definiert den Inline-Knoten (Atom) mit Marke und übersetztem Namen.
- **Überschrift und Button-Beschriftung:** ein einzeiliger Tiptap-Editor ohne Marken (`inline-editor.tsx`).
- **Platzhalter-Menü:** Gruppen Kontakt, Verein und Anrede, nur erlaubte Schlüssel. Danach ein Ersatztext-Feld mit den Optionen „Pflicht“, „leer lassen“ und „Text“.
- **Bild:** `ImagePickerDialog`, Alternativtext oder „dekorativ“, Link.
- **Rechts:** `MailPreview` (Task 8). Kontaktwahl kommt in Task 15; bis dahin der Beispielkontakt.
- **Speichern:**
  - Verstöße aus `checkTemplateForSave` stehen am Feld bzw. Baustein. Der Fokus springt zum ersten.
  - `blockWarnings` stehen in `FindingsPanel` mit Sprung-Links.
  - Bei `changed` erscheint ein Dialog: „Die Vorlage wurde inzwischen geändert. Neu laden verwirft deine Änderungen.“
  - Beim Verlassen mit `dirty` greift `useBlocker` mit Bestätigung.
- **Live-Bereich:** Verschieben, Hinzufügen und Löschen werden angesagt („Text an Position 3 von 7 verschoben“).
- **Nur-Lesen:** Mit `read` ohne `edit` ist alles schreibgeschützt, die Vorschau bleibt.
- **Typ `Translate`:** Braucht der Editor einen Übersetzer-Typ, kommt er nach `@/i18n/translate.ts`, und `components/contacts/search-result.ts` nutzt ihn (Nacharbeit aus Teilplan 2).

- [ ] **Step 1: Failing Tests schreiben**

```ts
// editor-state.test.ts: add/move/remove auf oberster Ebene und in Spalten; Spalten in Spalten nicht möglich; dirty nach Änderung, nicht nach saved;
//   moveAnnouncement nach move → Position und Gesamtzahl
// block-factory.test.ts: jeder Typ besteht blockListSchema (außer image ohne Bild: schema ok, Speicherprüfung altMissing)
// block-checks.test.ts: h1 → h3 → headingOrder; Beginn mit h3 → Warnung; Link „Hier klicken!“ → vagueLink; „Programm ansehen“ → nichts
// templates.e2e.ts (Ergänzung)
test('an editor builds a template with the keyboard only', …)
  // Baustein „Text“ hinzufügen (Tastatur), Platzhalter „Vorname“ einfügen, mit Tastatur-Drag-and-Drop an Position 1 verschieben
  // (Ansage im Live-Bereich), Bild-Baustein ohne Alternativtext → Speichern abgelehnt, Fokus am Feld; Alternativtext → gespeichert;
  // Vorschau-Rahmen enthält „Liebe Anna“; axe auf dem Editor
test('two tabs: the second save is refused', …)   // Review Focus 3
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/components/editor apps/web/src/mail/checks` und das E2E-Projekt `templates` melden FAIL.
- [ ] **Step 3: Umsetzen.** Tiptap-Pakete in den Catalog. Vor der Aufnahme prüfen, dass kein `eval` und keine eingefügten `<style>` ohne Nonce entstehen; das E2E mit CSP-Fixture belegt es.
- [ ] **Step 4: Prüfen.** Unit-Tests PASS; E2E `templates` grün; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(templates): add the block editor`

---

### Task 15: Vorschau mit Beispiel- und echtem Kontakt

**Files:**
- Create: `apps/web/src/server/templates/preview-values.ts`, `apps/web/src/components/editor/{preview-contact-picker,preview-panel}.tsx`
- Modify: `apps/web/src/functions/templates.ts` (`searchPreviewContacts`, `loadPreviewValues`), `apps/web/src/components/editor/template-editor.tsx`, `apps/web/src/i18n/de.ts`, `en.ts`
- Test: `apps/web/src/server/templates/preview-values.test.ts`, `apps/web/e2e/templates.e2e.ts` (Ergänzung)

**Interfaces:**
- Consumes: `allowedTemplatePlaceholders`, `areaFieldKeys` (Task 11), `contactPlaceholderValues` (Task 5), `loadContactAccess`, `listContacts`, `displayName`, `SAMPLE_CONTACTS`
- Produces:

```ts
// server/templates/preview-values.ts
export interface PreviewContact { id: string; kind: ContactKind; name: string }
export function searchPreviewContacts(db: Db, actor: Principal, templateId: string, query: string): Promise<PreviewContact[]>   // read im Bereich der Vorlage; höchstens 10
export function previewValues(db: Db, actor: Principal, templateId: string, contactId: string): Promise<Record<string, string> | null>
  // read im Bereich; Werte nur für erlaubte Schlüssel, geschützte nur für Felder, die dem Bereich für die Kontaktart zugeordnet sind
  // und die der Benutzer laut loadContactAccess sieht; null, wenn der Kontakt fehlt
// functions/templates.ts (Ergänzung)
export const searchPreviewContacts  // POST { templateId; query } → { contacts: PreviewContact[] }   (Suchbegriff per POST, nie in der URL)
export const loadPreviewValues      // POST { templateId; contactId; salutation: SalutationTexts } → { ok: true; values } | { ok: false; failure: 'gone' }
```

**Oberfläche:**
- Über der Vorschau ein `ToggleButtonGroup` „Beispiel“ oder „Echter Kontakt“.
  - Bei „Beispiel“: Art und Geschlecht wählbar (`SAMPLE_CONTACTS`).
  - Bei „Echter Kontakt“: `ComboBox` mit Suche (verzögert, POST).
- Die Werte gelten nur für die laufende Seite und werden nicht gespeichert.
- `loadContactAccess` wird außerhalb jeder Transaktion geladen (AGENTS.md).

- [ ] **Step 1: Failing Tests schreiben**

```ts
// preview-values.test.ts
it('gives readers of the area the values the template may use', …)
it('never delivers a protected field of another area', …)          // Vorlage in „Veranstaltungen“: kein contact.birthDate, auch wenn der Benutzer
                                                                     // im Mitglieder-Bereich liest
it('stops delivering a field once the protection changes', …)       // Review Focus 5
it('refuses users without read in the area', …)
// templates.e2e.ts (Ergänzung): echter Kontakt aus dem contacts-Projekt → „Lieber Max“; Platzhalter contact.city ohne Ersatztext bei Kontakt
//   ohne Ort → Vorschau zeigt „Für diesen Kontakt fehlt: Ort“; Antwort von loadPreviewValues enthält kein birthDate (Netzwerk geprüft)
```

- [ ] **Step 2: Tests laufen lassen.** Unit-Tests und E2E melden FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** Unit-Tests PASS; E2E `templates` grün; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(templates): preview with real contacts`

---

### Task 16: HTML-Import (Kern)

**Files:**
- Create:
  - `apps/web/src/server/html-import/{sanitize,css,placeholders,media-refs,findings,import-html}.ts`
  - `apps/web/src/server/html-import/caniemail-outlook.json`
  - `apps/web/scripts/update-caniemail.ts`
- Modify:
  - `apps/web/src/mail/render/compile.ts` (Text-Platzhalter in bereinigtem HTML markieren, CD-Werte in Attributen und `<style>` einsetzen)
  - `apps/web/src/server/templates/save-checks.ts` (HTML-Teile mit `importHtml` prüfen statt `htmlNotYetSupported`), `apps/web/src/server/templates/templates.ts` (`template_media` auch aus `mediaIds` des HTML)
  - `pnpm-workspace.yaml`, `apps/web/package.json` (hast-Pakete, `css-tree`, `@types/css-tree`; Skript `caniemail:update`)
- Test: `apps/web/src/server/html-import/{sanitize,css,placeholders,media-refs,findings,import-html}.test.ts`, `apps/web/src/mail/render/compile.test.ts`, `apps/web/src/server/templates/{save-checks,templates}.test.ts` (Ergänzungen)

**Interfaces:**
- Consumes: Task 5 (`parsePlaceholders`), Task 11 (`AllowedPlaceholders`, `allowedLayoutPlaceholders`), `parseMediaFileName`
- Produces:

```ts
// server/html-import/import-html.ts — läuft auf Node und Workers (css-tree über 'css-tree/dist/csstree.esm')
export const MAX_IMPORT_BYTES = 500 * 1024; export const GMAIL_CLIP_BYTES = 102 * 1024
export type ImportKind = { kind: 'template'; allowed: AllowedPlaceholders; areaMediaIds: ReadonlySet<string> }
  | { kind: 'ownLayout'; allowed: AllowedPlaceholders; areaMediaIds: ReadonlySet<string> } | { kind: 'globalLayout'; brandMediaIds: ReadonlySet<string> }
export type ImportRefusal = { kind: 'tooLarge' } | { kind: 'placeholderUnknown' | 'placeholderForbidden'; key: string }
  | { kind: 'placeholderInAttribute'; key: string; attribute: string } | { kind: 'contentMissing' } | { kind: 'contentRepeated' }
  | { kind: 'mediaForeign'; mediaId: string } | { kind: 'syntax' }
export type ImportFinding = { kind: 'removed'; what: 'script' | 'form' | 'frame' | 'object' | 'base' | 'metaRefresh' | 'eventHandler' | 'unsafeUrl' | 'unsafeCss' | 'comment'; count: number }
  | { kind: 'outlookCss'; property: string; count: number } | { kind: 'altMissing'; count: number } | { kind: 'tablePresentation'; count: number }
  | { kind: 'vagueLink'; text: string } | { kind: 'headingOrder'; level: number } | { kind: 'externalImage'; host: string }
  | { kind: 'clipped'; bytes: number } | { kind: 'langAdded' }
export type ImportResult = { ok: true; html: string; findings: ImportFinding[]; mediaIds: string[] } | { ok: false; refusals: ImportRefusal[] }
export function importHtml(source: string, kind: ImportKind, appOrigin: string): ImportResult
```

**Regeln:**
- **Parsen und Bereinigen:** `hast-util-from-html` (ganzes Dokument), dann `hast-util-sanitize` mit eigenem Schema.
  - Erlaubt: Tabellen-, Text-, Listen-, Bild- und Link-Elemente sowie `style`, `head`, `meta` (ohne `http-equiv=refresh`), `title`, `center` und `font`.
  - Attribute: die üblichen Layout-Attribute (`align`, `bgcolor`, `width`, `height`, `border`, `cellpadding`, `cellspacing`, `valign`, `role`, `lang`, `dir`, `alt`, `title`, `class`, `style`, `href`, `src`, `aria-*`).
  - URL-Schemata: `href` nur `https:`, `http:`, `mailto:`, `tel:`; `src` nur `https:`, `http:` und App-`/media`-Pfade.
- **Bedingungskommentare:** `<!--[if mso]>…<![endif]-->` bleiben als Kommentar erhalten. Ihr Inhalt wird mit demselben Schema bereinigt (geparst, bereinigt, wieder serialisiert). Andere Kommentare werden entfernt.
- **CSS:** `style`-Attribute und `<style>` laufen durch css-tree.
  - Entfernt werden `expression(`, `behavior`, `-moz-binding`, `@import`, `url(` mit anderem Schema als `https:`, `javascript:` in jeder Form und `@font-face` (Mails laden nichts nach).
  - Eigenschaften aus `caniemail-outlook.json` ergeben `outlookCss`.
- **Platzhalter:**
  - In Textknoten werden sie geprüft und bleiben als Syntax stehen; `compileMail` markiert sie.
  - In Attributen, `<style>` und `<title>` sind nur `brand.*` erlaubt, sonst `placeholderInAttribute`.
  - Unbekannte oder unerlaubte Schlüssel werden abgelehnt.
  - Layouts brauchen genau ein `{{content}}` als eigenen Textknoten.
- **Bilder:** `/media/<file>` (relativ oder mit `appOrigin`) muss in `areaMediaIds` bzw. `brandMediaIds` liegen, sonst `mediaForeign`; diese Bilder landen in `mediaIds`. Andere `https:`-Bilder ergeben `externalImage` (je Host einmal).
- **`lang`:** Fehlt es, wird `lang="de"` gesetzt (`langAdded`).
- **Größe:** über 500 KB `tooLarge`; über 102 KB `clipped`.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// sanitize.test.ts — XSS-Korpus (Design 22), it.each: <script>, <img onerror>, <a href="javascript:…">, <a href=" jav&#x09;ascript:…">,
//   <svg><script>, <iframe>, <form><input>, <object>, <embed>, <base href>, <meta http-equiv="refresh">, <noscript><img onerror>,
//   <!--[if mso]><script>…<![endif]-->, <style>@import url(…)</style>, style="width:expression(alert(1))", style="background:url(javascript:x)"
//   → nichts Ausführbares im Ergebnis (Prüfung: erneut parsen, kein script/on*/javascript:), passender removed-Befund
it('keeps outlook conditional comments with cleaned content', …)
// placeholders.test.ts: {{contact.firstName}} im Text ok; <a href="{{contact.email}}"> → placeholderInAttribute;
//   <td style="color:{{brand.primaryColor}}"> ok; {{contact.birthDate}} in fremdem Bereich → forbidden; Layout ohne/mit zwei {{content}}
// media-refs.test.ts: /media/<id>.png des Bereichs → mediaIds; eines anderen Bereichs → mediaForeign; https://cdn.example/x.png → externalImage
// findings.test.ts: display:flex → outlookCss 'display' (nach dem JSON); <img> ohne alt → altMissing; 120 KB → clipped
// import-html.test.ts: ein React-Email-Export (im Test als Text) → ok, lang gesetzt, Platzhalter erhalten
// compile.test.ts (Ergänzung): HTML-Vorlage mit {{salutation}} im Text und {{brand.primaryColor}} im style → Markierung bzw. eingesetzter Hex-Wert
// save-checks.test.ts / templates.test.ts (Ergänzung): HTML-Vorlage mit {{contact.birthDate}} nach geändertem Feldschutz → placeholderForbidden;
//   /media-Bild im HTML landet in template_media und sperrt das Löschen
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/server/html-import apps/web/src/mail/render` meldet FAIL.
- [ ] **Step 3: Umsetzen.** `vp run --filter web caniemail:update` erzeugt das JSON einmal; es wird eingecheckt.
- [ ] **Step 4: Prüfen.**
  - Die Tests melden PASS.
  - `vp run --filter web build:cloudflare` baut; das Workers-Bundle enthält kein `createRequire` aus css-tree.
  - `vp check` meldet 0/0.
- [ ] **Step 5: Commit** – `feat(templates): import and clean html`

---

### Task 17: HTML-Import in der Oberfläche und globale Layouts

**Files:**
- Create:
  - `apps/web/src/server/layouts/layouts.ts`, `apps/web/src/functions/layouts.ts`
  - `apps/web/src/routes/admin/layouts/{index,$layoutId}.tsx`
  - `apps/web/src/components/html-import/{html-import-form,import-findings}.tsx`
- Modify:
  - `apps/web/src/functions/templates.ts` (`checkHtmlImport`, Anlegen und Ersetzen einer HTML-Vorlage, eigenes Layout)
  - `apps/web/src/routes/templates/new.tsx`, `apps/web/src/components/editor/settings-panel.tsx`, `apps/web/src/routes/templates/$templateId.tsx` (HTML-Vorlagen: Ansicht mit „neues HTML einfügen“)
  - `apps/web/src/server/templates/templates.ts` (`duplicateTemplate` schreibt `/media`-Adressen im HTML auf die kopierten Bilder um)
  - `apps/web/src/components/admin-nav.tsx` („Layouts“), `apps/web/src/server/audit/audit.ts` (`'layout.created'`, `'layout.updated'`, `'layout.deleted'`), `apps/web/src/i18n/{de,en,page-title}.ts`
- Test: `apps/web/src/server/layouts/layouts.test.ts`, `apps/web/e2e/templates.e2e.ts` (Ergänzung)

**Interfaces:**
- Consumes: `importHtml` (Task 16), Task 11 (`createTemplate`, `saveTemplate`, `LayoutInUseError`), `MailPreview`
- Produces:

```ts
// server/layouts/layouts.ts
export interface LayoutSummary { id: string; name: string; usedBy: number; updatedAt: Date }
export function listLayouts(db: Db, actor: Principal): Promise<LayoutSummary[]>      // Admin; Namen auch für Vorlagen-Editoren über loadTemplateEditor
export function createLayout(db: Db, actor: Principal, input: Readonly<{ name: string; source: string }>, appOrigin: string): Promise<{ id: string } | { refusals: ImportRefusal[] }>
export function replaceLayout(db: Db, actor: Principal, id: string, source: string, version: number, appOrigin: string): Promise<{ version: number } | { refusals: ImportRefusal[] }>
export function deleteLayout(db: Db, actor: Principal, id: string): Promise<void>     // LayoutInUseError mit Vorlagenzahl
// functions/templates.ts (Ergänzung)
export const checkHtmlImport   // POST FormData { target: 'template' | 'ownLayout' | 'globalLayout'; areaId?; templateId?; html } →
                               // { ok: true; html; findings } | { ok: false; refusals }   — speichert nichts
```

**Oberfläche:**
- **`HtmlImportForm`:** Datei (`FileTrigger`, `.html`, höchstens 500 KB im Browser vorgeprüft) oder Textfeld.
  - „Prüfen“ zeigt Befunde (gruppiert: entfernt, Warnungen, abgelehnt) und die Vorschau (`MailPreview` mit Beispielkontakt).
  - „Übernehmen“ speichert und ist nur ohne Ablehnungen aktiv.
- **Einbindung:**
  - `/templates/new` → „HTML importieren“: Name, Betreff, dann das Formular.
  - Editor-Einstellungen → „eigenes Layout importieren“.
  - Eine HTML-Vorlage zeigt Vorschau, Einstellungen und „neues HTML einfügen“.
- **`/admin/layouts`:** Liste mit Name und „genutzt in N Vorlagen“, „Layout importieren“, Löschen (gesperrt, wenn genutzt). `/admin/layouts/$layoutId` ersetzt das HTML.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// layouts.test.ts: nur Admins; Kontakt-Platzhalter außer Basisfeldern abgelehnt; Löschen eines genutzten Layouts → LayoutInUseError;
//   Ersetzen mit alter Version → Konflikt
// templates.e2e.ts (Ergänzung)
test('an editor imports html with a script and sees it removed', …)   // Datei mit <script> und <a href="javascript:…"> → Befunde „entfernt“,
  // Vorschau ohne Skript (CSP-Fixture bleibt leer), Übernehmen → HTML-Vorlage; axe auf der Import-Seite
test('an admin imports a global layout and an editor uses it', …)       // Layout mit {{content}} → im Editor wählbar → Vorschau zeigt Rahmen
test('a layout without {{content}} is refused', …)
```

- [ ] **Step 2: Tests laufen lassen.** Unit-Tests und E2E melden FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** Unit-Tests PASS; E2E `templates` grün; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(templates): add html import and global layouts`

---

### Task 18: Client-only-Grenze, Doku, Changeset und Abschluss 3b

**Files:**
- Create: `.changeset/add-templates-editor.md`
- Modify:
  - Die Stellen, die Tiptap, die Bildverarbeitung und die Import-Leser (`read-excel-file`, `papaparse`, `fflate`) laden: nur noch per dynamischem `import()` in Client-Code, z. B. `components/contacts/import/read-file.ts`, `components/editor/text-block-editor.tsx`, `components/images/process-image.ts`
  - `.github/workflows/ci.yml` (Bundle-Check: `@tiptap`, `read-excel-file` und `papaparse` nicht in `apps/web/dist/*/server`)
  - `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/superpowers/plans/2026-11-23-vereinsbote-00-fahrplan.md` (Nacharbeit „Lesebibliotheken in Server-Bundles“ erledigt)

- [ ] **Step 1: Bundle-Check zuerst** in `ci.yml` ergänzen. Lokal `vp run --filter web build:node` bauen und `grep -rlE '@tiptap|read-excel-file|papaparse' apps/web/dist/node/server` ausführen: Treffer (erwarteter Fehlschlag).
- [ ] **Step 2: Grenze ziehen.**
  - Die genannten Bibliotheken werden erst in Ereignis-Handlern bzw. client-only Effekten dynamisch importiert.
  - Komponenten, die sie brauchen, rendern auf dem Server einen Platzhalter mit derselben Größe (`ClientOnly` von TanStack Router).
  - Danach findet der grep nichts mehr; die Funktion bleibt im E2E grün.
- [ ] **Step 3: Changeset** (`web`, `minor`):

```md
---
'web': minor
---

Add mail templates per area: a keyboard-accessible block editor with headings, formatted text, images, buttons, dividers, spacers, two columns and placeholders, a live preview on desktop and mobile with sample or real contacts, accessibility checks, an image library per area, an invitation starter template, and an HTML import that cleans scripts and checks placeholders, for templates and for global layouts.
```

- [ ] **Step 4: Doku nachziehen.**
  - **`README.md`:** Vorlagen, Bildersammlung, HTML-Import und globale Layouts im Abschnitt „Operations“. E2E-Projekte `design` und `templates`. caniemail-Auszug und `caniemail:update`.
  - **`AGENTS.md`:**
    - Vorlagen speichern nur über `saveTemplate` (Prüfungen und Bildnutzung).
    - Vorschau-Werte nur über `previewValues`.
    - Importiertes HTML nur über `importHtml`.
    - Schwere Browser-Bibliotheken nur per dynamischem `import()` (Bundle-Check).
  - **`CONTRIBUTING.md`:** den XSS-Korpus des Imports erweitern, nie verkleinern.
- [ ] **Step 5: Gesamtprüfung.**
  - `vp check` meldet 0/0.
  - `vp test` meldet PASS, mit `TEST_POSTGRES_URL` und `TEST_S3_URL` ebenso.
  - `vp test --coverage` deckt die neuen Dateien ab.
  - `vp run --filter web e2e` ist grün (alle Projekte, keine CSP-Verletzung).
  - Die drei Builds laufen, beide Bundle-Checks sind sauber.
  - `pnpm check:catalog`, `pnpm check:vite-plus` und `pnpm cve` enden mit 0.
  - `pnpm exec changeset status --since=origin/main` nennt `web` `minor`.
- [ ] **Step 6: Commit** – `docs(templates): document templates and editor`
