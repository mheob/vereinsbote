# Vereinsbote

Vereinsbote is an open-source web app a club uses to send e-mails to its members and partners. The interface is available in German (default) and English.

## Requirements

- Node.js 26 (see `.node-version`)
- pnpm 12 (see `packageManager` in `package.json`)
- [Vite+](https://viteplus.dev) with its CLI `vp`
- Docker, for PostgreSQL and Mailpit

## Local development

```sh
pnpm install
docker compose -f docker/compose.dev.yml up -d   # PostgreSQL :5432, Mailpit :1025 (SMTP) and :8025 (web)
cp apps/web/.env.example apps/web/.env           # fill in, see below
set -a; . apps/web/.env; set +a                  # load the variables into the shell
vp run --filter web db:migrate
vp dev                                           # http://localhost:3000
```

- Generate the secrets in `apps/web/.env` (the commands are in the file) and set `DEV_SMTP_URL=smtp://localhost:1025`. All mails then end up in Mailpit at <http://localhost:8025>.
- On first start, `/setup` walks you through creating the first admin with the `SETUP_TOKEN`.
- Checks: `vp check` (format, lint, types), `vp test`, `pnpm check:catalog` and `pnpm check:vite-plus`.
- Tests that need real PostgreSQL concurrency (`*.postgres.test.ts`) run only when `TEST_POSTGRES_URL` is set; otherwise `vp test` counts them as skipped, and `vp test --reporter=verbose` shows why (the reason is in the test's title). With the dev services running: `TEST_POSTGRES_URL=postgres://vereinsbote:vereinsbote@localhost:5432/vereinsbote vp test`. Each such test creates a database of its own and drops it again. CI sets the variable.
- Commits: `pnpm commit` starts czg for Conventional Commits. `pnpm install` installs the Git hooks (`.vite-hooks/`) through `vp config`.

### End-to-end tests

```sh
docker compose -f docker/compose.dev.yml up -d
pnpm --filter web exec playwright install chromium   # once
vp run --filter web e2e
```

Playwright builds the Node output and starts it on port 3100 with fixed test values (`apps/web/e2e/env.ts`). The values in that file replace the shell's, so your own `MS_LOGIN_*` or `HEARTBEAT_URL` do not leak into the run. Every run empties the database `vereinsbote_e2e` and the Mailpit inbox, so the development database `vereinsbote` stays untouched. `compose.dev.yml` creates `vereinsbote_e2e` when its volume is new. If an older volume lacks it, create it:

```sh
docker compose -f docker/compose.dev.yml exec postgres createdb --username=vereinsbote vereinsbote_e2e
```

## Environment variables

All variables are described in `apps/web/.env.example`. They are trimmed and validated at startup (`apps/web/src/server/env.ts`); an error names the variables, never their values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection (`postgres://…`) |
| `APP_URL` | yes | Public address, the origin only (no path, query or fragment); `https://` (`http://` for localhost only) |
| `APP_SECRET` | yes | 32 bytes, Base64; signs sessions, keys the login link windows, encrypts stored credentials |
| `CRON_SECRET` | yes | At least 32 characters; protects the tick (`/api/tick`) |
| `SETUP_TOKEN` | no | Enables `/setup` until the first admin exists |
| `MS_LOGIN_CLIENT_ID`, `MS_LOGIN_CLIENT_SECRET`, `MS_LOGIN_TENANT_ID` | no | Sign-in with Microsoft, all three or none. The tenant must be the club's tenant ID (a GUID); `common`, `organizations` and `consumers` are refused |
| `DEV_SMTP_URL` | no | Development only: system mails via SMTP, e.g. to Mailpit |
| `DEV_NEON_WS_PROXY` | no | Development only: a local Neon WebSocket proxy for the Neon driver (see [Cloudflare smoke test](#local-smoke-test-of-the-cloudflare-build)); needs an `http://localhost` `APP_URL` |
| `HEARTBEAT_URL` | no | Called after every completed tick, also when a step failed (not when the tick could not run, e.g. without a database) |
| `TICK_INTERVAL_MS` | no | Node/Docker only: interval between ticks, default 15 minutes |

## Builds and deployment

There are three targets. All of them apply the migrations before the new version answers requests. A migration run holds a PostgreSQL advisory lock (`pg_advisory_xact_lock`), so servers or builds that start at the same time wait for each other instead of applying a migration twice.

| Target | Build | Output | Migrations |
| --- | --- | --- | --- |
| Node/Docker | `vp run --filter web build:node` | `apps/web/dist/node` | when the server starts |
| Vercel | `vp run --filter web build:vercel` | `apps/web/.vercel/output` | in the build command, after the build (`apps/web/vercel.json`); production builds only, see below |
| Cloudflare Workers | `vp run --filter web build:cloudflare` | `apps/web/dist/cloudflare` | in `deploy:cloudflare`, after the build |

### Node and Docker

The Node output contains all dependencies and the migrations. Start it with `node apps/web/dist/node/server/index.mjs`; `PORT` sets the port (default 3000). On startup the server first applies the pending migrations and answers no request until they are done. If they fail, it logs the error's code and exits with code 1.

With Docker Compose (app and PostgreSQL):

1. Create `docker/.env`. It holds the variables from `apps/web/.env.example` except `DATABASE_URL`, which `compose.yml` sets, plus `POSTGRES_PASSWORD`. The password ends up in a URL, so use URL-safe characters only, e.g. `openssl rand -hex 24`.
2. Run `docker compose -f docker/compose.yml up -d --build`.
3. Check that `curl -s localhost:3000/api/health` returns `{"ok":true}`.

The image (`docker/Dockerfile`) builds in a separate stage. At runtime it contains only Node and `apps/web/dist/node`: no `node_modules`, no sources, no npm. The server runs as user `node`. Compose starts it with a read-only file system (only `/tmp` is writable), without capabilities and with `no-new-privileges`. The app listens on `127.0.0.1:3000` only.

### Vercel

- The project's root directory is `apps/web`.
- `apps/web/vercel.json` sets the build command: first `build:vercel`, then `db:migrate:vercel`. A failing build therefore never touches the database. The command lives in the file rather than the project settings, so it is versioned and visible in review.
- **Migrations run in production builds only** (`VERCEL_ENV=production`). A preview build skips them, so a push to any branch never runs unreviewed migrations against a shared database. To migrate previews, give Preview a database of its own (e.g. a Neon branch) and set `MIGRATE_ON_PREVIEW=1` for the Preview environment. Without either, a preview runs on whatever schema its `DATABASE_URL` has.
- **A Vercel build without a known `VERCEL_ENV` fails.** If `VERCEL=1` is set but `VERCEL_ENV` is missing or is not `production`, `preview` or `development`, `db:migrate:vercel` exits with code 1 and names the variable (never its value), so the deployment stops instead of going live on the old schema. Both variables come from Vercel's system environment variables: keep "Automatically expose System Environment Variables" switched on in the project settings (the default). Outside Vercel (`VERCEL` unset) the script keeps the rules above.
- The cron job and the `maxDuration` of `/api/tick` are set in the Nitro config (`apps/web/vite.config.ts`), not in `vercel.json`.
- `DATABASE_URL` must also be available to the build.
- Toolchain on Vercel:
  - **Node 26:** comes from the project's "Node.js Version" setting, which must be 26.x. The root `package.json` declares `engines.node`, but Vercel reads the `package.json` of the root directory (`apps/web`). Nitro writes the function runtime from the Node version of the build (`nodejs26.x`). Check that the project offers 26.x before the first deployment.
  - **pnpm 12:** Vercel detects pnpm from the lockfile. pnpm then switches to the version in `packageManager` (`pnpm@12.21.0`). Alternatively, set `ENABLE_EXPERIMENTAL_COREPACK=1`, which needs Corepack in the selected Node version. Check the build log of the first deployment for `pnpm v12`.
  - **`vp`:** comes from the `vite-plus` dev dependency; `node_modules/.bin` is on the build command's `PATH`.

### Cloudflare Workers

- The variables are secrets of the Worker: `wrangler secret put DATABASE_URL`, and likewise `APP_URL`, `APP_SECRET`, `CRON_SECRET` and the optional ones.
- Deploy with `vp run --filter web deploy:cloudflare`, with `DATABASE_URL` in the shell. The script builds, migrates the database and then runs `wrangler deploy`. A failing build never touches the database, and no stale build is ever deployed.
- The cron trigger is set in `apps/web/wrangler.jsonc`.

### Local smoke test of the Cloudflare build

The built Worker runs locally in workerd (`wrangler dev`) against the development PostgreSQL. The Worker's Neon driver speaks WebSocket, so Neon's own proxy (`wsproxy`, a service of `compose.dev.yml` behind the profile `cloudflare`) passes its connections on to PostgreSQL. `DEV_NEON_WS_PROXY` makes the driver use it, without TLS; the app accepts it only with an `http://localhost` `APP_URL`.

```sh
docker compose -f docker/compose.dev.yml --profile cloudflare up -d   # adds wsproxy on 127.0.0.1:4444
docker compose -f docker/compose.dev.yml exec postgres createdb --username=vereinsbote vereinsbote_smoke
DATABASE_URL=postgres://vereinsbote:vereinsbote@localhost:5432/vereinsbote_smoke vp run --filter web db:migrate
vp run --filter web build:cloudflare
cd apps/web && pnpm exec wrangler dev --config dist/cloudflare/server/wrangler.json --port 8787 \
  --var APP_URL:http://localhost:8787 --var DEV_NEON_WS_PROXY:localhost:4444/v1 \
  --var DATABASE_URL:postgres://vereinsbote:vereinsbote@postgres:5432/vereinsbote_smoke \
  --var APP_SECRET:"$(openssl rand -base64 32)" --var CRON_SECRET:"$(openssl rand -hex 32)" \
  --var SETUP_TOKEN:"$(openssl rand -hex 16)"
```

`DATABASE_URL` names the host `postgres` as the proxy sees it, inside the Compose network. Then check:

- `curl -s localhost:8787/api/health` returns `{"ok":true}` (database through the Neon driver).
- Signed out, `curl -s -o /dev/null -D - localhost:8787/admin/users` answers `307` with `Location: /login`: a page's redirect survives the request middleware that ends the request's database.
- `curl -s -o /dev/null -w '%{http_code}\n' localhost:8787/does-not-exist` answers `404`, and `curl -s localhost:8787/does-not-exist | grep '<h1'` shows the translated not-found page („Seite nicht gefunden“; with `-H 'Cookie: locale=en'`, "Page not found").
- `/login` renders; `/setup` with the `SETUP_TOKEN` creates the first admin and leads to `/admin/users` (a POST server function, a transaction and a session on workerd); „Abmelden“ leads back to `/login`.
- The cron handler: `curl -s -X POST -H 'content-type: application/json' -d '{"cron":"*/15 * * * *"}' 'localhost:8787/cdn-cgi/local/explorer/api/local/scheduled?worker=vereinsbote'` answers `"outcome":"ok"`, and an expired row in `verification` is gone afterwards. (`wrangler dev --test-scheduled` and `/__scheduled` do not reach this build: its generated config sets `no_bundle`, so wrangler injects no test middleware.)

Afterwards: stop `wrangler dev`, drop the database (`dropdb --username=vereinsbote vereinsbote_smoke` in the `postgres` container) and run `docker compose -f docker/compose.dev.yml --profile cloudflare stop wsproxy`. This covers the Worker's code paths, not Cloudflare's network, Hyperdrive or Neon itself; see the checklist below.

### Manual smoke test before the first deploy

The deployment itself is the owner's step. Before the first production deployment on each platform:

**Vercel (preview deployment first):**

1. In the project settings: root directory `apps/web`, Node.js version 26.x; the variables of `apps/web/.env.example` for Preview, with a `DATABASE_URL` of a database of its own (Neon branch) and `MIGRATE_ON_PREVIEW=1`.
2. Push a branch. The build log shows `pnpm v12`, the build, then `Migrations applied.`
3. On the preview URL: `/api/health` returns `{"ok":true}`; `/setup` creates the first admin; `/admin/users` and `/admin/areas` load; an invitation and a level change are saved; „Abmelden“ works; an unknown address shows the 404 page.
4. Call the tick the way Vercel Cron does: `curl -s -H "Authorization: Bearer $CRON_SECRET" https://<preview>/api/tick` returns the report of a completed tick. The function log shows no `no waitUntil` warning.
5. Check the response headers of a page (`X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`).
6. Then promote with the production variables (without `MIGRATE_ON_PREVIEW`). Promoting rebuilds the deployment for production: its build log must show `Migrations applied.` as well (not `Migrations skipped`, and no `Migrations not run` error). Check that the cron job `/api/tick` appears under Settings → Cron Jobs.

**Cloudflare Workers:**

1. `wrangler secret put` for every variable; `DATABASE_URL` points at a Neon database (the Worker reaches PostgreSQL through Neon's WebSocket endpoint).
2. `vp run --filter web deploy:cloudflare` with `DATABASE_URL` in the shell: build, `Migrations applied.`, deploy.
3. On the Worker's URL: the same checks as for Vercel (health, setup, admin pages, sign-out, 404, headers).
4. Run the cron trigger once from the dashboard (Triggers → Cron → run), then check in `wrangler tail` that it logged no `scheduled tick failed` and no `no waitUntil` warning, and that `system_state` has a fresh `last_tick`.

## Operations

- **Remove `SETUP_TOKEN` after the setup.** `/setup` is then switched off.
- **No production mail transport yet.** In this stage the app can send system mails (sign-in links, invitations) only through `DEV_SMTP_URL` (development) or not at all; users can still sign in with Microsoft when it is configured. The setup's own session is then the only way in for the first admin. Sessions last 7 days and are renewed when used, so it lapses after 7 days without use; keep it alive or configure Microsoft sign-in.
- **Rotating `APP_SECRET` signs everyone out** (the session cookies no longer verify) and resets the login link windows. Credentials stored encrypted with the old secret could no longer be read; this stage stores none yet.
- **Security headers:** every response carries `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` (`apps/web/src/start.ts`). A full Content Security Policy follows in a later stage.
- **Errors:** pages show a generic error or not-found page, and a failed server function sends a generic error to the browser. The server logs only the error's code or name, also for Better Auth's own errors, and a 5xx response of Better Auth only as `better auth HTTP <status>`, so no query parameters, tokens or addresses end up in the logs.
- **Housekeeping:** every tick deletes expired login links, closed login link windows, expired sessions and rate limiter rows idle for more than two minutes.
- **Run Node/Docker only behind a reverse proxy.**
  - The proxy terminates HTTPS and sets `X-Forwarded-For` to the client's address; for nginx, `proxy_set_header X-Forwarded-For $remote_addr;`.
  - Requests for sign-in links are limited per address. Without the header, all clients share one limit.
  - Cloudflare and Vercel set the address themselves.
- **Two database pools on Node.**
  - The tick runs on a second pool of its own, next to the pool of the requests. Both are node-postgres pools with at most 10 connections each.
  - The database's connection limit must cover both.
- **Database pool errors** are logged as `db pool error <code>` (Neon's WebSocket errors as `db pool error Event error`). Errors of a pool that is closing, as every request's pool does on Cloudflare, are not logged: they are the sockets going away, not the database.
- **Health:** `GET /api/health` answers 200 with `{"ok":true}` when the database is reachable, otherwise 503.

## CI

`.github/workflows/ci.yml` runs on every push and every pull request:

- `check`: `vp check`, `pnpm check:catalog`, `pnpm check:vite-plus` and, on pull requests, commitlint over all commits of the pull request
- `test`: `vp test`, with a PostgreSQL service container and `TEST_POSTGRES_URL`, so the concurrency tests run as well
- `build`: the three targets. The job also checks that `nodemailer` and `pg` (with `pg-pool` and `pg-protocol`) do not end up in the Cloudflare bundle: it fails on their module paths (`node_modules/pg-pool/…`), which the bundle keeps in comments and source maps, but not on the copy of pg's `package.json` that Neon's driver carries as text.
- `docker`: builds `docker/Dockerfile` (without pushing)
- `e2e`: the end-to-end tests, against PostgreSQL and Mailpit as service containers

`voidzero-dev/setup-vp` sets up Vite+, Node (from `.node-version`) and pnpm (from `packageManager`), and installs the dependencies with `--frozen-lockfile`. A newer push cancels the running checks of the same branch or pull request; on `main`, every commit keeps its run.

## Supply-chain security

- **Pins:**
  - GitHub Actions are pinned to the commit SHA of their release (`uses: owner/action@<sha> # vX.Y.Z`).
  - Container images are pinned by digest (`image:tag@sha256:…`) in the Dockerfile, in both Compose files and in the CI service containers.
- **CI:**
  - The workflow runs with a read-only token (`permissions: contents: read`) and `persist-credentials: false`, without `pull_request_target`.
- **pnpm (`pnpm-workspace.yaml`):**
  - It installs only versions that are at least a day old (`minimumReleaseAge`).
  - It refuses versions published with less trust evidence than their predecessors (`trustPolicy: no-downgrade`).
  - It runs install scripts only for packages listed in `allowBuilds` (`strictDepBuilds`).
  - Transitive dependencies come from the registry only (`blockExoticSubdeps`).
  - Exceptions are listed in the file with their reasons.
  - `overrides` lift vulnerable transitive versions: drizzle-kit's loader (`@esbuild-kit/core-utils`) pins esbuild 0.18, which has a dev server advisory (fixed in 0.25), so every esbuild below 0.25 resolves to the catalog version. `vite` and `vitest` follow the catalog as well (Vite+).

### Keeping the pins current with Renovate

The [Renovate GitHub App](https://github.com/apps/renovate) must be installed for the repository. It reads `.github/renovate.json`, which extends `github>mheob/renovate-config`.

- That preset includes `config:best-practices`, which sets and updates the SHA pins of the actions and the digests of the images.
- Renovate also updates the versions in the pnpm catalog, `packageManager` and `.node-version`.
- Updates come once a week, with non-major updates grouped.

Rules of this repository in `.github/renovate.json`:

- `vite-plus`, its core (`vite` in the catalog) and `vitest` come together in one pull request. `pnpm check:vite-plus` (`scripts/check-vite-plus-versions.ts`) fails CI when the installed versions differ from what `vite-plus` declares.
- `oxfmt` and `oxlint` get no updates of their own. They follow the versions that ship with Vite+.
- `nitro` (Nitro 3 is a release candidate) waits for approval on the Dependency Dashboard and gets a pull request of its own.

## Contributing and merging

- **Kodiak:**
  - [Kodiak](https://kodiakhq.com) merges a pull request as soon as all checks are green, without needing a label.
  - Its configuration is shared by all repositories and lives in `mheob/.github` (`.github/.kodiak.toml`); this repository has none of its own.
  - It squash-merges: the pull request's title and description become the commit message, then the branch is deleted.
  - So the title follows Conventional Commits, and closing keywords such as `Closes #123` belong in the pull request's description, not only in individual commits.
- **Major updates:** Renovate labels them `major ⚠️`. Kodiak does not merge them; they are reviewed and merged by hand.
- **Code-owner review:**
  - Pull requests need the approval of a code owner (`.github/CODEOWNERS`), which matters above all for Renovate's.
  - This is a repository setting, not a file: a branch ruleset for `main` with "Require a pull request before merging", "Require review from Code Owners" and the CI jobs as "Required status checks".
  - GitHub does not let authors approve their own pull requests. The ruleset therefore lists the owner (the repository admin role) in its bypass list, so the owner can merge their own pull requests.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [AGENTS.md](AGENTS.md) for the rules that coding agents and contributors follow.

## Security

Please report vulnerabilities privately, not in a public issue: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
