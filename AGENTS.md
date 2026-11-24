# AGENTS.md

Instructions for coding agents (Claude Code, Codex and others). Humans: see [CONTRIBUTING.md](CONTRIBUTING.md). Operators and local setup: see [README.md](README.md). Follow these rules from the first prompt.

## Project

Vereinsbote is an open-source web app a club uses to send e-mails to its members and partners. The interface is German (default) and English. One instance serves one club, and it runs on Vercel, Cloudflare Workers or Node/Docker.

- **Spec:** `docs/superpowers/specs/2026-11-23-vereinsbote-design.md`; each sub-plan may add a design next to it (`…-02-kontakte-design.md`), which wins where it differs.
- **Roadmap** (eight sub-plans, written one after the other): `docs/superpowers/plans/2026-11-23-vereinsbote-00-fahrplan.md`
- **Plans:** `docs/superpowers/plans/` (currently `…-01-fundament.md` and `…-02-kontakte.md`). The spec and the plans are in German; their "Global Constraints" are summarized below.

Domain terms are German in the spec and English in the code:

| Spec (German) | Code |
| --- | --- |
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

Access levels are cumulative (`read` < `edit` < `send`). The admin role gives no area access. There are no passwords and no self-registration: admins invite users.

## Stack and toolchain

- **Vite+ is the only toolchain** (`vite-plus`, CLI `vp`): `vp dev`, `vp build`, `vp check` (format, lint, types), `vp fmt`, `vp lint`, `vp test`, `vp run …`.
  - Configure only in `vite.config.ts`: the `fmt`, `lint`, `staged` and `test` blocks are in the root file, the app's plugins in `apps/web/vite.config.ts`.
  - Do not add `vitest.config.ts`, `oxlint.config.ts`, `.oxlintrc.json`, `.oxfmtrc.json`, Husky or lefthook.
  - Tests import from `vite-plus/test`, Vite APIs from `vite-plus` (lint rule `vite-plus/prefer-vite-plus-imports`).
- **pnpm 12** with `catalogMode: strict` in `pnpm-workspace.yaml`.
  - Every external dependency is `"catalog:"` in every `package.json`. Versions live only in the catalog.
  - Run `pnpm check:catalog` and `pnpm check:vite-plus` after touching dependencies. The Vite+ versions (`vite-plus`, `vite`, `vitest`, `@vitest/coverage-v8`) move together.
- **Always the newest stable version** of Node (26, see `.node-version`), pnpm, TypeScript, every dependency and every image. An older version needs a proven reason, written as a comment at the catalog entry.
- App: TanStack Start, React, React Aria Components (dates through `@internationalized/date`), Tailwind CSS v4, Drizzle ORM, Better Auth, zod. Import files: `read-excel-file` (XLSX), `papaparse` (CSV) and `fflate`, which unzips XLSX synchronously because its asynchronous unzip starts a `blob:` Worker that a CSP without `worker-src blob:` blocks. Tests: Vite+ (Vitest), PGlite, Playwright with axe, `write-excel-file` for XLSX test files.
- A library must not need Node modules that the browser or Workers lack (`nodemailer` and `pg` are the Node-only exceptions, see Cloudflare below), nor `eval` or `new Function`: the CSP has no `unsafe-eval`. zod therefore runs with `jitless` (`apps/web/src/zod-config.ts`, the first import of `router.tsx` and `start.ts`).
- Layout: `apps/web` (the app), `docker/`, `scripts/` (the two check scripts), `docs/superpowers/`.

## Commands

Run them from the repository root.

| Task | Command |
| --- | --- |
| Install (also installs the Git hooks) | `pnpm install` |
| Dev services (PostgreSQL, Mailpit) | `docker compose -f docker/compose.dev.yml up -d` |
| Migrate the dev database | `vp run --filter web db:migrate` (needs `apps/web/.env` loaded, see README) |
| Dev server, http://localhost:3000 | `vp dev` |
| Format, lint, types | `vp check` (`vp check --fix` fixes what it can) |
| Format only | `vp fmt` |
| All unit tests | `vp test` |
| Unit tests incl. the PostgreSQL concurrency tests | `TEST_POSTGRES_URL=postgres://vereinsbote:vereinsbote@localhost:5432/vereinsbote vp test` (dev services running) |
| One test file | `vp test run apps/web/src/i18n/translate.test.ts` |
| Catalog and Vite+ version checks | `pnpm check:catalog`, `pnpm check:vite-plus` |
| Dependency advisories (cve-lite, fails on high/critical) | `pnpm cve` |
| Unit tests with coverage (`coverage/lcov.info`, read by SonarQube Cloud) | `vp test --coverage` |
| Build per target | `vp run --filter web build:node`, `build:vercel`, `build:cloudflare` |
| Generate a migration | `vp run --filter web db:generate` |
| Apply migrations | `vp run --filter web db:migrate` |
| E2E (Playwright) | `docker compose -f docker/compose.dev.yml up -d`, then `vp run --filter web e2e` |
| Local smoke test of the Cloudflare build (workerd) | see README, "Local smoke test of the Cloudflare build" (Compose profile `cloudflare`, `wrangler dev`) |
| Commit (czg) | `pnpm commit` |
| Add a changeset | `pnpm changeset` (`pnpm changeset --empty` for a change without a user-facing effect) |
| Changeset status | `pnpm exec changeset status --since=origin/main` |

- The first E2E run needs `pnpm --filter web exec playwright install chromium`. E2E empties the database `vereinsbote_e2e` and the Mailpit inbox. Details are in the README.
- A change is done when `vp check` reports 0 errors and 0 warnings and `vp test` passes. Changes to pages or flows also run the E2E tests.

## Conventions

- **Everything that is code is English:** identifiers (per the glossary), file names, URL paths, HTML ids, CSS classes, cookie names, test titles. Only visible text is translated.
- **Imports** inside `apps/web/src` use the `@/` alias (it points to `apps/web/src`). No `../` imports (lint error); `./` in the same folder is fine.
- **UI text** lives only in `apps/web/src/i18n/de.ts` and `en.ts`. Every key exists in both. Read it with `useT()` in components and `translate(locale, key, params)` on the server. System mails use the recipient's language.
- **Page titles:** every route sets `head: (context) => pageHead(context, '<key>')` (`apps/web/src/i18n/page-title.ts`), which gives „{Seite} – Vereinsbote“ in the request's language and names the error or not-found page when the route fails. Admin pages use `adminPageHead` with a typed context.
- **Paths** used in code (`LOGIN_PATH`, `AFTER_SIGN_IN_PATH`) come from `apps/web/src/paths.ts`.
- **The page frame** (language, signed in or not, and for a signed-in user the navigation and the notice about the member data from `loadFrameInfo` in `apps/web/src/server/frame.ts`) comes from the root loader, once per document (`staleTime: Infinity`); client navigation does not ask again. Whatever changes the language or the session loads a new document: a redirect with `reloadDocument: true` (setup's sign-in, `requireRequestPrincipal`), `location.assign` or `location.reload` (Sign out, language switcher). The exception is a change of the navigation or the notice: a confirmed import and every save on the contact settings call `router.invalidate()`, which runs the root loader again. Protected pages and server functions still check the session themselves.
- **React Aria's `I18nProvider`** wraps the app once, in `apps/web/src/routes/__root.tsx`, with the request's language through `intlLocale` (`de-DE`, `en-US`), so React Aria's dates, numbers and own texts follow the page's language, not the browser's, also in the server render. Do not add local providers.
- **Notices for the next page** (a partner just deleted or created) go into the router's history state (`HistoryState` in `apps/web/src/router.tsx`), never into the URL; the page shows them once and removes them with `clearHistoryNotice` (`apps/web/src/components/contacts/history-notice.ts`).
- **Route files** named after a path parameter (`$contactId.tsx`) are exempt from `unicorn/filename-case` through an override in the root `vite.config.ts`.
- **Access levels** are defined once in `apps/web/src/server/permissions/levels.ts` (`accessLevels`); the schema and the level selects use that list.
- **Accessibility:** WCAG 2.2 AA.
  - Use React Aria Components. Show errors at the field. Announce changes in live regions.
  - Every page gets an axe check in E2E (`expectNoA11yViolations` in `apps/web/e2e/helpers/a11y.ts`) with no violations for `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`.
- **Forms** use `PostForm` (`apps/web/src/components/post-form.tsx`): `method="post"` and a hydration gate, so a native submission never puts values into the URL. Submit buttons are `SubmitButton`.
- **Server functions** (`apps/web/src/functions/`):
  - They run behind the CSRF middleware (`apps/web/src/platform/csrf.ts`).
  - Expected refusals (a taken address, the last admin, a contact or area deleted in another tab) are returned as results, never thrown. Domain modules signal them with typed errors (for contacts in `apps/web/src/server/contacts/errors.ts`, e.g. `ContactNotFoundError`, `UnknownAreaError`), which the server function maps to a result (`CONTACT_GONE`, `{ ok: false, failure: 'gone' }`). Anything thrown reaches the browser only as a generic `ServerFunctionError` (`apps/web/src/platform/server-fn-errors.ts`, a function middleware in `start.ts`); redirects and not-found results pass.
  - A component waits for a `useServerFn` call with `settle` (`apps/web/src/components/settle.ts`): it gives `FAILED` when the call failed and `undefined` when the server redirected (the session ended). On `undefined` return without touching state.
  - An error thrown in a request middleware (`requestMiddleware` in `start.ts`) during a server-function request bypasses that function middleware: Start serializes it with its message to the browser. Request middleware must therefore only throw errors whose message is safe to show (or return a `Response`).
  - Start reads the whole body of a call with form data before the function runs. The request middleware `formBodyLimit` (`apps/web/src/platform/body-limit.ts`, after `csrf` in `start.ts`) answers such a call above 4.5 MB with 413 before the body is read, and one whose body breaks off with 400; it returns responses, never throws.
  - Each function authorizes itself from the session principal (`requireRequestPrincipal`), never from client input. A server function is reachable without its page.
  - Server modules are imported inside the handlers, so they stay out of the client bundle.
  - Validate input with zod.
- **Cloudflare:**
  - The database and auth instance are request-scoped (`apps/web/src/platform/request-scope.ts`). Never cache an I/O object across requests.
  - `nodemailer` and `pg` must never end up in the Cloudflare bundle. Load them only on the Node path, behind build-constant branches (`import.meta.env.VITE_VB_PLATFORM`). CI checks the bundle.
- **No secrets, e-mail addresses or tokens** in logs, URLs or error messages. Log error codes only, through `errorLabel` / `errorLabelWithCause` (`apps/web/src/server/error-label.ts`). Better Auth logs through the same labels (`logger` in `auth.ts`), and its HTTP errors go through `handleAuthRequest`, which logs a thrown error by code and a 5xx response by its status only.
- **Pages and responses:** `routerDefaults` (`apps/web/src/router-defaults.ts`) sets the generic, translated error and not-found pages; they never show an error's message. Every response gets the security headers of `apps/web/src/platform/security-headers.ts`: pages and API responses through the request middleware in `start.ts` (`securityHeadersFor`, a Content Security Policy with the request's nonce from `platform/csp-nonce.ts`; only `/preview-frame` and `/media/…` differ), the built assets under `/assets/` and the icons under `/social/` (served by Nitro, Vercel's CDN or Workers assets, never by Start) through `apps/web/src/platform/static-headers.ts` and `vite.config.ts`, with the base headers only. The router gets the same nonce through `createRouter({ ssr: { nonce } })`, set when it is created. Every E2E test fails on a CSP violation (`test` from `apps/web/e2e/helpers/test.ts`; import it instead of `@playwright/test`).
- **Work after the response** goes through `platform.waitUntil` (`createBackgroundRunner`): it never rejects into the runtime and warns once on Vercel or Cloudflare when the runtime offers no `waitUntil`.
- E-mail addresses are stored and compared through `normalizeEmail` (trim and lowercase).
- **Contacts** (`apps/web/src/server/contacts/`):
  - Contact data leaves the server only through functions that filter by `loadContactAccess` (`access.ts`): protected fields the user may not see are not delivered, not just hidden, and search and filters cover them only for users who see them. The admin role alone gives no access.
  - Never call `loadContactAccess` inside a transaction: it runs queries in parallel, which pg warns about on one client. Load the access first, then open the transaction.
  - A write that changes contacts, suppressions or opt-outs takes the import-state lock of the kind (`lockImportState`, `import-state.ts`) before it changes anything, so it waits for a running import of that kind and cannot deadlock with it. It bumps the stock version, so a preview made before it cannot be confirmed.
  - Search terms and filter values go by POST, never into a URL; the URL of the contact list carries only `kind`. The list route sets `gcTime: 0`: the list keeps its first page as its own state, so every visit loads it anew instead of showing a cached page.
  - The import sends the mapped columns only (of discarded ones just the header, for the remembered mapping) as gzip-compressed JSON in `FormData` (`encodeImportPayload` / `decodeImportPayload`); the limits (10,000 rows, 4,000,000 bytes compressed, 16 MiB unpacked) are in `import/payload.ts`. The file itself is read in the browser and never sent.
  - "Today" (the import day, a reached exit date) is `todayInClubZone` (`calendar.ts`, `Europe/Berlin`), never the server's or the browser's day. Date fields are calendar dates (`YYYY-MM-DD`, Postgres `date`).
  - Suppressions and opt-outs hang on `contact_key` (`nr:<number>`, for a partner without customer number `email:<address>`), not on the contact, so they survive every import. When a partner's key changes they follow it (`rekeyContactKey`), or are copied when another partner keeps the old key (`copyContactKey`). Partners without number that share an address therefore share them, also when an edit moves one onto the other's address.
  - The activity log names a contact by number or id (`member:<nr>`, `partner:<nr>`, `contact:<uuid>`, `auditTarget`), never by name or address.
- `DEV_SMTP_URL` (`apps/web/src/server/mail/smtp-transport.ts`) sends unencrypted only to the local machine; any other host must offer STARTTLS. No credentials in workflows either: the CI PostgreSQL services use trust authentication.
- Credentials are encrypted with AES-GCM through WebCrypto only, so the code runs on Node and on Workers.
- **Tick steps** go into `apps/web/src/server/tick/steps.ts` and respect the tick's time budget. A step resumes at the next tick.
- Migrations run automatically on deploy and must stay compatible with older data. On Vercel they run in production builds only, in preview builds only with `MIGRATE_ON_PREVIEW=1` (`db:migrate:vercel`); a Vercel build (`VERCEL=1` or the marker `VB_VERCEL_BUILD=1` that `apps/web/vercel.json` sets) without a known `VERCEL_ENV` fails instead of skipping them.

## Testing

- **TDD:** write the failing test first, see it fail, then implement.
- Unit tests sit next to the code (`*.test.ts`, `*.test.tsx`). Database tests use PGlite through `createTestDb()` (`apps/web/src/server/db/test-db.ts`), a fresh migrated in-memory database per call that closes when the calling test ends. Call it inside a test, not in `beforeAll`: an open PGlite holds its memory until garbage collection, and unclosed ones let the test workers grow by gigabytes.
- Each database test starts its own PGlite instance, which is slow on CI runners with coverage; the test and hook timeouts are therefore 30 s (`apps/web/vite.config.ts`). Do not lower them.
- PGlite runs one statement at a time, so it cannot show races. Tests that need real concurrency are `*.postgres.test.ts`, run against PostgreSQL when `TEST_POSTGRES_URL` is set (CI sets it), create and drop a database of their own, and are skipped otherwise (`describe.skipIf`, with the reason in the title).
- E2E tests are Playwright files named `*.e2e.ts` in `apps/web/e2e/`. They run against the Node build on port 3100 with the fixed values in `apps/web/e2e/env.ts`.
- Every E2E file belongs to a Playwright project of its own in `apps/web/playwright.config.ts` (`fundament`, `contacts`); a file without one does not run. A file that builds on another file's data names that project in `dependencies`, as `contacts` does with `fundament`.
- **Test data is always invented** (made-up names, addresses at `example.org` or a `.test`/`.example` domain). A club's real exports never go into the repository, not even shortened. Import files for tests are built in the test: XLSX with `write-excel-file`, CSV as text (e.g. encoded as Windows-1252 in the test); no binary fixtures.

## Security and supply chain

- GitHub Actions are pinned by the full commit SHA with the version as a comment: `uses: owner/action@<sha> # vX.Y.Z`. Never a tag or branch.
- Container images are pinned by digest (`image:tag@sha256:…`) in the Dockerfile, both Compose files (including Neon's `wsproxy` behind the Compose profile `cloudflare`) and the CI services.
- Vulnerabilities are reported privately (`SECURITY.md`).
- `pnpm cve` (cve-lite) scans `pnpm-lock.yaml` and fails on high or critical advisories. It runs in the `pre-push` hook and in the CI `check` job. It knows only OSV and npm advisories; Snyk (GitHub integration, PR check) uses its own database and can report more. Fix a finding by updating, or with a scoped `overrides` entry like the esbuild one. Snyk findings without a fixed version go into `.snyk`, each with a reason and an expiry date.
- SonarQube Cloud analyzes in CI (`sonar-project.properties`, step in the `test` job, coverage from `vp test --coverage`). Automatic Analysis stays off. The quality gate wants 80 % coverage on new code from the unit tests; only framework- or runtime-bound code tested by E2E (routes, `*.tsx` components, server functions, router, entry points, migration CLIs) is excluded, so new logic in plain modules needs unit tests. The dictionaries `i18n/de.ts` and `i18n/en.ts` are excluded from the duplication check (`sonar.cpd.exclusions`). Sort strings with a compare function (`compareCodePoints`) and avoid regexes that can backtrack super-linearly.
- Renovate (`.github/renovate.json`) maintains the SHA, digest and catalog pins. Do not edit pins by hand without a reason. No `renovate.json` at the root: Renovate would read it instead.
- CI runs with least privilege: `permissions: contents: read`, `persist-credentials: false`, no `pull_request_target`. The one exception is `.github/workflows/release.yml` (persisted checkout credentials for authenticated tag lookups; runs on `main` only): do not "fix" it. Its `GITHUB_TOKEN` is read-only too; it pushes, tags and opens the release pull request with an installation token of the GitHub App `mheob-helper` (`vars.BOT_CLIENT_ID`, `secrets.BOT_PRIVATE_KEY`, limited to `contents: write` and `pull-requests: write`), never with a personal access token.
- `pnpm-workspace.yaml` sets `minimumReleaseAge`, `trustPolicy: no-downgrade`, `strictDepBuilds` with `allowBuilds`, and `blockExoticSubdeps`. Do not weaken them. A new install script needs an entry in `allowBuilds` and a reason.
- A vulnerable transitive version is lifted with a scoped override in `pnpm-workspace.yaml` (prefer a parent-scoped key such as `"@esbuild-kit/core-utils>esbuild"`, a version range in the key also works; `"catalog:"` as the value; a comment with the advisory). Remove it once the dependency ships a fixed version.
- Containers run as a non-root user without dev dependencies.

## Releases

- Releases use Changesets (`.changeset/`). Only `web` (`apps/web`) is versioned; the root package is not, and nothing goes to npm.
- **Every user-facing change gets a changeset** (`pnpm changeset`, text in English, `patch` fix, `minor` feature, `major` breaking). Docs, tests, CI and dependency updates need none (`pnpm changeset --empty` if the `pre-push` hook asks).
- Never edit `apps/web/package.json`'s `version` or `apps/web/CHANGELOG.md` by hand and never run `changeset version` in a branch: the release pull request ("chore(release): version packages", `.github/workflows/release.yml`) does it. `vp fmt` ignores `CHANGELOG.md`.
- The release pull request needs a code owner's approval before Kodiak merges it; that approval is the release gate. The release workflow opens it as the GitHub App `mheob-helper`. Never open it with the owner's token (the owner's own pull requests bypass review).
- The `pre-push` hook (`.vite-hooks/pre-push`) runs `changeset status --since=origin/main`; it is skipped when `CI` is set.

## Commits

- Conventional Commits per `@mheob/commitlint-config`: lowercase type, optional scope, description at most 50 characters, starting lowercase, no period at the end, header at most 72 characters. Example: `feat(areas): rename an area`.
- `pnpm commit` starts czg. The Git hooks come from Vite+ (`.vite-hooks/`): `pre-commit` runs `vp staged`, `commit-msg` runs commitlint. Never skip them.
- If `.git/gitbutler` exists, GitButler manages the checkout. Commit with the `but` CLI, not with `git add` or `git commit` (see the `but` skill if available).
- Pull requests are squash-merged with the PR title and description as the commit message. Put `Closes #123` in the PR description.

## Keeping the docs current

Any change that affects commands, setup, conventions, architecture or operations must update `README.md`, `AGENTS.md` and `CONTRIBUTING.md` in the same change. The spec and the plans live in `docs/superpowers/`; `vp fmt` ignores that folder on purpose.
