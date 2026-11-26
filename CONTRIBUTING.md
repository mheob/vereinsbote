# Contributing to Vereinsbote

Thank you for helping. This guide covers the workflow; [README.md](README.md) has setup and operations, and [AGENTS.md](AGENTS.md) holds the full rules for code (agents and humans alike).

## Prerequisites

- Node.js 26 (`.node-version`)
- pnpm 12 (`packageManager` in `package.json`)
- [Vite+](https://viteplus.dev) with its CLI `vp`
- Docker, for PostgreSQL, Mailpit and SeaweedFS (S3 storage for images)

## Setup

```sh
pnpm install
docker compose -f docker/compose.dev.yml up -d   # PostgreSQL, Mailpit and SeaweedFS
cp apps/web/.env.example apps/web/.env   # fill in, see the README
set -a; . apps/web/.env; set +a
vp run --filter web db:migrate
vp dev                                    # http://localhost:3000
```

`pnpm install` also installs the Git hooks. See the [README](README.md#local-development) for the details, including the end-to-end tests.

## Development workflow

1. Create a branch from `main`.
2. Write the failing test first (TDD), then the code. Database tests use PGlite through `createTestDb()`, called inside the test; it closes the database when the test ends. Tests that need real PostgreSQL concurrency (`*.postgres.test.ts`) run when `TEST_POSTGRES_URL` is set, e.g. `TEST_POSTGRES_URL=postgres://vereinsbote:vereinsbote@localhost:5432/vereinsbote vp test`; CI always runs them. The S3 storage test needs SeaweedFS from the same Compose file: `TEST_S3_URL=http://vereinsbote:vereinsbote-dev-secret@localhost:8333/vereinsbote vp test`.
   - The mail snapshots (`apps/web/src/mail/render/__snapshots__`) pin the HTML of the layout. Update them only on purpose with `vp test -u`, and read the diff before you commit: it is the mail every club sends.
   - The XSS and bypass corpus of the HTML import (`apps/web/src/server/html-import/*.test.ts`, `bypass.test.ts`) only grows. A new bypass found gets its vector as a test first; never remove or loosen a case to make a change pass.
   - To see mails as clients show them, run `vp run --filter web mail:sample` (needs `DEV_SMTP_URL`, see the README): four sample mails land in Mailpit, and the [README](README.md#sample-mails-and-the-mailpit-relay) explains how to relay them to real mailboxes with `docker/compose.relay.yml` and a local, never committed `docker/mailpit-relay.yaml`.
3. Run `vp check` (format, lint, types; it must report 0 errors and 0 warnings) and `vp test`. After a dependency change also run `pnpm check:catalog`, `pnpm check:vite-plus` and `pnpm cve` (dependency advisories; the `pre-push` hook and CI run it too).
4. For pages and flows, run the E2E tests: `vp run --filter web e2e` (Playwright, files `*.e2e.ts`; the projects are `fundament`, `contacts`, `design` and `templates`). Each file is a Playwright project of its own in `apps/web/playwright.config.ts` and imports `test` from `apps/web/e2e/helpers/test.ts` (it fails on a Content Security Policy violation in any browser context of the test, also one opened in `beforeAll`); a new file needs a project entry, with `dependencies` when it builds on another file's data (like `contacts` on `fundament`), or it does not run. An admin page of a later project opens with `newAdminContext` (`apps/web/e2e/helpers/admin-session.ts`), the session `fundament` saved, not with a new sign-in (one link per address and minute, ten per day). Another user signs in with `signIn` (`apps/web/e2e/helpers/sign-in.ts`), which follows the link to the confirmation page and presses „Anmelden“.
5. For a user-facing change, add a changeset: `pnpm changeset`, pick `web`, choose the bump (`patch` for a fix, `minor` for a feature, `major` for a breaking change) and write the changelog text in English. Commit the file in `.changeset/` with the change. Docs, tests, CI and dependency updates need none; for them `pnpm changeset --empty` satisfies the `pre-push` hook.
6. Commit and open a pull request.

Test data is always invented: made-up names, addresses at `example.org` (or a `.test` or `.example` domain). Never commit a club's real export, not even a shortened one. Import files for tests are built in the test, XLSX files with `write-excel-file` and CSV files as text, so the repository holds no binary fixtures.

Everything that is code is English: identifiers, file names, URL paths, HTML ids, CSS classes, cookie names and test titles. Imports inside `apps/web/src` use the `@/` alias, never `../`. Dependencies are `"catalog:"` in `package.json`, and versions live only in `pnpm-workspace.yaml`.

## Commit style

Run `pnpm commit` (czg) for a Conventional Commit. The `commit-msg` hook checks it with commitlint (`@mheob/commitlint-config`):

- lowercase type, optional scope
- description at most 50 characters, starting lowercase, no period at the end
- header at most 72 characters

The `pre-commit` hook runs `vp staged`, which fixes and checks the staged files. The `pre-push` hook runs `pnpm exec changeset status --since=origin/main` (it refuses a push of changed packages without a changeset) and `pnpm cve` (it refuses a push while the lockfile has a high or critical advisory); both are skipped in CI.

Releases are automatic: after a merge to `main`, the Release workflow opens a pull request "chore(release): version packages" that bumps the version and writes `apps/web/CHANGELOG.md`. The code owner's approval of that pull request is the release step. Do not edit the version or the changelog by hand. See the [README](README.md#releases).

## Pull requests

- The PR title follows Conventional Commits. [Kodiak](https://kodiakhq.com) squash-merges with the PR title and description as the commit message, so put closing keywords such as `Closes #123` in the description.
- CI (`.github/workflows/ci.yml`) runs `check`, `test`, `build`, `docker` and `e2e`. All must pass.
- SonarQube Cloud (quality gate, coverage) and Snyk (dependency check) comment on the pull request. Fix what they report in the code or the dependency. If a Snyk finding has no fixed version, add it to `.snyk` with a reason and an expiry date; a Sonar finding that is a false positive is marked as such in SonarQube Cloud with a short reason, not silenced in the code. The quality gate wants 80 % coverage on new code from the unit tests; routes, React components (`*.tsx`), server functions and the runtime entry points are left to the E2E tests (`sonar.coverage.exclusions`), so new logic belongs in a plain module with unit tests. Heavy browser libraries (Tiptap, `read-excel-file`, `papaparse`, `fflate`) load only by dynamic `import()` in client code; CI fails when one reaches a server bundle (see [AGENTS.md](AGENTS.md)).
- A code owner (`.github/CODEOWNERS`) must approve.
- Major dependency updates carry the label `major ⚠️`. Kodiak does not merge them; they are reviewed and merged by hand.

## Translations

Every visible string goes into both `apps/web/src/i18n/de.ts` and `en.ts`, with the same key. Read it with `useT()` (components) or `translate()` (server). Never hard-code UI text. Every new page also sets its document title with `pageHead` (`apps/web/src/i18n/page-title.ts`).

## Accessibility and security

- The app meets WCAG 2.2 AA. Use React Aria Components, show errors at the field, announce changes in live regions, and add an axe check for every new page in the E2E tests.
- Forms use `PostForm`. Server functions run behind the CSRF middleware and authorize from the session, never from client input.
- Keep secrets, e-mail addresses, tokens and contact data out of logs, URLs and error messages; log codes only (`errorLabel`). Search terms and filter values go by POST. Server functions return expected refusals as results; anything they throw reaches the browser only as a generic error. Request middleware is not covered by that: what it throws reaches the browser with its message.
- On Cloudflare, never share the database or other I/O objects across requests, and keep `nodemailer` and `pg` out of that bundle. The request's database ends with the response: work after it must not use the database (the system mailer prepares a login link inside the request and only delivers it once the request's work is done).
- GitHub Actions are pinned by commit SHA and images by digest. Renovate maintains the pins.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting, see [SECURITY.md](SECURITY.md).

## Keeping the docs current

A change to commands, setup, conventions, architecture or operations updates `README.md`, `AGENTS.md` and this file in the same pull request. The spec and the plans are in `docs/superpowers/`.
