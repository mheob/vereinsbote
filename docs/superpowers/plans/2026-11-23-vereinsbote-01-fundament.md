# Vereinsbote – Teilplan 1: Fundament – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine App, die auf Vercel, Cloudflare und Docker läuft. Sie hat eine Ersteinrichtung, eine Anmeldung ohne Passwort, Bereiche mit Stufen, eine Benutzerverwaltung und eine Zeitsteuerung. Kontakte und Versand kommen erst in späteren Teilplänen.

**Architecture:**
- Ein pnpm-Monorepo, die TanStack-Start-App liegt unter `apps/web`.
- Die Fachlogik besteht aus Funktionen ohne Framework-Abhängigkeit unter `apps/web/src/server/**`. Getestet wird sie mit Vitest gegen PGlite, also Postgres direkt im Prozess.
- Routen sind dünne Hüllen um diese Funktionen.
- Was sich je Plattform unterscheidet (Datenbanktreiber, Umgebung, `waitUntil`, Zeitsteuerung), liegt unter `apps/web/src/platform/**`.

**Tech Stack:**
- Werkzeuge: Vite+ (`vite-plus`, CLI `vp`, bündelt Vite 8/Rolldown, Vitest, Oxlint, Oxfmt und Task-Runner), `@mheob/oxlint-config`, `@mheob/oxfmt-config`, commitlint mit `@mheob/commitlint-config` und czg, Git-Hooks über Vite+ (`.vite-hooks/`, `vp staged`)
- Laufzeit und Sprache: Node 26 (aktuelles LTS), pnpm 12.21, TypeScript 7 (strict). Immer die neueste stabile Version, siehe Global Constraints.
- Framework und Oberfläche: TanStack Start, React, React Aria Components, Tailwind CSS v4
- Datenbank: Drizzle ORM und drizzle-kit, `@neondatabase/serverless`, `pg`, `@electric-sql/pglite`
- Anmeldung und Prüfung: Better Auth (Magic Link, Microsoft), zod
- Dev-Mails: nodemailer, nur im Dev-Betrieb mit Mailpit
- E2E: Playwright, `@axe-core/playwright`
- Betrieb: Docker

**Spec:** `docs/superpowers/specs/2026-11-23-vereinsbote-design.md`
**Fahrplan und Glossar:** `docs/superpowers/plans/2026-11-23-vereinsbote-00-fahrplan.md`

## Global Constraints

- **Sprache:** Die Oberfläche ist von Beginn an zweisprachig: Deutsch (Standard) und Englisch (Wunsch des Projekts). Alle Texte stehen in `apps/web/src/i18n/de.ts` und `en.ts`. Systemmails gehen in der Sprache des Empfängers. Bis Task 5a gibt es nur `de.ts` und `t()`; ab Task 5a gelten `useT()` und `translate()`.
- **Barrierefreiheit:** Die App erfüllt WCAG 2.2 AA (Spec 6.9). Jede Seite bekommt im E2E-Test einen axe-Check. Für die Tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` darf es keine Verstöße geben.
- **Anmeldung:** Spec 6.7: „Es gibt keine Passwörter und keine Selbstregistrierung. Admins laden Benutzer ein.“
- **Stufen:** Sie sind kumulativ, `read` < `edit` < `send`. Die Admin-Rolle gibt **keinen** Bereichszugriff. Spec 6.7: „Mitgliederdaten sieht sie nur mit zusätzlichen Bereichsrechten.“
- **Verschlüsselung:** Zugangsdaten werden mit AES-GCM verschlüsselt, der Schlüssel kommt aus einer Umgebungsvariable (Spec 6.8). Nur WebCrypto, damit es auf Node und auf Workers läuft.
- **Zeitsteuerung:** Standard ist alle 15 Minuten (Spec 6.6). Jeder Schritt arbeitet mit einem Zeitbudget und setzt beim nächsten Tick fort (Spec 7).
- **Deploy-Ziele:** Vercel Pro, Cloudflare Workers Paid und Node/Docker (Spec 3, 4.1). `nodemailer` und `pg` werden nur dynamisch im Node-Pfad geladen und dürfen nie im Cloudflare-Bundle landen.
- **Migrationen:** Sie laufen beim Deploy automatisch und bleiben mit älteren Daten verträglich (Spec 8).
- **Lizenz:** MIT (Spec 8).
- **Namen:** Alles, was Code ist, ist englisch: Bezeichner (nach dem Glossar im Fahrplan), Dateinamen, URL-Pfade, HTML-IDs, CSS-Klassen, Cookie-Namen und Testtitel. Nur sichtbare Texte sind übersetzt.
- **E-Mail-Adressen:** Sie werden überall über `normalizeEmail` (trim + lowercase) gespeichert und verglichen.
- **Secrets:** Ihre Werte erscheinen nie in Fehlermeldungen oder Logs.
- **Versionen:** Immer die neueste stabile Version verwenden: Node (derzeit 26 LTS), pnpm, TypeScript, jede Abhängigkeit im Catalog, Docker-Images (`node:26-alpine`, `postgres:19`, `axllent/mailpit:latest`) und GitHub Actions. Eine ältere Version ist nur erlaubt, wenn die neueste nachweislich nicht funktioniert. Dann steht der Grund als Kommentar am Catalog-Eintrag.

**Werkzeuge** (Wunsch des Projekts, gilt ab dem ersten Commit):
- **Vite+ ist die einzige Toolchain.**
  - Befehle: `vp dev`, `vp build`, `vp test`, `vp check` (Format, Lint, Typen), `vp fmt`, `vp lint`, `vp run`.
  - Konfiguriert wird ausschließlich in `vite.config.ts`. Die Blöcke `lint`, `fmt` und `test` stehen im Root, die App-Plugins in `apps/web/vite.config.ts`.
  - Es gibt **kein** `vitest.config.ts`, `oxlint.config.ts`, `.oxlintrc.json` oder `.oxfmtrc.json`.
- **Imports:** Tests importieren aus `vite-plus/test`, Vite-APIs aus `vite-plus`. Die Lint-Regel `vite-plus/prefer-vite-plus-imports` steht auf `error`.
- **pnpm-Catalog:** `pnpm-workspace.yaml` hat `catalogMode: strict`.
  - Jede externe Abhängigkeit steht in jeder `package.json` als `"catalog:"`, interne als `"workspace:*"`. Versionen stehen nur im Catalog.
  - `vite@*` und `vitest@*` werden per `overrides` auf die Catalog-Einträge der Vite+-Kopien gezwungen. Die Werte liefert `vp toolchain vite-plus-core` bzw. `vp toolchain vitest`.
  - `scripts/check-catalog.ts` prüft das in CI und im Pre-Commit-Hook.
- **Lint:** `@mheob/oxlint-config` mit `baseConfig`, `baseJsConfig`, `reactConfig` und `tailwindcssConfig()`. `typeAware` und `typeCheck` sind an. Jede gelintete Datei gehört zu einer `tsconfig.json`.
- **Format:** `@mheob/oxfmt-config` (`baseConfig`: Tabs, einfache Anführungszeichen, sortierte Imports). Die Code-Beispiele in diesem Plan sind nicht formatiert, verbindlich ist das Ergebnis von `vp fmt`.
- **Commits:** Conventional Commits nach `@mheob/commitlint-config`:
  - Typ in Kleinbuchstaben, Scope optional
  - Beschreibung höchstens 50 Zeichen, beginnt klein, kein Punkt am Ende
  - Kopfzeile höchstens 72 Zeichen
  - Der `commit-msg`-Hook von Vite+ prüft das, `pnpm commit` startet czg.
- **Git-Hooks:** ausschließlich über Vite+, ohne lefthook oder Husky.
  - Die Skripte liegen in `.vite-hooks/`.
  - `pre-commit` ruft `vp staged` auf, die Regeln stehen im `staged`-Block der Root-`vite.config.ts`.
  - `commit-msg` ruft commitlint auf.
  - Installiert werden die Hooks über `vp config` im `prepare`-Skript.
- **Dateinamen der Tests:** Playwright-Tests heißen `*.e2e.ts`. So greifen die Vitest-Regeln der Lint-Konfiguration für `*.spec.ts`/`*.test.ts` nicht.

## Review Focus

1. **Letzter Admin:** Der letzte aktive Admin sperrt sich selbst oder nimmt sich die Admin-Rolle. Das muss abgelehnt werden, sonst hat die Instanz niemanden mehr, der sie verwalten kann. Test in Task 8.
2. **Doppelte Ersteinrichtung:** Das Formular wird doppelt abgeschickt (Doppelklick, zwei Tabs). Es entsteht genau ein Admin, der zweite Versuch scheitert sauber. Test in Task 7.
3. **Schreibweise der E-Mail:** Bei Einladung und Anmeldung wird die Adresse anders geschrieben („Anna@Verein.de “). Es ist trotzdem derselbe Benutzer, und es entsteht kein Duplikat. Tests in Task 5 und Task 8.
4. **Gesperrter Benutzer mit offener Sitzung:** Er ist beim nächsten Aufruf abgemeldet. Tests in Task 5 und Task 8.
5. **Überlappende Läufe der Zeitsteuerung** (Cron und Selbst-Anstoß, oder ein langsamer Lauf): Es laufen nie zwei gleichzeitig. Eine abgelaufene Sperre wird übernommen. Test in Task 9.

## Dateistruktur

```
package.json, pnpm-workspace.yaml, vite.config.ts, tsconfig.json, tsconfig.base.json
commitlint.config.ts, .vite-hooks/{pre-commit,commit-msg}, scripts/check-catalog.ts
.node-version, .gitignore, LICENSE, README.md
.github/workflows/ci.yml
docker/Dockerfile, docker/compose.yml, docker/compose.dev.yml
apps/web/
  package.json, tsconfig.json, vite.config.ts, playwright.config.ts
  drizzle.config.ts, drizzle/            (generierte Migrationen)
  vercel.json, wrangler.jsonc, .env.example
  e2e/fundament.e2e.ts, e2e/helpers/{mailpit.ts,a11y.ts}
  src/
    i18n/{de.ts,en.ts,locale.ts,translate.ts,use-t.tsx}   (t.ts bis Task 5a)
    components/language-switcher.tsx
    platform/{context.ts,platform.ts,node-server.ts,cloudflare-worker.ts}
    server/
      env.ts
      crypto/secrets.ts
      db/{client.ts,migrate.ts,migrate-cli.ts,test-db.ts}
      db/schema/{index.ts,system.ts,auth.ts,areas.ts,audit.ts}
      system-state.ts
      mail/{system-mailer.ts,testing.ts}
      auth/{email.ts,auth.ts,session.ts}
      permissions/{levels.ts,principal.ts}
      audit/audit.ts
      setup/setup.ts
      users/{repo.ts,users.ts}
      areas/areas.ts
      tick/{tick.ts,steps.ts,http.ts}
    routes/
      __root.tsx, index.tsx, login.tsx, setup.tsx
      admin/{route.tsx,users.tsx,areas.tsx}
      api/{health.ts,tick.ts}, api/auth/$.ts
```

Unit- und Integrationstests liegen jeweils neben der Datei als `*.test.ts`, E2E-Tests unter `apps/web/e2e` als `*.e2e.ts`.

---

### Task 1: Monorepo, Werkzeuge und App-Gerüst

**Files:**
- Create: `package.json` (`"type": "module"`, `"packageManager": "pnpm@12.21.0"`, `"engines": { "node": ">=26.0.0" }`), `pnpm-workspace.yaml`, `vite.config.ts`, `tsconfig.json` (nur Root-Konfigurationsdateien und `scripts/**`), `tsconfig.base.json`, `commitlint.config.ts`, `.vite-hooks/pre-commit`, `.vite-hooks/commit-msg` (beide ausführbar), `scripts/check-catalog.ts`, `.node-version` (`26`), `.gitignore`, `LICENSE` (MIT, „Copyright (c) 2026 Vereinsbote contributors“), `README.md`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json` (umfasst `src`, `e2e` und die Konfigurationsdateien der App), `apps/web/vite.config.ts`, `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/index.tsx`, `apps/web/src/styles.css`
- Create: `apps/web/src/i18n/de.ts`, `apps/web/src/i18n/t.ts`
- Test: `apps/web/src/i18n/t.test.ts`

**Interfaces:**
- Produces:
  - `de`: ein flaches Objekt mit Schlüsseln in Punkt-Schreibweise, `as const`
  - `type MessageKey = keyof typeof de`
  - `t(key: MessageKey, params?: Record<string, string | number>): string`
  - **Root-Skripte:**
    - `check` = `vp check`
    - `test` = `vp test`
    - `check:catalog` = `node scripts/check-catalog.ts`
    - `commit` = `czg`
    - `prepare` = `vp config` (installiert die Hooks aus `.vite-hooks/`)
  - **Skripte in `apps/web`:**
    - `dev` = `vp dev`
    - `build:node`, `build:vercel`, `build:cloudflare`: jeweils `vp build` mit gesetztem `VITE_VB_PLATFORM`. Ausgabe nach `dist/node`, `.vercel/output` bzw. `dist/cloudflare`.
    - `e2e` = `playwright test`
    - `db:generate` und `db:migrate` kommen in Task 3 dazu.

**Konfiguration, die der Implementierer nicht selbst ableiten kann** (Vorbild ist das Repo `mheob/config`):

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
catalogMode: strict
catalog:
  vite: npm:@voidzero-dev/vite-plus-core@<Wert aus `vp toolchain vite-plus-core`>
  vite-plus: 1.7.0
  vitest: <Wert aus `vp toolchain vitest`>
  # alle weiteren Abhängigkeiten, jeweils aktuelle stabile Version,
  # inklusive der Peer-Abhängigkeiten der @mheob-Pakete
  # (@commitlint/cli, czg, eslint-plugin-regexp, eslint-plugin-better-tailwindcss, oxlint, oxfmt)
overrides:
  vite@*: 'catalog:'
  vitest@*: 'catalog:'
```

```ts
// vite.config.ts (Root)
import { baseConfig as fmtBaseConfig } from '@mheob/oxfmt-config'
import { baseConfig, baseJsConfig, reactConfig, tailwindcssConfig } from '@mheob/oxlint-config'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  defaultPackage: './apps/web',
  fmt: { ...fmtBaseConfig, ignorePatterns: ['**/drizzle/**', 'apps/web/src/routeTree.gen.ts'] },
  lint: {
    extends: [baseConfig, baseJsConfig, reactConfig,
      tailwindcssConfig({ options: { entryPoint: './apps/web/src/styles.css' } })],
    ignorePatterns: ['**/drizzle/**', '**/dist/**', '**/.vercel/**', 'apps/web/src/routeTree.gen.ts'],
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    options: { typeAware: true, typeCheck: true },
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
  },
  staged: {
    '*': 'vp check --fix',
    '**/package.json': 'pnpm check:catalog',
  },
  test: { projects: ['apps/web'] },
})
```

```ts
// commitlint.config.ts — Scopes ergeben sich automatisch aus apps/* (plus deps, release, repo)
export { default } from '@mheob/commitlint-config'
```

```sh
# .vite-hooks/pre-commit
vp staged
```

```sh
# .vite-hooks/commit-msg
pnpm exec commitlint --edit "$1"
```

**`scripts/check-catalog.ts`:**
- Liest die Root-`package.json` und alle `apps/*/package.json`.
- Prüft in `dependencies`, `devDependencies`, `peerDependencies` und `optionalDependencies` jeden Eintrag. Erlaubt sind nur `catalog:`, `catalog:<name>` und `workspace:*`.
- Bei Verstößen gibt das Skript `<paket>: <abhängigkeit> = <spec>` je Zeile aus und endet mit Exit-Code 1.

- [ ] **Step 1: App-Gerüst anlegen.**
  - Die TanStack-Start-App unter `apps/web` anlegen, mit `vp create @tanstack/start` oder nach der TanStack-Start-Doku. Dazu kommen Tailwind v4 und `react-aria-components`.
  - Alle Versionen werden in den Catalog verschoben, alle `package.json` nutzen `"catalog:"`.
  - Gibt es danach zwei Vite-Kopien (`pnpm why vite`), wurden die `overrides` nicht angewendet. Die TanStack-Start-App liefert dann 404, siehe Vite+-Issue #1391.
- [ ] **Step 2: Werkzeuge im Root anlegen.** Die Dateien wie oben anlegen, dann `pnpm install`.
- [ ] **Step 3: Root-Layout bauen.** `__root.tsx` rendert:
  - `<html lang="de">`
  - einen Skip-Link mit `t('a11y.skipLink')` auf `#inhalt`
  - `<main id="inhalt">`
  - als Titel `t('app.name')`
- [ ] **Step 4: Failing Test schreiben**

```ts
import { describe, expect, it } from 'vite-plus/test'
import { t } from './t'

describe('t', () => {
  it('returns German text', () => {
    expect(t('app.name')).toBe('Vereinsbote')
  })
  it('interpolates params', () => {
    expect(t('auth.linkSent', { email: 'anna@verein.de' })).toBe(
      'Wir haben einen Anmeldelink an anna@verein.de geschickt, falls die Adresse eingeladen ist.',
    )
  })
  it('throws when a param is missing', () => {
    expect(() => t('auth.linkSent')).toThrow(/email/)
  })
})
```

- [ ] **Step 5: Test laufen lassen.** `vp test apps/web/src/i18n` muss FAIL melden (Modul fehlt).
- [ ] **Step 6: `de.ts` und `t.ts` umsetzen.**
  - Schlüssel: `'app.name': 'Vereinsbote'`, `'a11y.skipLink': 'Zum Inhalt springen'`, `'auth.linkSent': 'Wir haben einen Anmeldelink an {email} geschickt, falls die Adresse eingeladen ist.'`
  - `t` ersetzt `{name}` durch den Parameter und wirft einen Fehler, der den Namen des fehlenden Parameters nennt.
- [ ] **Step 7: Prüfen.** `vp test apps/web/src/i18n` meldet PASS.
- [ ] **Step 8: Drei Build-Ziele verdrahten.**
  - Das passiert schon hier, damit Unverträglichkeiten zwischen Vite+ (Vite 8, Rolldown) und den Plattform-Plugins am ersten Tag auffallen.
  - `apps/web/vite.config.ts` wählt die Plugins nach `process.env.VITE_VB_PLATFORM`, gemäß der Hosting-Doku von TanStack Start:
    - Node-Server: `node`
    - Nitro mit Vercel-Preset: `vercel`
    - `@cloudflare/vite-plugin`: `cloudflare`
  - Unter `process.env.VITEST` lädt die Konfiguration nur, was die Tests brauchen.
  - Prüfen: `vp run --filter web build:node && vp run --filter web build:vercel && vp run --filter web build:cloudflare` läuft fehlerfrei durch.
- [ ] **Step 9: Werkzeuge prüfen.**
  - `vp check` läuft fehlerfrei durch.
  - `pnpm check:catalog` endet mit Exit-Code 0. Mit einem probeweise eingetragenen `"zod": "^3.0.0"` in `apps/web/package.json` endet es mit Exit-Code 1 und nennt `web: zod = ^3.0.0`. Danach den Eintrag wieder entfernen.
  - `echo "Added Stuff." | pnpm exec commitlint` schlägt fehl. `echo "chore: scaffold monorepo" | pnpm exec commitlint` läuft fehlerfrei durch.
  - `vp hooks status` zeigt die Hooks als aktiv.
  - `git commit --allow-empty -m "Added Stuff."` wird vom `commit-msg`-Hook abgelehnt.
  - `vp dev` zeigt auf `/` den Text „Vereinsbote“.
- [ ] **Step 10: Commit:** `chore: scaffold monorepo with vite+ toolchain`. Der `commit-msg`-Hook muss dabei greifen.

---

### Task 2: Umgebungsvariablen

**Files:**
- Create: `apps/web/src/server/env.ts`, `apps/web/.env.example`
- Test: `apps/web/src/server/env.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Env {
  databaseUrl: string
  appUrl: URL
  appSecret: Uint8Array            // genau 32 Byte
  cronSecret: string
  setupToken: string | null
  microsoftLogin: { clientId: string; clientSecret: string; tenantId: string } | null
  devSmtpUrl: string | null
  heartbeatUrl: string | null
  tickIntervalMs: number
}
export class EnvError extends Error { readonly variables: string[] }
export function parseEnv(source: Record<string, string | undefined>): Env
```

**Regeln** (mit zod; `EnvError` sammelt alle Verstöße und nennt nur die Variablennamen):

| Variable | Regel |
|---|---|
| `DATABASE_URL` | Pflicht, beginnt mit `postgres://` oder `postgresql://` |
| `APP_URL` | Pflicht, `https:`; `http:` nur für `localhost` und `127.0.0.1` |
| `APP_SECRET` | Pflicht, Base64, decodiert genau 32 Byte |
| `CRON_SECRET` | Pflicht, ≥ 32 Zeichen |
| `SETUP_TOKEN` | optional, ≥ 24 Zeichen |
| `MS_LOGIN_CLIENT_ID`, `MS_LOGIN_CLIENT_SECRET`, `MS_LOGIN_TENANT_ID` | alle drei oder keine |
| `DEV_SMTP_URL` | optional, `smtp://` |
| `HEARTBEAT_URL` | optional, `https:` |
| `TICK_INTERVAL_MS` | optional, Ganzzahl ≥ 60000, Standard 900000 |

- [ ] **Step 1: Failing Test schreiben**

```ts
const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/vb',
  APP_URL: 'https://bote.example.org',
  APP_SECRET: Buffer.alloc(32, 7).toString('base64'),
  CRON_SECRET: 'c'.repeat(32),
}

it('accepts a minimal env with defaults', () => {
  const env = parseEnv(valid)
  expect(env.tickIntervalMs).toBe(900_000)
  expect(env.microsoftLogin).toBeNull()
  expect(env.setupToken).toBeNull()
  expect(env.appSecret).toHaveLength(32)
})
it('rejects an APP_SECRET that is not 32 bytes', () => {
  expect(() => parseEnv({ ...valid, APP_SECRET: 'abc' })).toThrow(EnvError)
})
it('allows http only for localhost', () => {
  expect(() => parseEnv({ ...valid, APP_URL: 'http://bote.example.org' })).toThrow(EnvError)
  expect(parseEnv({ ...valid, APP_URL: 'http://localhost:3000' }).appUrl.host).toBe('localhost:3000')
})
it('requires all MS_LOGIN_* or none', () => {
  expect(() => parseEnv({ ...valid, MS_LOGIN_CLIENT_ID: 'id' })).toThrow(/MS_LOGIN_/)
})
it('rejects a tick interval below one minute', () => {
  expect(() => parseEnv({ ...valid, TICK_INTERVAL_MS: '30000' })).toThrow(EnvError)
})
it('reports variable names but never secret values', () => {
  expect.assertions(2)
  try {
    parseEnv({ ...valid, APP_SECRET: 'geheim-zu-kurz' })
  } catch (e) {
    expect(String(e)).not.toContain('geheim-zu-kurz')
    expect((e as EnvError).variables).toEqual(['APP_SECRET'])
  }
})
```

- [ ] **Step 2: Test laufen lassen.** FAIL, weil `parseEnv` fehlt.
- [ ] **Step 3: `parseEnv` umsetzen.** `.env.example` mit allen Variablen und Kommentaren anlegen.
- [ ] **Step 4: Prüfen.** `vp test apps/web/src/server/env.test.ts` meldet PASS.
- [ ] **Step 5: Commit:** `feat: validate environment configuration`

---

### Task 3: Datenbank-Grundlage

**Files:**
- Create: `apps/web/drizzle.config.ts`, `src/server/db/schema/{index.ts,system.ts}`, `src/server/db/{client.ts,migrate.ts,migrate-cli.ts,test-db.ts}`, `src/server/system-state.ts`, `src/platform/context.ts`, `src/routes/api/health.ts`
- Test: `src/server/system-state.test.ts`

**Interfaces:**
- Consumes: `Env`, `parseEnv` (Task 2)
- Produces:

```ts
// db/client.ts
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
export function createDb(databaseUrl: string, driver: 'pg' | 'neon'): Promise<Db>
// db/migrate.ts
export function runMigrations(db: Db): Promise<void>   // Ordner apps/web/drizzle
// db/test-db.ts
export function createTestDb(): Promise<Db>            // PGlite im Speicher + runMigrations
// system-state.ts
export type StateKey = 'setup_completed_at' | 'last_tick' | 'tick_lock'
export function getState<T>(db: Db, key: StateKey): Promise<T | null>
export function setState(db: Db, key: StateKey, value: unknown): Promise<void>
// platform/context.ts
export type PlatformName = 'node' | 'vercel' | 'cloudflare'
export interface AppContext { env: Env; db: Db }       // Task 5 und Task 9 erweitern es
export function getAppContext(): Promise<AppContext>   // pro Isolate einmal erzeugt
```

- **Tabelle `system_state`:** `key text primary key`, `value jsonb not null`, `updated_at timestamptz not null default now()`.
- **Datenbanktreiber:**
  - `driver: 'neon'` nutzt `Pool` aus `@neondatabase/serverless`, mit WebSocket und Transaktionen. Das gilt auf Vercel und Cloudflare.
  - `driver: 'pg'` lädt `pg` per dynamischem Import. Das gilt im Node/Docker-Betrieb.
- **Plattform-Erkennung:**
  - Die Build-Konstante `import.meta.env.VITE_VB_PLATFORM` hat den Wert `node`, `vercel` oder `cloudflare`.
  - `getAppContext` liest die Umgebung auf Node und Vercel aus `process.env` und auf Cloudflare aus `env` von `cloudflare:workers`.
- **Skripte:** `vp run --filter web db:generate` (drizzle-kit generate) und `db:migrate` (`migrate-cli.ts` mit `DATABASE_URL`).

- [ ] **Step 1: Failing Test schreiben**

```ts
it('applies migrations to an empty database', async () => {
  const db = await createTestDb()
  await expect(getState(db, 'last_tick')).resolves.toBeNull()
})
it('setState upserts', async () => {
  const db = await createTestDb()
  await setState(db, 'last_tick', { n: 1 })
  await setState(db, 'last_tick', { n: 2 })
  expect(await getState(db, 'last_tick')).toEqual({ n: 2 })
})
```

- [ ] **Step 2: Test laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.** Schema, Client, Migrator, Test-DB, `system-state.ts` und `context.ts` schreiben. Dann mit `vp run --filter web db:generate` die erste Migration erzeugen.
- [ ] **Step 4: Prüfen.** `vp test apps/web/src/server/system-state.test.ts` meldet PASS.
- [ ] **Step 5: Health-Route anlegen.** `GET /api/health` führt `select 1` aus. Gelingt das, antwortet die Route mit 200 und `{ "ok": true }`, sonst mit 503 und `{ "ok": false }`. Prüfen: Mit laufendem `docker compose -f docker/compose.dev.yml up -d postgres` (Datei aus Task 10; bis dahin ein lokales Postgres) liefert `curl -s localhost:3000/api/health` die Antwort `{"ok":true}`.
- [ ] **Step 6: Commit:** `feat: add database layer, migrations and system state`

---

### Task 4: Verschlüsselung von Zugangsdaten

**Files:**
- Create: `apps/web/src/server/crypto/secrets.ts`
- Test: `apps/web/src/server/crypto/secrets.test.ts`

**Interfaces:**
- Produces:

```ts
export function deriveSecretsKey(appSecret: Uint8Array): Promise<CryptoKey>   // HKDF-SHA256, info 'vereinsbote:secrets:v1' → AES-GCM 256
export function deriveAuthSecret(appSecret: Uint8Array): Promise<string>      // HKDF-SHA256, info 'vereinsbote:auth:v1' → 32 Byte, base64url
export function encryptSecret(plaintext: string, key: CryptoKey): Promise<string>  // 'v1.<iv b64url>.<ciphertext b64url>', IV 12 Byte zufällig
export function decryptSecret(token: string, key: CryptoKey): Promise<string>
export class SecretDecryptError extends Error {}
```

Nur `globalThis.crypto.subtle` verwenden.

- [ ] **Step 1: Failing Test schreiben**

```ts
const appSecret = new Uint8Array(32).fill(9)

it('round-trips text including umlauts', async () => {
  const key = await deriveSecretsKey(appSecret)
  const token = await encryptSecret('Grüße & Geheimnis', key)
  expect(token.startsWith('v1.')).toBe(true)
  expect(await decryptSecret(token, key)).toBe('Grüße & Geheimnis')
})
it('uses a fresh IV for every encryption', async () => {
  const key = await deriveSecretsKey(appSecret)
  expect(await encryptSecret('x', key)).not.toBe(await encryptSecret('x', key))
})
it('rejects tampered ciphertext', async () => {
  const key = await deriveSecretsKey(appSecret)
  const [v, iv, ct] = (await encryptSecret('x', key)).split('.')
  const flipped = ct.slice(0, -2) + (ct.at(-2) === 'A' ? 'B' : 'A') + ct.at(-1)
  await expect(decryptSecret([v, iv, flipped].join('.'), key)).rejects.toBeInstanceOf(SecretDecryptError)
})
it('rejects a token encrypted with another key', async () => {
  const token = await encryptSecret('x', await deriveSecretsKey(appSecret))
  const other = await deriveSecretsKey(new Uint8Array(32).fill(1))
  await expect(decryptSecret(token, other)).rejects.toBeInstanceOf(SecretDecryptError)
})
it('rejects unknown versions', async () => {
  await expect(decryptSecret('v9.a.b', await deriveSecretsKey(appSecret))).rejects.toBeInstanceOf(SecretDecryptError)
})
it('derives a stable auth secret per app secret', async () => {
  expect(await deriveAuthSecret(appSecret)).toBe(await deriveAuthSecret(appSecret))
  expect(await deriveAuthSecret(appSecret)).not.toBe(await deriveAuthSecret(new Uint8Array(32).fill(1)))
})
```

- [ ] **Step 2: Test laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** `vp test apps/web/src/server/crypto` meldet PASS.
- [ ] **Step 5: Commit:** `feat: add AES-GCM secret encryption`

---

### Task 5: Anmeldung ohne Passwort

**Files:**
- Create: `src/server/db/schema/auth.ts`, `src/server/auth/{email.ts,auth.ts,session.ts}`, `src/server/users/repo.ts`, `src/server/mail/{system-mailer.ts,testing.ts}`, `src/routes/api/auth/$.ts`, `src/routes/login.tsx`
- Modify: `src/platform/context.ts` (`AppContext` bekommt `auth: Auth` und `mailer: SystemMailer`), `src/i18n/de.ts`
- Test: `src/server/auth/email.test.ts`, `src/server/auth/auth.test.ts`

**Interfaces:**
- Consumes: `Db`, `createTestDb` (Task 3), `Env` (Task 2), `deriveAuthSecret` (Task 4), `t` (Task 1)
- Produces:

```ts
// auth/email.ts
export function normalizeEmail(input: string): string
// mail/system-mailer.ts
export interface SystemMail { to: string; subject: string; text: string; html?: string }
export interface SystemMailer { send(mail: SystemMail): Promise<void> }
export class MailerNotConfiguredError extends Error {}
export function createSystemMailer(env: Env): SystemMailer  // devSmtpUrl gesetzt → nodemailer (dynamischer Import), sonst ein Mailer, der MailerNotConfiguredError wirft
// mail/testing.ts
export class CapturingMailer implements SystemMailer { readonly sent: SystemMail[] }
// users/repo.ts
export type UserStatus = 'invited' | 'active' | 'disabled'
export function insertUser(db: Db, input: { email: string; name: string; isAdmin?: boolean; status?: UserStatus }): Promise<{ id: string }>
export function findUserByEmail(db: Db, email: string): Promise<{ id: string; status: UserStatus; isAdmin: boolean } | null>
export function revokeSessions(db: Db, userId: string): Promise<void>
// auth/auth.ts
export type Auth = ReturnType<typeof betterAuth>
export function createAuth(deps: { db: Db; env: Env; mailer: SystemMailer }): Promise<Auth>
export function requestLoginLink(auth: Auth, email: string): Promise<void>
export class LoginLinkInvalidError extends Error {}
export function verifyLoginLink(auth: Auth, token: string): Promise<{ userId: string; setCookie: string }>
// auth/session.ts
export interface SessionUser { id: string; email: string; name: string; isAdmin: boolean }
export function getSessionUser(auth: Auth, db: Db, headers: Headers): Promise<SessionUser | null>
```

**Regeln:**
- **Tabellen:** Das Schema enthält die Better-Auth-Tabellen `user`, `session`, `account` und `verification`. `user` hat zusätzlich `is_admin boolean not null default false` und `status text not null default 'invited'` mit der Prüfung `status in ('invited','active','disabled')`. Auf `lower(email)` liegt ein Unique-Index.
- **Better Auth:**
  - Das Secret ist `deriveAuthSecret(env.appSecret)`, die `baseURL` ist `env.appUrl`.
  - E-Mail und Passwort sind abgeschaltet. Selbstregistrierung ist überall abgeschaltet.
- **Versand des Links:** Der Magic-Link-Callback verschickt nur, wenn `findUserByEmail` einen Benutzer mit einem Status ungleich `disabled` findet. Sonst wird still nichts verschickt. `requestLoginLink` verhält sich in allen Fällen gleich.
- **Gültigkeit:** Der Link ist 15 Minuten gültig und nur einmal verwendbar. Eine Sitzung gilt 7 Tage und verlängert sich bei Nutzung.
- **Erste Anmeldung:** Bei der ersten erfolgreichen Prüfung setzt die App den Status von `invited` auf `active`.
- **Microsoft:** Der Provider ist nur aktiv, wenn `env.microsoftLogin` gesetzt ist.
  - Er ist auf den `tenantId` beschränkt und erlaubt keine Registrierung.
  - Account-Linking verknüpft das Microsoft-Konto per verifizierter E-Mail mit dem eingeladenen Benutzer.
- **Sitzung:** `getSessionUser` liefert `null`, wenn keine Sitzung besteht oder der Benutzerstatus `disabled` ist.
- **Mail-Text:**
  - Betreff: `t('mail.login.subject')` = „Dein Anmeldelink für den Vereinsbote“
  - Text: `t('mail.login.text', { link })` = „Hallo,\n\nhier ist dein Anmeldelink:\n{link}\n\nDer Link ist 15 Minuten gültig und funktioniert einmal.“

- [ ] **Step 1: Failing Tests schreiben**

```ts
// email.test.ts
it('trims and lowercases', () => expect(normalizeEmail('  Anna@Verein.DE ')).toBe('anna@verein.de'))

// auth.test.ts
async function setup() {
  const db = await createTestDb()
  const mailer = new CapturingMailer()
  const env = parseEnv({ DATABASE_URL: 'postgres://x@localhost/x', APP_URL: 'https://bote.example.org',
    APP_SECRET: Buffer.alloc(32, 3).toString('base64'), CRON_SECRET: 'c'.repeat(32) })
  const auth = await createAuth({ db, env, mailer })
  return { db, mailer, auth }
}
const tokenFrom = (text: string) => /token=([^&\s]+)/.exec(text)![1]

it('sends a link to an invited user regardless of case and spaces', async () => {
  const { db, mailer, auth } = await setup()
  await insertUser(db, { email: 'anna@verein.de', name: 'Anna' })
  await requestLoginLink(auth, ' Anna@Verein.DE')
  expect(mailer.sent).toHaveLength(1)
  expect(mailer.sent[0].to).toBe('anna@verein.de')
  expect(mailer.sent[0].text).toContain('https://bote.example.org/')
})
it('sends nothing to unknown addresses', async () => {
  const { mailer, auth } = await setup()
  await expect(requestLoginLink(auth, 'fremd@example.org')).resolves.toBeUndefined()
  expect(mailer.sent).toHaveLength(0)
})
it('sends nothing to disabled users', async () => {
  const { db, mailer, auth } = await setup()
  await insertUser(db, { email: 'kim@verein.de', name: 'Kim', status: 'disabled' })
  await requestLoginLink(auth, 'kim@verein.de')
  expect(mailer.sent).toHaveLength(0)
})
it('activates an invited user on first verification and opens a session', async () => {
  const { db, mailer, auth } = await setup()
  const { id } = await insertUser(db, { email: 'anna@verein.de', name: 'Anna' })
  await requestLoginLink(auth, 'anna@verein.de')
  const { userId, setCookie } = await verifyLoginLink(auth, tokenFrom(mailer.sent[0].text))
  expect(userId).toBe(id)
  expect((await findUserByEmail(db, 'anna@verein.de'))!.status).toBe('active')
  const user = await getSessionUser(auth, db, new Headers({ cookie: setCookie.split(';')[0] }))
  expect(user).toMatchObject({ id, email: 'anna@verein.de', isAdmin: false })
})
it('rejects a link used twice', async () => {
  const { db, mailer, auth } = await setup()
  await insertUser(db, { email: 'anna@verein.de', name: 'Anna' })
  await requestLoginLink(auth, 'anna@verein.de')
  const token = tokenFrom(mailer.sent[0].text)
  await verifyLoginLink(auth, token)
  await expect(verifyLoginLink(auth, token)).rejects.toBeInstanceOf(LoginLinkInvalidError)
})
it('rejects a link after 15 minutes', async () => {
  vi.useFakeTimers()
  const { db, mailer, auth } = await setup()
  await insertUser(db, { email: 'anna@verein.de', name: 'Anna' })
  await requestLoginLink(auth, 'anna@verein.de')
  vi.advanceTimersByTime(16 * 60_000)
  await expect(verifyLoginLink(auth, tokenFrom(mailer.sent[0].text))).rejects.toBeInstanceOf(LoginLinkInvalidError)
  vi.useRealTimers()
})
it('getSessionUser returns null once the user is disabled', async () => {
  // anmelden wie oben, dann: await db.update(user).set({ status: 'disabled' }) …
  // erwartet: getSessionUser(...) === null
})
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.** Schema, Repo, Mailer, `createAuth`, die Hüllen-Funktionen und `getSessionUser` schreiben. Danach `vp run --filter web db:generate` für die Migration.
- [ ] **Step 4: Prüfen.** `vp test apps/web/src/server/auth` meldet PASS.
- [ ] **Step 5: Routen anlegen.**
  - `api/auth/$` leitet an `auth.handler` weiter.
  - `/login` hat ein Formular mit dem Feld „E-Mail“ und dem Button „Anmeldelink anfordern“. Danach zeigt die Seite `t('auth.linkSent', { email })`.
  - Ist Microsoft konfiguriert, gibt es zusätzlich den Button „Mit Microsoft anmelden“.
  - Prüfen: `vp check` läuft fehlerfrei.
- [ ] **Step 6: Commit:** `feat: add invite-only passwordless sign-in`

---

### Task 5a: Zweisprachigkeit (Deutsch und Englisch)

Wunsch des Projekts: Die Oberfläche ist von Beginn an zweisprachig. Dieser Task stellt das i18n-Modul aus Task 1 auf zwei Sprachen um und passt alle bis hierher vorhandenen Texte an.

**Files:**
- Create: `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/locale.ts`, `apps/web/src/i18n/translate.ts`, `apps/web/src/i18n/use-t.tsx`, `apps/web/src/server/i18n/request-locale.ts`, `apps/web/src/components/language-switcher.tsx`
- Modify: `apps/web/src/i18n/de.ts`, `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/login.tsx`, `apps/web/src/server/auth/auth.ts`, `apps/web/src/server/users/repo.ts`, `apps/web/src/server/db/schema/auth.ts` (+ Migration)
- Delete: `apps/web/src/i18n/t.ts` (ersetzt durch `translate` und `useT`)
- Test: `apps/web/src/i18n/locale.test.ts`, `apps/web/src/i18n/translate.test.ts`, `apps/web/src/server/auth/auth.test.ts` (Ergänzung)

**Interfaces:**
- Consumes: `de`, `t` (Task 1); `createAuth`, `requestLoginLink`, `insertUser`, `findUserByEmail`, `getSessionUser` (Task 5); `getAppContext` (Task 3)
- Produces:

```ts
// i18n/locale.ts
export const SUPPORTED_LOCALES = ['de', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'de'
export const LOCALE_COOKIE = 'locale'
export function isLocale(value: unknown): value is Locale
export function resolveLocale(input: { cookie: string | null; acceptLanguage: string | null }): Locale
// i18n/translate.ts
export type MessageKey = keyof typeof de
export type MessageParams = Readonly<Record<string, string | number>>
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string
// i18n/use-t.tsx
export function LocaleProvider(props: { locale: Locale; children: ReactNode }): ReactNode
export function useLocale(): Locale
export function useT(): (key: MessageKey, params?: MessageParams) => string
// server/i18n/request-locale.ts
export function getRequestLocale(headers: Headers): Locale
// users/repo.ts (Änderung)
// insertUser(db, { email, name, isAdmin?, status?, locale? }) — locale Standard 'de'
// findUserByEmail(...) liefert zusätzlich locale: Locale
```

**Regeln:**
- `en` ist als `Record<MessageKey, string>` typisiert. Fehlt ein Schlüssel, schlägt `vp check` fehl.
- `t()` aus Task 1 entfällt. Komponenten nutzen `useT()`, Server-Code nutzt `translate(locale, …)`.
- **Sprachwahl:** Ein gültiges Cookie `locale` gewinnt. Sonst gilt die erste unterstützte Sprache aus `Accept-Language` nach q-Wert (`de-AT` → `de`, `en-GB` → `en`). Sonst `de`.
- `<html lang>` ist die aufgelöste Sprache. Das Ziel des Skip-Links heißt `#main-content` (statt `#inhalt`), passend zur Regel „Code ist englisch“.
- **Sprachumschalter** im Kopf jeder Seite:
  - zwei Schaltflächen „Deutsch“ (`lang="de"`) und „English“ (`lang="en"`); die aktuelle trägt `aria-current="true"`
  - setzt das Cookie `locale` (1 Jahr, `SameSite=Lax`, `Path=/`) und lädt die Seite neu
  - ist ein Benutzer angemeldet, speichert er zusätzlich `user.locale`
- **Datenbank:** `user.locale text not null default 'de'` mit der Prüfung `locale in ('de','en')`.
- **Systemmails** gehen in der Sprache des Empfängers (`user.locale`). Der Anmeldelink nutzt die gespeicherte Sprache des Benutzers.
- **Englische Texte** für alle vorhandenen Schlüssel. Verbindlich sind:
  - `'a11y.skipLink'`: „Skip to content“
  - `'auth.linkSent'`: „We have sent a sign-in link to {email} if the address has been invited.“
  - `'mail.login.subject'`: „Your sign-in link for Vereinsbote“
  - `'mail.login.text'`: „Hello,\n\nhere is your sign-in link:\n{link}\n\nThe link is valid for 15 minutes and works once.“
  - Feld „Email“, Button „Request sign-in link“, Button „Sign in with Microsoft“
  - `'app.name'` ist in beiden Sprachen „Vereinsbote“.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// locale.test.ts
it.each([
  [{ cookie: 'en', acceptLanguage: 'de-DE' }, 'en'],
  [{ cookie: 'fr', acceptLanguage: 'en-GB,en;q=0.9' }, 'en'],
  [{ cookie: null, acceptLanguage: 'fr-FR, de-AT;q=0.8, en;q=0.5' }, 'de'],
  [{ cookie: null, acceptLanguage: 'fr-FR, en;q=0.9, de;q=0.8' }, 'en'],
  [{ cookie: null, acceptLanguage: 'fr' }, 'de'],
  [{ cookie: null, acceptLanguage: null }, 'de'],
] as const)('resolveLocale(%o) is %s', (input, expected) => expect(resolveLocale(input)).toBe(expected))

// translate.test.ts
it('translates per locale', () => {
  expect(translate('de', 'a11y.skipLink')).toBe('Zum Inhalt springen')
  expect(translate('en', 'a11y.skipLink')).toBe('Skip to content')
})
it('interpolates and names missing params in both locales', () => {
  expect(translate('en', 'auth.linkSent', { email: 'kim@v.de' })).toBe(
    'We have sent a sign-in link to kim@v.de if the address has been invited.')
  expect(() => translate('de', 'auth.linkSent')).toThrow(/email/)
  expect(() => translate('en', 'auth.linkSent')).toThrow(/email/)
})
it('uses the same placeholders in de and en for every key', () => {
  // für jeden Schlüssel: Menge der {name}-Platzhalter in de === in en
})

// auth.test.ts (Ergänzung)
it("sends the sign-in link in the user's language", async () => {
  // insertUser(..., locale: 'en') → requestLoginLink → mailer.sent[0].subject === 'Your sign-in link for Vereinsbote'
})
it('stores de as the default locale', async () => {
  // insertUser ohne locale → findUserByEmail(...).locale === 'de'
})
```

- [ ] **Step 2: Tests laufen lassen.** `vp test apps/web/src/i18n apps/web/src/server/auth` meldet FAIL.
- [ ] **Step 3: Umsetzen.** `locale.ts`, `translate.ts`, `en.ts`, `use-t.tsx`, `request-locale.ts`, Schema-Spalte und Migration (`vp run --filter web db:generate`), `repo.ts`, Mailsprache in `auth.ts`. Alle bisherigen `t(...)`-Aufrufe auf `useT()` bzw. `translate(...)` umstellen.
- [ ] **Step 4: Prüfen.** `vp test` meldet PASS, `vp check` läuft fehlerfrei durch.
- [ ] **Step 5: Oberfläche.**
  - `__root.tsx` ermittelt die Sprache serverseitig aus der Anfrage, setzt `<html lang>`, umschließt die App mit `LocaleProvider`, nutzt `#main-content` und zeigt den Sprachumschalter.
  - Der Umschalter ist per Tastatur bedienbar und hat einen sichtbaren Fokus.
  - Prüfen: `vp check`, `vp run --filter web build:node`. Mit `vp dev` zeigt `/login` bei `Accept-Language: en` die englischen Texte und nach Klick auf „Deutsch“ die deutschen.
- [ ] **Step 6: Commit:** `feat: add german and english ui`

---

### Task 6: Bereiche, Stufen und Aktivitätsprotokoll

**Files:**
- Create: `src/server/db/schema/{areas.ts,audit.ts}`, `src/server/permissions/{levels.ts,principal.ts}`, `src/server/audit/audit.ts`
- Test: `src/server/permissions/levels.test.ts`, `src/server/permissions/principal.test.ts`, `src/server/audit/audit.test.ts`

**Interfaces:**
- Consumes: `Db`, `createTestDb` (Task 3), `insertUser` (Task 5)
- Produces:

```ts
// permissions/levels.ts
export type AccessLevel = 'read' | 'edit' | 'send'
export function levelAtLeast(have: AccessLevel | null, need: AccessLevel): boolean
// permissions/principal.ts
export interface Principal { userId: string; isAdmin: boolean; areas: ReadonlyMap<string, AccessLevel> }
export function loadPrincipal(db: Db, userId: string): Promise<Principal | null>   // null: unbekannt oder disabled
export function canAccessArea(p: Principal, areaId: string, need: AccessLevel): boolean
export class ForbiddenError extends Error {}
export function assertArea(p: Principal, areaId: string, need: AccessLevel): void
export function assertAdmin(p: Principal): void
// audit/audit.ts
export type AuditAction = 'setup.completed' | 'user.invited' | 'user.disabled' | 'user.admin_changed'
  | 'user.area_level_changed' | 'area.created' | 'area.renamed'
export function writeAudit(db: Db, entry: { actorUserId: string | null; action: AuditAction;
  target?: string; details?: Record<string, unknown>; at?: Date }): Promise<void>
```

**Schema:**
- **`areas`:** `id uuid pk default gen_random_uuid()`, `name text not null`, `created_at timestamptz not null default now()`. Unique-Index auf `lower(name)`.
- **`area_memberships`:**
  - `user_id text not null references user(id) on delete cascade`
  - `area_id uuid not null references areas(id) on delete cascade`
  - `level text not null check (level in ('read','edit','send'))`
  - Primärschlüssel `(user_id, area_id)`
- **`audit_log`:**
  - `id bigserial pk`, `at timestamptz not null default now()`
  - `actor_user_id text null references user(id) on delete set null`
  - `action text not null`, `target text null`, `details jsonb null`

- [ ] **Step 1: Failing Tests schreiben**

```ts
// levels.test.ts
it.each([
  [null, 'read', false], ['read', 'read', true], ['read', 'edit', false],
  ['edit', 'read', true], ['send', 'edit', true], ['edit', 'send', false],
] as const)('%s >= %s is %s', (have, need, ok) => expect(levelAtLeast(have, need)).toBe(ok))

// principal.test.ts
it('admin without membership has no area access', async () => {
  const db = await createTestDb()
  const { id } = await insertUser(db, { email: 'a@v.de', name: 'A', isAdmin: true, status: 'active' })
  const [area] = await db.insert(areas).values({ name: 'Finanzen' }).returning()
  const p = (await loadPrincipal(db, id))!
  expect(p.isAdmin).toBe(true)
  expect(canAccessArea(p, area.id, 'read')).toBe(false)
  expect(() => assertArea(p, area.id, 'read')).toThrow(ForbiddenError)
})
it('member with edit can read and edit but not send', async () => { /* membership level 'edit' → read true, edit true, send false */ })
it('disabled user has no principal', async () => { /* status 'disabled' → loadPrincipal === null */ })

// audit.test.ts
it('stores an entry with details', async () => {
  const db = await createTestDb()
  await writeAudit(db, { actorUserId: null, action: 'area.created', target: 'area:1', details: { name: 'Finanzen' } })
  const rows = await db.select().from(auditLog)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ action: 'area.created', target: 'area:1', details: { name: 'Finanzen' } })
})
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.** Danach `db:generate`.
- [ ] **Step 4: Prüfen.** `vp test apps/web/src/server/permissions apps/web/src/server/audit` meldet PASS.
- [ ] **Step 5: Commit:** `feat: add areas, access levels and audit log`

---

### Task 7: Ersteinrichtung

**Files:**
- Create: `src/server/setup/setup.ts`, `src/routes/setup.tsx`
- Modify: `src/server/auth/auth.ts` (neu: `createSessionFor`), `src/i18n/de.ts`
- Test: `src/server/setup/setup.test.ts`

**Interfaces:**
- Consumes: `insertUser` (Task 5), `areas`, `area_memberships`, `writeAudit` (Task 6), `getState`, `setState`, `system_state` (Task 3)
- Produces:

```ts
export class SetupDisabledError extends Error {}
export class SetupTokenInvalidError extends Error {}
export class SetupAlreadyDoneError extends Error {}
export function isSetupDone(db: Db): Promise<boolean>
export function completeSetup(db: Db, input: { token: string; expectedToken: string | null;
  adminEmail: string; adminName: string }): Promise<{ adminUserId: string }>
// auth/auth.ts
export function createSessionFor(auth: Auth, userId: string): Promise<{ setCookie: string }>
```

**Ablauf von `completeSetup`:**
1. Ist `expectedToken === null`, wirft die Funktion `SetupDisabledError`.
2. Der Token wird in konstanter Zeit verglichen. Stimmt er nicht, wirft sie `SetupTokenInvalidError`.
3. Alles Weitere passiert in **einer Transaktion**:
   1. `INSERT` (ohne Upsert) von `system_state('setup_completed_at', now)`. Bei einer Unique-Verletzung wirft sie `SetupAlreadyDoneError`.
   2. Admin anlegen, mit `isAdmin: true` und Status `active`.
   3. Die Bereiche „Mitglieder“ und „Finanzen“ anlegen.
   4. Mitgliedschaft Admin → Mitglieder mit der Stufe `edit` anlegen (Spec 6.7).
   5. `writeAudit` mit `setup.completed`.

**Route `/setup`:**
- **Wenn die Einrichtung bereits erledigt ist:** Die Seite zeigt `t('setup.done')` = „Die Einrichtung ist abgeschlossen.“ und einen Link „Zur Anmeldung“.
- **Formular:** die Felder „Einrichtungs-Token“, „Name“ und „E-Mail“ und der Button „Einrichtung abschließen“.
- **Nach Erfolg:** `createSessionFor` und ein Redirect auf `/admin/users`.
- **Fehler:** Sie werden am Formular angezeigt.
  - `t('setup.tokenInvalid')` = „Das Einrichtungs-Token stimmt nicht.“
  - `t('setup.disabled')` = „Die Einrichtung ist nicht freigeschaltet. Setze SETUP_TOKEN.“

- [ ] **Step 1: Failing Tests schreiben**

```ts
const input = { token: 't'.repeat(24), expectedToken: 't'.repeat(24), adminEmail: ' Admin@Verein.de', adminName: 'Alex' }

it('refuses when no token is configured', async () => {
  const db = await createTestDb()
  await expect(completeSetup(db, { ...input, expectedToken: null })).rejects.toBeInstanceOf(SetupDisabledError)
})
it('refuses a wrong token and creates nothing', async () => {
  const db = await createTestDb()
  await expect(completeSetup(db, { ...input, token: 'x'.repeat(24) })).rejects.toBeInstanceOf(SetupTokenInvalidError)
  expect(await isSetupDone(db)).toBe(false)
  expect(await db.select().from(user)).toHaveLength(0)
})
it('creates admin, default areas and edit access to Mitglieder', async () => {
  const db = await createTestDb()
  const { adminUserId } = await completeSetup(db, input)
  const p = (await loadPrincipal(db, adminUserId))!
  const all = await db.select().from(areas)
  expect(all.map((a) => a.name).sort()).toEqual(['Finanzen', 'Mitglieder'])
  const mitglieder = all.find((a) => a.name === 'Mitglieder')!
  const finanzen = all.find((a) => a.name === 'Finanzen')!
  expect(p.isAdmin).toBe(true)
  expect(canAccessArea(p, mitglieder.id, 'edit')).toBe(true)
  expect(canAccessArea(p, finanzen.id, 'read')).toBe(false)
  expect((await findUserByEmail(db, 'admin@verein.de'))!.status).toBe('active')
  expect((await db.select().from(auditLog)).map((r) => r.action)).toEqual(['setup.completed'])
})
it('refuses a second setup', async () => {
  const db = await createTestDb()
  await completeSetup(db, input)
  await expect(completeSetup(db, input)).rejects.toBeInstanceOf(SetupAlreadyDoneError)
})
it('creates exactly one admin when submitted twice in parallel', async () => {
  const db = await createTestDb()
  const results = await Promise.allSettled([completeSetup(db, input), completeSetup(db, input)])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
  expect(rejected.reason).toBeInstanceOf(SetupAlreadyDoneError)
  expect(await db.select().from(user)).toHaveLength(1)
})
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: `completeSetup`, `isSetupDone` und `createSessionFor` umsetzen.**
- [ ] **Step 4: Prüfen.** `vp test apps/web/src/server/setup` meldet PASS.
- [ ] **Step 5: Route `/setup` bauen.** Mit React Aria `TextField` und `Button`. Fehler sind über `aria-describedby` verknüpft. Prüfen: `vp check`.
- [ ] **Step 6: Commit:** `feat: add one-time setup with first admin`

---

### Task 8: Benutzer und Bereiche verwalten

**Files:**
- Create: `src/server/users/users.ts`, `src/server/areas/areas.ts`, `src/routes/admin/{route.tsx,users.tsx,areas.tsx}`
- Modify: `src/routes/index.tsx` (Startseite „Deine Bereiche“), `src/i18n/de.ts`
- Test: `src/server/users/users.test.ts`, `src/server/areas/areas.test.ts`

**Interfaces:**
- Consumes: `Principal`, `assertAdmin`, `ForbiddenError`, `AccessLevel`, `writeAudit` (Task 6); `insertUser`, `findUserByEmail`, `revokeSessions`, `SystemMailer`, `CapturingMailer` (Task 5); `Locale`, `translate`, `useT` (Task 5a)
- Produces:

```ts
// users/users.ts
export class UserExistsError extends Error {}
export class LastAdminError extends Error {}
export interface UserRow { id: string; email: string; name: string; isAdmin: boolean; status: UserStatus;
  levels: Record<string, AccessLevel> }   // areaId → Stufe
export function inviteUser(deps: { db: Db; mailer: SystemMailer; appUrl: URL }, actor: Principal,
  input: { email: string; name: string; isAdmin: boolean; locale: Locale }): Promise<{ userId: string }>
export function setAdmin(db: Db, actor: Principal, userId: string, isAdmin: boolean): Promise<void>
export function disableUser(db: Db, actor: Principal, userId: string): Promise<void>
export function setAreaLevel(db: Db, actor: Principal, input: { userId: string; areaId: string; level: AccessLevel | null }): Promise<void>
export function listUsersWithLevels(db: Db, actor: Principal): Promise<UserRow[]>
// areas/areas.ts
export class AreaExistsError extends Error {}
export function createArea(db: Db, actor: Principal, name: string): Promise<{ areaId: string }>   // trim, 1–60 Zeichen
export function renameArea(db: Db, actor: Principal, areaId: string, name: string): Promise<void>
export function listAreas(db: Db, actor: Principal): Promise<Array<{ id: string; name: string; level: AccessLevel | null }>>
```

**Regeln:**
- **Rechte:** Alle schreibenden Funktionen und `listUsersWithLevels` verlangen `assertAdmin`.
- **Protokoll:** Jede Änderung schreibt `writeAudit`. Bei Stufenänderungen enthält es `details: { areaId, from, to }`.
- **`listAreas`:** Admins sehen alle Bereiche, alle anderen nur ihre eigenen. Das Feld `level` ist die eigene Stufe des Aufrufers.
- **Letzter Admin:** Er darf nicht gesperrt und nicht entmachtet werden. Beides wirft `LastAdminError`. Gezählt werden Admins mit Status ungleich `disabled`.
- **Sperren:** `disableUser` setzt den Status `disabled` und ruft `revokeSessions` auf.
- **Einladungs-Mail:**
  - Betreff: `t('mail.invite.subject')` = „Einladung zum Vereinsbote“
  - Text: `t('mail.invite.text', { name, link })` = „Hallo {name},\n\ndu wurdest zum Vereinsbote eingeladen. Melde dich hier an:\n{link}“
  - `link` ist `new URL('/login', appUrl)`.
  - Die Einladung geht in der Sprache `input.locale` raus; das Einladungsformular hat dafür ein Auswahlfeld „Sprache“ (Standard: Sprache der einladenden Person). Englische Texte: Betreff „Invitation to Vereinsbote“, Text „Hello {name},\n\nyou have been invited to Vereinsbote. Sign in here:\n{link}“.

**Oberfläche:**
- **`admin/route.tsx`** schützt alle Unterseiten.
  - Ohne Sitzung leitet es auf `/login` um.
  - Ohne Admin-Rolle zeigt es die Überschrift „Kein Zugriff“ mit HTTP-Status 403.
- **`/admin/users`:**
  - Eine Tabelle mit einer Zeile pro Benutzer und einer Spalte pro Bereich.
  - Jede Zelle ist ein React-Aria-`Select` mit dem Label „{Bereich} für {Name}“ und den Optionen „Kein Zugriff“, „Lesen“, „Bearbeiten“ und „Versenden“.
  - Ein Einladungsformular mit den Feldern „Name“ und „E-Mail“, einer Checkbox „Admin“ und dem Button „Einladen“.
  - Ein Button „Sperren“ öffnet einen Dialog mit „Ja, sperren“.
- **`/admin/areas`:** Bereiche anlegen und umbenennen.
- **Startseite `/`:**
  - Ohne Sitzung leitet sie auf `/login` um.
  - Sonst zeigt sie die Überschrift „Deine Bereiche“ und eine Liste im Format „{Bereich} – {Stufe}“, z. B. „Finanzen – Lesen“.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// users.test.ts – Hilfsfunktion: admin(db) legt einen aktiven Admin an und liefert seinen Principal
it('only admins can invite', async () => {
  const db = await createTestDb()
  const { id } = await insertUser(db, { email: 'kim@v.de', name: 'Kim', status: 'active' })
  const kim = (await loadPrincipal(db, id))!
  await expect(inviteUser({ db, mailer: new CapturingMailer(), appUrl: new URL('https://b.example.org') }, kim,
    { email: 'x@v.de', name: 'X', isAdmin: false, locale: 'de' })).rejects.toBeInstanceOf(ForbiddenError)
})
it('normalizes the address and sends an invitation linking to /login', async () => {
  const db = await createTestDb(); const mailer = new CapturingMailer(); const a = await admin(db)
  await inviteUser({ db, mailer, appUrl: new URL('https://b.example.org') }, a, { email: ' Kim@V.de', name: 'Kim', isAdmin: false, locale: 'de' })
  expect(mailer.sent[0]).toMatchObject({ to: 'kim@v.de', subject: 'Einladung zum Vereinsbote' })
  expect(mailer.sent[0].text).toContain('https://b.example.org/login')
})
it('rejects inviting an existing address in other case', async () => { /* zweimal einladen, 'KIM@v.de' → UserExistsError */ })
it('refuses to disable or demote the last active admin', async () => {
  const db = await createTestDb(); const a = await admin(db)
  await expect(disableUser(db, a, a.userId)).rejects.toBeInstanceOf(LastAdminError)
  await expect(setAdmin(db, a, a.userId, false)).rejects.toBeInstanceOf(LastAdminError)
})
it('allows demoting an admin when another active admin exists', async () => { /* zweiter Admin → setAdmin(a, b, false) ok */ })
it('disabling a user revokes all sessions', async () => {
  // Kim anlegen und eine Sitzungszeile einfügen; disableUser(a, kim) →
  // status 'disabled' und keine Zeilen mehr in session für Kim
})
it('setAreaLevel null removes access and writes an audit entry', async () => {
  // Stufe 'read' setzen, dann null → loadPrincipal(kim).areas.has(areaId) === false
  // letzter Protokolleintrag: action 'user.area_level_changed', details { areaId, from: 'read', to: null }
})

// areas.test.ts
it('rejects duplicate names case-insensitively', async () => {
  const db = await createTestDb(); const a = await admin(db)
  await createArea(db, a, 'Veranstaltungen')
  await expect(createArea(db, a, ' veranstaltungen ')).rejects.toBeInstanceOf(AreaExistsError)
})
it('non-admins list only their own areas with their level', async () => { /* Kim mit read auf Finanzen → [{ name: 'Finanzen', level: 'read' }] */ })
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: `users.ts` und `areas.ts` umsetzen.**
- [ ] **Step 4: Prüfen.** `vp test apps/web/src/server/users apps/web/src/server/areas` meldet PASS.
- [ ] **Step 5: Oberfläche bauen.** Die Routen wie oben beschrieben anlegen. Prüfen: `vp check`. Die Seiten werden in Task 10 per E2E und axe geprüft.
- [ ] **Step 6: Commit:** `feat: add user and area administration`

---

### Task 9: Zeitsteuerung

**Files:**
- Create: `src/server/tick/{tick.ts,steps.ts,http.ts}`, `src/platform/platform.ts`, `src/routes/api/tick.ts`, `src/platform/cloudflare-worker.ts` (eigener Worker-Entry mit `fetch` und `scheduled`), `src/platform/node-server.ts` (eigener Server-Entry mit Intervall)
- Modify: `src/platform/context.ts` (`AppContext` bekommt `platform: Platform`), `apps/web/vite.config.ts` (die eigenen Entries für Cloudflare und Node eintragen)
- Test: `src/server/tick/tick.test.ts`, `src/server/tick/http.test.ts`

**Interfaces:**
- Consumes: `Db`, `getState`, `setState`, `system_state` (Task 3), `Env` (Task 2)
- Produces:

```ts
// tick/tick.ts
export interface TickContext { db: Db; env: Env; now: () => Date; deadline: number }   // deadline in epoch ms
export interface TickStep { name: string; run(ctx: TickContext): Promise<{ moreWork: boolean }> }
export type TickStepResult = { name: string; outcome: 'done' | 'skipped' | 'error'; error?: string }
export type CompletedTick = { status: 'completed'; startedAt: string; finishedAt: string; steps: TickStepResult[]; moreWork: boolean }
export type TickReport = CompletedTick | { status: 'locked' }
export const TICK_BUDGET_MS = 240_000
export function runTick(deps: { db: Db; env: Env; steps: TickStep[]; budgetMs?: number;
  now?: () => Date; holderId?: string; fetchFn?: typeof fetch }): Promise<TickReport>
export function getLastTick(db: Db): Promise<CompletedTick | null>
// tick/steps.ts
export const tickSteps: TickStep[]          // in Teilplan 1 leer; spätere Teilpläne hängen Schritte an
// platform/platform.ts
export interface Platform { name: PlatformName; waitUntil(p: Promise<unknown>): void }
// tick/http.ts
export function handleTickRequest(request: Request, deps: { env: Env; platform: Platform;
  run: () => Promise<TickReport>; fetchFn?: typeof fetch }): Promise<Response>
```

**Verhalten von `runTick`:**
- **Sperre:**
  - Die Sperre liegt in `system_state('tick_lock')` als `{ holderId, expiresAt }`. Die Dauer ist `budgetMs + 60_000`.
  - Erworben wird sie atomar: `INSERT … ON CONFLICT (key) DO UPDATE … WHERE (system_state.value->>'expiresAt')::timestamptz < now() RETURNING`. Kommt keine Zeile zurück, liefert `runTick` `{ status: 'locked' }`.
  - Am Ende wird sie freigegeben, aber nur, wenn `holderId` passt. Das gilt auch bei einem Fehler.
- **Schritte:**
  - Sie laufen nacheinander.
  - Ein Schritt startet nur, wenn `now() < deadline`. Sonst ist er `skipped`, und `moreWork` ist `true`.
  - Wirft ein Schritt, ist er `error` mit `error: message`, und die nächsten Schritte laufen trotzdem.
  - `moreWork` ist das ODER über alle Schritte.
- **Bericht:** Er wird unter `system_state('last_tick')` gespeichert.
- **Heartbeat:** Danach ruft `runTick` einmal `fetchFn(env.heartbeatUrl)` auf, falls gesetzt. Fehler dabei werden nur geloggt.

**Verhalten von `handleTickRequest`:**
- Es akzeptiert GET (Vercel Cron) und POST.
- Fehlt der Header `Authorization: Bearer <CRON_SECRET>` (Vergleich in konstanter Zeit), antwortet es mit 401 und ohne `run()`.
- Sonst antwortet es mit 200 und dem Bericht als JSON.
- Bei `moreWork` ruft es `platform.waitUntil(fetchFn(new URL('/api/tick', env.appUrl).toString(), { method: 'POST', headers: { authorization } }))` auf.

**Plattform-Anbindung:**
- **Vercel:** `vercel.json` → `crons: [{ path: '/api/tick', schedule: '*/15 * * * *' }]`. Vercel sendet `Authorization: Bearer $CRON_SECRET`.
- **Cloudflare:** `wrangler.jsonc` → `triggers.crons: ['*/15 * * * *']`. Der Worker-Entry bekommt einen `scheduled`-Handler, der `runTick` direkt mit `ctx.waitUntil` aufruft.
- **Node:** Der Server-Entry ruft alle `env.tickIntervalMs` `runTick` auf.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// tick.test.ts – env aus parseEnv wie in Task 5, ein Schritt-Generator: step(name, impl)
it('runs steps in order and stores the report', async () => {
  const db = await createTestDb(); const order: string[] = []
  const r = await runTick({ db, env, steps: [step('a', async () => { order.push('a'); return { moreWork: false } }),
    step('b', async () => { order.push('b'); return { moreWork: false } })] })
  expect(order).toEqual(['a', 'b'])
  expect(r).toMatchObject({ status: 'completed', moreWork: false })
  expect(await getLastTick(db)).toMatchObject({ status: 'completed' })
})
it('continues after a failing step', async () => { /* a wirft 'kaputt' → steps [{a,error,'kaputt'},{b,done}] */ })
it('skips steps after the deadline and reports more work', async () => {
  // now() liefert vor Schritt b einen Zeitpunkt jenseits von budgetMs → b 'skipped', moreWork true
})
it('propagates moreWork from a step', async () => { /* Schritt liefert moreWork true → Bericht moreWork true */ })
it('refuses to run while another tick holds the lock', async () => {
  const db = await createTestDb(); let release!: () => void
  const slow = step('slow', () => new Promise((res) => { release = () => res({ moreWork: false }) }))
  const first = runTick({ db, env, steps: [slow], holderId: 'A' })
  await vi.waitFor(() => expect(release).toBeDefined())
  expect(await runTick({ db, env, steps: [], holderId: 'B' })).toEqual({ status: 'locked' })
  release(); await first
  expect((await runTick({ db, env, steps: [], holderId: 'B' })).status).toBe('completed')
})
it('takes over an expired lock', async () => {
  // setState(db, 'tick_lock', { holderId: 'X', expiresAt: <vor 1 Minute> }) → runTick → 'completed'
})
it('pings the heartbeat once and ignores its failure', async () => {
  const fetchFn = vi.fn().mockRejectedValue(new Error('offline'))
  const r = await runTick({ db, env: { ...env, heartbeatUrl: 'https://hc.example.org/x' }, steps: [], fetchFn })
  expect(r.status).toBe('completed'); expect(fetchFn).toHaveBeenCalledTimes(1)
})

// http.test.ts
it('rejects requests without the cron secret', async () => {
  const run = vi.fn()
  const res = await handleTickRequest(new Request('https://b.example.org/api/tick', { method: 'POST' }), { env, platform, run })
  expect(res.status).toBe(401); expect(run).not.toHaveBeenCalled()
})
it('accepts GET with the bearer secret', async () => { /* GET + Authorization → 200, run 1× */ })
it('chains one follow-up tick when more work is left', async () => {
  const waits: Promise<unknown>[] = []; const fetchFn = vi.fn().mockResolvedValue(new Response())
  const res = await handleTickRequest(authorizedPost(), { env, fetchFn,
    platform: { name: 'node', waitUntil: (p) => waits.push(p) },
    run: async () => ({ status: 'completed', startedAt: '', finishedAt: '', steps: [], moreWork: true }) })
  await Promise.all(waits)
  expect(res.status).toBe(200)
  expect(fetchFn).toHaveBeenCalledWith('https://bote.example.org/api/tick',
    expect.objectContaining({ method: 'POST' }))
})
it('does not chain when no work is left', async () => { /* moreWork false → fetchFn nicht aufgerufen */ })
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: `runTick`, `getLastTick`, `tickSteps`, `handleTickRequest` und `Platform` umsetzen.**
- [ ] **Step 4: Prüfen.** `vp test apps/web/src/server/tick` meldet PASS.
- [ ] **Step 5: Plattform verdrahten.**
  - Route `api/tick` auf `handleTickRequest` mit `run: () => runTick({ …, steps: tickSteps })`.
  - Cron-Einträge in `vercel.json` und `wrangler.jsonc`.
  - `scheduled`-Handler in `platform/cloudflare-worker.ts`.
  - Intervall in `platform/node-server.ts`.
  - Prüfen: `vp check`.
- [ ] **Step 6: Commit:** `feat: add locked, budgeted tick runner with cron wiring`

---

### Task 10: Deploy, Docker, CI und E2E

**Files:**
- Create: `docker/Dockerfile`, `docker/compose.yml`, `docker/compose.dev.yml`, `.github/workflows/ci.yml`, `apps/web/playwright.config.ts`, `apps/web/e2e/helpers/{mailpit.ts,a11y.ts}`, `apps/web/e2e/fundament.e2e.ts`
- Modify: `apps/web/package.json` (Deploy-Skripte), `apps/web/vercel.json`, `apps/web/wrangler.jsonc`, `src/platform/node-server.ts`, `README.md`

**Interfaces:**
- Consumes: alle vorherigen Tasks. Die Build-Skripte stammen aus Task 1.
- Produces:
  - **Deploy:**
    - `deploy:cloudflare` = `vp run db:migrate && wrangler deploy`
    - Das Vercel-`buildCommand` ist `vp run --filter web db:migrate && vp run --filter web build:vercel`.
    - `node-server.ts` führt `runMigrations` vor dem Start aus.
  - **E2E-Helfer:**
    - `expectNoA11yViolations(page: Page): Promise<void>`, mit den axe-Tags aus den Global Constraints
    - `latestLink(to: string, pattern: RegExp): Promise<string>`, liest über die Mailpit-API `http://localhost:8025/api/v1/…`
  - **Playwright** sucht nur `**/*.e2e.ts`.

- [ ] **Step 1: Cloudflare-Bundle prüfen.**
  - Nach `vp run --filter web build:cloudflare` liefert `grep -rlE "nodemailer|from \"pg\"" apps/web/dist/cloudflare` keine Treffer.
  - Diese Prüfung kommt als eigener Schritt in den CI-Job `build`.
- [ ] **Step 2: Docker einrichten.**
  - `Dockerfile`: Multi-Stage auf `node:26-alpine`. Vite+ braucht dort `libstdc++`. Der Container startet `dist/node`.
  - `compose.yml`: `app` und `postgres:19` mit Healthchecks.
  - `compose.dev.yml`: `postgres:19` auf Port 5432 und `axllent/mailpit` auf den Ports 1025 und 8025.
  - Prüfen: `docker compose -f docker/compose.yml up -d --build`. Danach liefert `curl -s localhost:3000/api/health` die Antwort `{"ok":true}`.
- [ ] **Step 3: Failing E2E-Test schreiben** (`apps/web/e2e/fundament.e2e.ts`)

```ts
test('setup, invitation, sign-in, permissions and blocking', async ({ page, browser }) => {
  await page.goto('/setup'); await expectNoA11yViolations(page)
  await page.getByLabel('Einrichtungs-Token').fill(process.env.SETUP_TOKEN!)
  await page.getByLabel('Name').fill('Alex Admin')
  await page.getByLabel('E-Mail').fill('admin@verein.test')
  await page.getByRole('button', { name: 'Einrichtung abschließen' }).click()
  await expect(page).toHaveURL(/\/admin\/users$/); await expectNoA11yViolations(page)

  await page.getByLabel('Name').fill('Kim'); await page.getByLabel('E-Mail').fill('kim@verein.test')
  await page.getByRole('button', { name: 'Einladen' }).click()
  await page.getByLabel('Finanzen für Kim').click(); await page.getByRole('option', { name: 'Lesen' }).click()
  expect(await latestLink('kim@verein.test', /\/login/)).toMatch(/\/login$/)

  const kim = await (await browser.newContext()).newPage()
  await kim.goto('/login'); await expectNoA11yViolations(kim)
  await kim.getByLabel('E-Mail').fill(' Kim@Verein.test')
  await kim.getByRole('button', { name: 'Anmeldelink anfordern' }).click()
  await kim.goto(await latestLink('kim@verein.test', /magic-link/))
  await expect(kim.getByRole('heading', { name: 'Deine Bereiche' })).toBeVisible(); await expectNoA11yViolations(kim)
  await expect(kim.getByText('Finanzen – Lesen')).toBeVisible()
  await expect(kim.getByText(/Mitglieder/)).toHaveCount(0)
  await kim.goto('/admin/users')
  await expect(kim.getByRole('heading', { name: 'Kein Zugriff' })).toBeVisible()

  await page.getByRole('row', { name: /Kim/ }).getByRole('button', { name: 'Sperren' }).click()
  await page.getByRole('button', { name: 'Ja, sperren' }).click()
  await kim.goto('/'); await expect(kim).toHaveURL(/\/login$/)
})
```

- [ ] **Step 4: E2E laufen lassen.**
  - Ablauf: `docker compose -f docker/compose.dev.yml up -d`, dann `vp run --filter web e2e`.
  - Playwright läuft mit `locale: 'de-DE'`, damit die deutschen Bezeichnungen gelten. Ein zweiter Test prüft auf `/login`: Klick auf „English“ zeigt den Button „Request sign-in link“, `<html lang="en">` und keine axe-Verstöße.
  - Playwright startet die App mit `DEV_SMTP_URL=smtp://localhost:1025` und einem festen `SETUP_TOKEN`, über `webServer` in `playwright.config.ts`.
  - Erwartung: FAIL nur dort, wo noch etwas fehlt. Fehlende Bezeichnungen oder Seiten werden ergänzt, bis der Test PASS meldet. Die Bezeichnungen müssen den Texten aus Task 5, 7 und 8 entsprechen.
- [ ] **Step 5: CI einrichten.**
  - `ci.yml` richtet Node aus `.node-version` und pnpm aus `packageManager` ein, dann `pnpm install --frozen-lockfile`.
  - Jobs:
    - `check`: `vp check`, `pnpm check:catalog` und `pnpm exec commitlint --from origin/main --to HEAD` (nur bei Pull Requests)
    - `test`: `vp test`
    - `build`: Matrix node, vercel, cloudflare, jeweils `vp run --filter web build:<ziel>`; bei cloudflare zusätzlich die Bundle-Prüfung aus Step 1
    - `e2e`: Services `postgres:19` und `axllent/mailpit`, dann `vp run --filter web e2e`
  - README ergänzen: lokale Entwicklung (`pnpm install`, `vp dev`, `pnpm commit`), Umgebungsvariablen, Builds.
  - Prüfen: Die Pipeline ist grün auf einem Push in einen Branch.
- [ ] **Step 6: Commit:** `ci: add docker, CI pipeline and end-to-end tests`
