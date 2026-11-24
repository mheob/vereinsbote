# AGENTS.md

Instructions for coding agents (Claude Code, Codex and others). Humans: see [CONTRIBUTING.md](CONTRIBUTING.md). Operators and local setup: see [README.md](README.md). Follow these rules from the first prompt.

## Project

Vereinsbote is an open-source web app a club uses to send e-mails to its members and partners. The interface is German (default) and English. One instance serves one club, and it runs on Vercel, Cloudflare Workers or Node/Docker.

- **Spec:** `docs/superpowers/specs/2026-11-23-vereinsbote-design.md`
- **Roadmap** (eight sub-plans, written one after the other): `docs/superpowers/plans/2026-11-23-vereinsbote-00-fahrplan.md`
- **Plans:** `docs/superpowers/plans/` (currently `…-01-fundament.md`). The spec and the plans are in German; their "Global Constraints" are summarized below.

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

Access levels are cumulative (`read` < `edit` < `send`). The admin role gives no area access. There are no passwords and no self-registration: admins invite users.

## Stack and toolchain

- **Vite+ is the only toolchain** (`vite-plus`, CLI `vp`): `vp dev`, `vp build`, `vp check` (format, lint, types), `vp fmt`, `vp lint`, `vp test`, `vp run …`.
  - Configure only in `vite.config.ts`: the `fmt`, `lint`, `staged` and `test` blocks are in the root file, the app's plugins in `apps/web/vite.config.ts`.
  - Do not add `vitest.config.ts`, `oxlint.config.ts`, `.oxlintrc.json`, `.oxfmtrc.json`, Husky or lefthook.
  - Tests import from `vite-plus/test`, Vite APIs from `vite-plus` (lint rule `vite-plus/prefer-vite-plus-imports`).
- **pnpm 12** with `catalogMode: strict` in `pnpm-workspace.yaml`.
  - Every external dependency is `"catalog:"` in every `package.json`. Versions live only in the catalog.
  - Run `pnpm check:catalog` and `pnpm check:vite-plus` after touching dependencies. The Vite+ versions (`vite-plus`, `vite`, `vitest`) move together.
- **Always the newest stable version** of Node (26, see `.node-version`), pnpm, TypeScript, every dependency and every image. An older version needs a proven reason, written as a comment at the catalog entry.
- App: TanStack Start, React, React Aria Components, Tailwind CSS v4, Drizzle ORM, Better Auth, zod. Tests: Vite+ (Vitest), PGlite, Playwright with axe.
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
- **The page frame** (language, signed in or not) comes from the root loader, once per document; client navigation does not ask again. Whatever changes it loads a new document: a redirect with `reloadDocument: true` (setup's sign-in, `requireRequestPrincipal`), `location.assign` or `location.reload` (Sign out, language switcher). Protected pages and server functions still check the session themselves.
- **Access levels** are defined once in `apps/web/src/server/permissions/levels.ts` (`accessLevels`); the schema and the level selects use that list.
- **Accessibility:** WCAG 2.2 AA.
  - Use React Aria Components. Show errors at the field. Announce changes in live regions.
  - Every page gets an axe check in E2E (`expectNoA11yViolations` in `apps/web/e2e/helpers/a11y.ts`) with no violations for `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`.
- **Forms** use `PostForm` (`apps/web/src/components/post-form.tsx`): `method="post"` and a hydration gate, so a native submission never puts values into the URL. Submit buttons are `SubmitButton`.
- **Server functions** (`apps/web/src/functions/`):
  - They run behind the CSRF middleware (`apps/web/src/platform/csrf.ts`).
  - Expected refusals (a taken address, the last admin) are returned as results, never thrown. Anything thrown reaches the browser only as a generic `ServerFunctionError` (`apps/web/src/platform/server-fn-errors.ts`, a function middleware in `start.ts`); redirects and not-found results pass.
  - An error thrown in a request middleware (`requestMiddleware` in `start.ts`) during a server-function request bypasses that function middleware: Start serializes it with its message to the browser. Request middleware must therefore only throw errors whose message is safe to show (or return a `Response`).
  - Each function authorizes itself from the session principal (`requireRequestPrincipal`), never from client input. A server function is reachable without its page.
  - Server modules are imported inside the handlers, so they stay out of the client bundle.
  - Validate input with zod.
- **Cloudflare:**
  - The database and auth instance are request-scoped (`apps/web/src/platform/request-scope.ts`). Never cache an I/O object across requests.
  - `nodemailer` and `pg` must never end up in the Cloudflare bundle. Load them only on the Node path, behind build-constant branches (`import.meta.env.VITE_VB_PLATFORM`). CI checks the bundle.
- **No secrets, e-mail addresses or tokens** in logs, URLs or error messages. Log error codes only, through `errorLabel` / `errorLabelWithCause` (`apps/web/src/server/error-label.ts`). Better Auth logs through the same labels (`logger` in `auth.ts`), and its HTTP errors go through `handleAuthRequest`, which logs a thrown error by code and a 5xx response by its status only.
- **Pages and responses:** `routerDefaults` (`apps/web/src/router-defaults.ts`) sets the generic, translated error and not-found pages; they never show an error's message. Every response gets the security headers of `apps/web/src/platform/security-headers.ts`: pages and API responses through the request middleware in `start.ts`, the built assets under `/assets/` (served by Nitro, Vercel's CDN or Workers assets, never by Start) through `apps/web/src/platform/static-headers.ts` and `vite.config.ts`.
- **Work after the response** goes through `platform.waitUntil` (`createBackgroundRunner`): it never rejects into the runtime and warns once on Vercel or Cloudflare when the runtime offers no `waitUntil`.
- E-mail addresses are stored and compared through `normalizeEmail` (trim and lowercase).
- Credentials are encrypted with AES-GCM through WebCrypto only, so the code runs on Node and on Workers.
- **Tick steps** go into `apps/web/src/server/tick/steps.ts` and respect the tick's time budget. A step resumes at the next tick.
- Migrations run automatically on deploy and must stay compatible with older data. On Vercel they run in production builds only, in preview builds only with `MIGRATE_ON_PREVIEW=1` (`db:migrate:vercel`); a Vercel build (`VERCEL=1` or the marker `VB_VERCEL_BUILD=1` that `apps/web/vercel.json` sets) without a known `VERCEL_ENV` fails instead of skipping them.

## Testing

- **TDD:** write the failing test first, see it fail, then implement.
- Unit tests sit next to the code (`*.test.ts`, `*.test.tsx`). Database tests use PGlite through `createTestDb()` (`apps/web/src/server/db/test-db.ts`), a fresh migrated in-memory database per call.
- PGlite runs one statement at a time, so it cannot show races. Tests that need real concurrency are `*.postgres.test.ts`, run against PostgreSQL when `TEST_POSTGRES_URL` is set (CI sets it), create and drop a database of their own, and are skipped otherwise (`describe.skipIf`, with the reason in the title).
- E2E tests are Playwright files named `*.e2e.ts` in `apps/web/e2e/`. They run against the Node build on port 3100 with the fixed values in `apps/web/e2e/env.ts`.

## Security and supply chain

- GitHub Actions are pinned by the full commit SHA with the version as a comment: `uses: owner/action@<sha> # vX.Y.Z`. Never a tag or branch.
- Container images are pinned by digest (`image:tag@sha256:…`) in the Dockerfile, both Compose files (including Neon's `wsproxy` behind the Compose profile `cloudflare`) and the CI services.
- Vulnerabilities are reported privately (`SECURITY.md`).
- Renovate (`.github/renovate.json`) maintains the SHA, digest and catalog pins. Do not edit pins by hand without a reason.
- CI runs with least privilege: `permissions: contents: read`, `persist-credentials: false`, no `pull_request_target`. The one exception is `.github/workflows/release.yml` (`contents: write`, `pull-requests: write`, persisted checkout credentials for authenticated tag lookups; runs on `main` only): do not "fix" it.
- `pnpm-workspace.yaml` sets `minimumReleaseAge`, `trustPolicy: no-downgrade`, `strictDepBuilds` with `allowBuilds`, and `blockExoticSubdeps`. Do not weaken them. A new install script needs an entry in `allowBuilds` and a reason.
- A vulnerable transitive version is lifted with a scoped override in `pnpm-workspace.yaml` (prefer a parent-scoped key such as `"@esbuild-kit/core-utils>esbuild"`, a version range in the key also works; `"catalog:"` as the value; a comment with the advisory). Remove it once the dependency ships a fixed version.
- Containers run as a non-root user without dev dependencies.

## Releases

- Releases use Changesets (`.changeset/`). Only `web` (`apps/web`) is versioned; the root package is not, and nothing goes to npm.
- **Every user-facing change gets a changeset** (`pnpm changeset`, text in English, `patch` fix, `minor` feature, `major` breaking). Docs, tests, CI and dependency updates need none (`pnpm changeset --empty` if the `pre-push` hook asks).
- Never edit `apps/web/package.json`'s `version` or `apps/web/CHANGELOG.md` by hand and never run `changeset version` in a branch: the release pull request ("chore(release): version packages", `.github/workflows/release.yml`) does it. `vp fmt` ignores `CHANGELOG.md`.
- The release pull request needs a code owner's approval before Kodiak merges it; that approval is the release gate. Never open it with the owner's token (the owner's own pull requests bypass review).
- The `pre-push` hook (`.vite-hooks/pre-push`) runs `changeset status --since=origin/main`; it is skipped when `CI` is set.

## Commits

- Conventional Commits per `@mheob/commitlint-config`: lowercase type, optional scope, description at most 50 characters, starting lowercase, no period at the end, header at most 72 characters. Example: `feat(areas): rename an area`.
- `pnpm commit` starts czg. The Git hooks come from Vite+ (`.vite-hooks/`): `pre-commit` runs `vp staged`, `commit-msg` runs commitlint. Never skip them.
- If `.git/gitbutler` exists, GitButler manages the checkout. Commit with the `but` CLI, not with `git add` or `git commit` (see the `but` skill if available).
- Pull requests are squash-merged with the PR title and description as the commit message. Put `Closes #123` in the PR description.

## Keeping the docs current

Any change that affects commands, setup, conventions, architecture or operations must update `README.md`, `AGENTS.md` and `CONTRIBUTING.md` in the same change. The spec and the plans live in `docs/superpowers/`; `vp fmt` ignores that folder on purpose.
