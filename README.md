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

All variables are described in `apps/web/.env.example`. They are validated at startup (`apps/web/src/server/env.ts`).

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection (`postgres://…`) |
| `APP_URL` | yes | Public address, `https://` (`http://` for localhost only) |
| `APP_SECRET` | yes | 32 bytes, Base64; encrypts stored credentials |
| `CRON_SECRET` | yes | At least 32 characters; protects the tick (`/api/tick`) |
| `SETUP_TOKEN` | no | Enables `/setup` until the first admin exists |
| `MS_LOGIN_CLIENT_ID`, `MS_LOGIN_CLIENT_SECRET`, `MS_LOGIN_TENANT_ID` | no | Sign-in with Microsoft, all three or none |
| `DEV_SMTP_URL` | no | Development only: system mails via SMTP, e.g. to Mailpit |
| `HEARTBEAT_URL` | no | Called after every successful tick |
| `TICK_INTERVAL_MS` | no | Node/Docker only: interval between ticks, default 15 minutes |

## Builds and deployment

There are three targets. All of them apply the migrations before the new version answers requests. A migration run holds a PostgreSQL advisory lock (`pg_advisory_xact_lock`), so servers or builds that start at the same time wait for each other instead of applying a migration twice.

| Target | Build | Output | Migrations |
| --- | --- | --- | --- |
| Node/Docker | `vp run --filter web build:node` | `apps/web/dist/node` | when the server starts |
| Vercel | `vp run --filter web build:vercel` | `apps/web/.vercel/output` | in the build command, after the build (`apps/web/vercel.json`) |
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
- `apps/web/vercel.json` sets the build command: first `build:vercel`, then `db:migrate`. A failing build therefore never touches the database. The command lives in the file rather than the project settings, so it is versioned and visible in review.
- The cron job and the `maxDuration` of `/api/tick` are set in the Nitro config (`apps/web/vite.config.ts`), not in `vercel.json`.
- `DATABASE_URL` must also be available to the build.
- **Preview deployments need a database of their own**, e.g. a Neon branch. Every preview build runs the branch's migrations against the `DATABASE_URL` set for Preview. If Preview shared the production database, every push to any branch would run unreviewed migrations against production.
- Toolchain on Vercel:
  - **Node 26:** comes from the project's "Node.js Version" setting, which must be 26.x. The root `package.json` declares `engines.node`, but Vercel reads the `package.json` of the root directory (`apps/web`). Nitro writes the function runtime from the Node version of the build (`nodejs26.x`). Check that the project offers 26.x before the first deployment.
  - **pnpm 12:** Vercel detects pnpm from the lockfile. pnpm then switches to the version in `packageManager` (`pnpm@12.21.0`). Alternatively, set `ENABLE_EXPERIMENTAL_COREPACK=1`, which needs Corepack in the selected Node version. Check the build log of the first deployment for `pnpm v12`.
  - **`vp`:** comes from the `vite-plus` dev dependency; `node_modules/.bin` is on the build command's `PATH`.

### Cloudflare Workers

- The variables are secrets of the Worker: `wrangler secret put DATABASE_URL`, and likewise `APP_URL`, `APP_SECRET`, `CRON_SECRET` and the optional ones.
- Deploy with `vp run --filter web deploy:cloudflare`, with `DATABASE_URL` in the shell. The script builds, migrates the database and then runs `wrangler deploy`. A failing build never touches the database, and no stale build is ever deployed.
- The cron trigger is set in `apps/web/wrangler.jsonc`.

## Operations

- **Remove `SETUP_TOKEN` after the setup.** `/setup` is then switched off.
- **Run Node/Docker only behind a reverse proxy.**
  - The proxy terminates HTTPS and sets `X-Forwarded-For` to the client's address; for nginx, `proxy_set_header X-Forwarded-For $remote_addr;`.
  - Requests for sign-in links are limited per address. Without the header, all clients share one limit.
  - Cloudflare and Vercel set the address themselves.
- **Two database pools on Node.**
  - The tick runs on a second pool of its own, next to the pool of the requests. Both are node-postgres pools with at most 10 connections each.
  - The database's connection limit must cover both.
- **Health:** `GET /api/health` answers 200 with `{"ok":true}` when the database is reachable, otherwise 503.

## CI

`.github/workflows/ci.yml` runs on every push and every pull request:

- `check`: `vp check`, `pnpm check:catalog`, `pnpm check:vite-plus` and, on pull requests, commitlint over all commits of the pull request
- `test`: `vp test`
- `build`: the three targets. The job also checks that `nodemailer` and `pg` do not end up in the Cloudflare bundle.
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

## License

[MIT](LICENSE)
