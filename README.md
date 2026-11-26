# Vereinsbote

Vereinsbote is an open-source web app a club uses to send e-mails to its members and partners. The interface is available in German (default) and English.

## Requirements

- Node.js 26 (see `.node-version`)
- pnpm 12 (see `packageManager` in `package.json`)
- [Vite+](https://viteplus.dev) with its CLI `vp`
- Docker, for PostgreSQL, Mailpit and SeaweedFS (S3 storage for images)

## Local development

```sh
pnpm install
docker compose -f docker/compose.dev.yml up -d   # PostgreSQL :5432, Mailpit :1025 (SMTP) and :8025 (web), SeaweedFS :8333 (S3)
cp apps/web/.env.example apps/web/.env           # fill in, see below
set -a; . apps/web/.env; set +a                  # load the variables into the shell
vp run --filter web db:migrate
vp dev                                           # http://localhost:3000
```

- Generate the secrets in `apps/web/.env` (the commands are in the file) and set `DEV_SMTP_URL=smtp://localhost:1025`. All mails then end up in Mailpit at <http://localhost:8025>.
- Images need a storage. Set the `S3_*` variables to the SeaweedFS of `compose.dev.yml` (the values are in `apps/web/.env.example`); without storage `/admin/brand` shows the upload as unavailable and `/media` answers 404. See [Image storage](#image-storage).
- On first start, `/setup` walks you through creating the first admin with the `SETUP_TOKEN`.
- Checks: `vp check` (format, lint, types), `vp test`, `pnpm check:catalog`, `pnpm check:vite-plus` and `pnpm cve`.
- Tests that need real PostgreSQL concurrency (`*.postgres.test.ts`) run only when `TEST_POSTGRES_URL` is set; otherwise `vp test` counts them as skipped, and `vp test --reporter=verbose` shows why (the reason is in the test's title). With the dev services running: `TEST_POSTGRES_URL=postgres://vereinsbote:vereinsbote@localhost:5432/vereinsbote vp test`. Each such test creates a database of its own and drops it again. CI sets the variable.
- The S3 storage test (`s3.seaweedfs.test.ts`) runs only when `TEST_S3_URL` is set, like the PostgreSQL tests: `TEST_S3_URL=http://vereinsbote:vereinsbote-dev-secret@localhost:8333/vereinsbote vp test` (user, secret, host and bucket of the SeaweedFS in `compose.dev.yml`; CI sets it).
- Mail snapshots (`apps/web/src/mail/render/__snapshots__`) pin the HTML of the standard layout. After a deliberate change of the layout, update them with `vp test -u` and read the diff; see [CONTRIBUTING.md](CONTRIBUTING.md#development-workflow).
- Commits: `pnpm commit` starts czg for Conventional Commits. `pnpm install` installs the Git hooks (`.vite-hooks/`) through `vp config`.
- Changesets: every user-facing change needs one, add it with `pnpm changeset`. The `pre-push` hook runs `pnpm exec changeset status --since=origin/main` (skipped when `CI` is set) and refuses a push of changed packages without a changeset. For a change without a user-facing effect (docs, tests, CI), add an empty one: `pnpm changeset --empty`. See [Releases](#releases).

### End-to-end tests

```sh
docker compose -f docker/compose.dev.yml up -d
pnpm --filter web exec playwright install chromium   # once
vp run --filter web e2e
```

Playwright builds the Node output and starts it on port 3100 with fixed test values (`apps/web/e2e/env.ts`). The values in that file replace the shell's, so your own `MS_LOGIN_*` or `HEARTBEAT_URL` do not leak into the run. Every run empties the database `vereinsbote_e2e` and the Mailpit inbox, so the development database `vereinsbote` stays untouched.

Each test file is a Playwright project of its own in `apps/web/playwright.config.ts`: `fundament` (`fundament.e2e.ts`: setup, sign-in, users and areas), `contacts` (`contacts.e2e.ts`: imports, contact pages and contact settings), `design` (`design.e2e.ts`: the brand page with its preview and image upload, and the sample mails), `templates` (`templates.e2e.ts`: templates, the block editor, the preview, the image library, the HTML import and global layouts) and `sending` (`sending.e2e.ts`: a Graph connection, a sender and the system sender, a login link through the connection, a disturbed connection, a failed invitation and a secret about to expire). `contacts` and `design` depend on `fundament` and run after it, on the club that `fundament` set up; `templates` depends on `contacts` and `design`, because it uses their contacts and the saved brand; `sending` depends on `templates` and runs last, because setting the system sender sends every later mail through the fake provider; `fundament`'s last test signs the admin in by link and saves the session (`helpers/admin-session.ts`, in Playwright's `test-results` folder), which `contacts`, `design`, `templates` and `sending` open their admin pages with, because the server sends only one sign-in link per address and minute. A new `*.e2e.ts` file needs a project entry of its own, with `dependencies` when it builds on another file's data; a file without one does not run. Playwright also starts the fake Graph and Resend server (see [Fake providers](#fake-providers-for-development-and-tests)); the app reaches it through `DEV_PROVIDERS_URL`, and `helpers/tick.ts` runs a tick by hand (`POST /api/tick` with the `CRON_SECRET`), because `TICK_INTERVAL_MS` keeps the server from ticking on its own. Every E2E file imports `test` from `apps/web/e2e/helpers/test.ts`, which watches every browser context of the run (the `page` fixture's and those a test or a `beforeAll` opens with `browser.newContext()`) and fails the test during which a page reported a Content Security Policy violation. A report reaches the test through a Playwright binding, a moment after the page saw the violation; a test that provokes one on purpose waits for it with `cspViolationsReported(page)` before it goes on or closes the page. The `design` project also runs `mail:sample` (see [Sample mails](#sample-mails-and-the-mailpit-relay)) against Mailpit and requires at least 80 % support in Mailpit's HTML check and no axe violation for each sample mail.

`compose.dev.yml` creates `vereinsbote_e2e` when its volume is new. If an older volume lacks it, create it:

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
| `DEV_SMTP_URL` | no | Development only: system mails via SMTP, e.g. to Mailpit. Unencrypted only to `localhost`, `127.0.0.1` or `[::1]`; any other server must offer STARTTLS |
| `DEV_NEON_WS_PROXY` | no | Development only: a local Neon WebSocket proxy for the Neon driver (see [Cloudflare smoke test](#local-smoke-test-of-the-cloudflare-build)); needs an `http://localhost` `APP_URL` |
| `DEV_PROVIDERS_URL` | no | Development and e2e only: the local fake server of the mail providers, an `http://localhost:<port>` origin; needs an `http://localhost` `APP_URL` and is refused on Cloudflare and Vercel |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | no | Node/Docker: S3 storage for images, all five or none. `http://` only for `localhost` and `127.0.0.1`, the bucket must exist (see [Image storage](#image-storage)) |
| `BLOB_READ_WRITE_TOKEN` | no | Vercel: the read-write token of a private Vercel Blob store; the build reads it (see [Image storage](#image-storage)) |
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
- `apps/web/vercel.json` sets the build command: first `build:vercel`, then `db:migrate:vercel` with the marker `VB_VERCEL_BUILD=1`. A failing build therefore never touches the database. The command lives in the file rather than the project settings, so it is versioned and visible in review.
- **Migrations run in production builds only** (`VERCEL_ENV=production`). A preview build skips them, so a push to any branch never runs unreviewed migrations against a shared database. To migrate previews, give Preview a database of its own (e.g. a Neon branch) and set `MIGRATE_ON_PREVIEW=1` for the Preview environment. Without either, a preview runs on whatever schema its `DATABASE_URL` has.
- **A Vercel build without a known `VERCEL_ENV` fails.** The build command sets the marker `VB_VERCEL_BUILD=1`, which counts like `VERCEL=1`: if either is set but `VERCEL_ENV` is missing or is not `production`, `preview` or `development`, `db:migrate:vercel` exits with code 1 and names the variable (never its value), so the deployment stops instead of going live on the old schema. The marker keeps this check working even when "Automatically expose System Environment Variables" is switched off (then Vercel sets neither `VERCEL` nor `VERCEL_ENV`, and the build fails with that message; switch the setting on, it is the default). A manual run without the marker and without `VERCEL=1` keeps the rules above.
- The cron job and the `maxDuration` of `/api/tick` are set in the Nitro config (`apps/web/vite.config.ts`), not in `vercel.json`.
- `DATABASE_URL` must also be available to the build.
- Toolchain on Vercel:
  - **Node 26:** comes from the project's "Node.js Version" setting, which must be 26.x. The root `package.json` declares `engines.node`, but Vercel reads the `package.json` of the root directory (`apps/web`). Nitro writes the function runtime from the Node version of the build (`nodejs26.x`). Check that the project offers 26.x before the first deployment.
  - **pnpm 12:** Vercel detects pnpm from the lockfile. pnpm then switches to the version in `packageManager` (`pnpm@12.21.0`). Alternatively, set `ENABLE_EXPERIMENTAL_COREPACK=1`, which needs Corepack in the selected Node version. Check the build log of the first deployment for `pnpm v12`.
  - **`vp`:** comes from the `vite-plus` dev dependency; `node_modules/.bin` is on the build command's `PATH`.

### Cloudflare Workers

- The variables are secrets of the Worker: `wrangler secret put DATABASE_URL`, and likewise `APP_URL`, `APP_SECRET`, `CRON_SECRET` and the optional ones.
- Deploy with `vp run --filter web deploy:cloudflare`, with `DATABASE_URL` in the shell. The script builds, migrates the database and then runs `wrangler deploy`. A failing build never touches the database, and no stale build is ever deployed.
- The cron trigger and the R2 binding are set in `apps/web/wrangler.jsonc`. Create the image bucket once, before the first deployment: see [Image storage](#image-storage).

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
- `/login` renders; `/setup` with the `SETUP_TOKEN` creates the first admin and leads to `/admin/users` (a POST server function, a transaction and a session on workerd); the header's Sign out button (de: „Abmelden“) leads back to `/login`.
- `/media` from the local R2 (the generated config keeps the `MEDIA_BUCKET` binding, and `wrangler dev` simulates the bucket on disk): sign in as the admin (the sign-in link of the first admin comes from `/setup`), upload a logo on `/admin/brand` and save, then `curl -s -o /dev/null -D - localhost:8787/media/<id>.png` (the address is the `src` of the logo in the preview) answers `200` with `Content-Type: image/png`, `Cache-Control: public, max-age=86400` and `Content-Security-Policy: default-src 'none'; sandbox`. An unknown id answers `404`.
- The cron handler: `curl -s -X POST -H 'content-type: application/json' -d '{"cron":"*/15 * * * *"}' 'localhost:8787/cdn-cgi/local/explorer/api/local/scheduled?worker=vereinsbote'` answers `"outcome":"ok"`, and an expired row in `verification` is gone afterwards. (`wrangler dev --test-scheduled` and `/__scheduled` do not reach this build: its generated config sets `no_bundle`, so wrangler injects no test middleware.)

Afterwards: stop `wrangler dev`, drop the database (`dropdb --username=vereinsbote vereinsbote_smoke` in the `postgres` container) and run `docker compose -f docker/compose.dev.yml --profile cloudflare stop wsproxy`. This covers the Worker's code paths, not Cloudflare's network, Hyperdrive or Neon itself; see the checklist below.

### Manual smoke test before the first deploy

The deployment itself is the owner's step. Before the first production deployment on each platform:

**Vercel (preview deployment first):**

Preview deployments sit behind Vercel's Deployment Protection by default, so a plain `curl` gets Vercel's login page instead of the app. For the `curl` checks, create a "Protection Bypass for Automation" secret (Settings → Deployment Protection) and send it as the `x-vercel-protection-bypass` header, e.g. `curl -s -H "x-vercel-protection-bypass: $VERCEL_BYPASS" https://<preview>/api/health`, or switch the protection off for the duration of the test and on again afterwards. The browser checks work after signing in to Vercel.

1. In the project settings: root directory `apps/web`, Node.js version 26.x; the variables of `apps/web/.env.example` for Preview, with a `DATABASE_URL` of a database of its own (Neon branch) and `MIGRATE_ON_PREVIEW=1`.
2. Push a branch. The build log shows `pnpm v12`, the build, then `Migrations applied.`
3. On the preview URL: `/api/health` returns `{"ok":true}`; `/setup` creates the first admin; `/admin/users` and `/admin/areas` load; an invitation and a level change are saved; Sign out works; signed out, `/admin/users` redirects to `/login`; an unknown address shows the 404 page.
4. Call the tick the way Vercel Cron does: `curl -s -H "Authorization: Bearer $CRON_SECRET" -H "x-vercel-protection-bypass: $VERCEL_BYPASS" https://<preview>/api/tick` returns the report of a completed tick. The function log shows no `no waitUntil` warning.
5. Check the response headers of a page (`X-Frame-Options: DENY`, a `Content-Security-Policy` with a nonce) and of a built asset under `/assets/` (`X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`); the asset comes from Vercel's CDN, which takes its headers from `.vercel/output/config.json`.
6. Then promote with the production variables (without `MIGRATE_ON_PREVIEW`). Promoting rebuilds the deployment for production: its build log must show `Migrations applied.` as well (not `Migrations skipped`, and no `Migrations not run` error). Check that the cron job `/api/tick` appears under Settings → Cron Jobs.

**Cloudflare Workers:**

1. `wrangler secret put` for every variable; `DATABASE_URL` points at a Neon database (the Worker reaches PostgreSQL through Neon's WebSocket endpoint).
2. `vp run --filter web deploy:cloudflare` with `DATABASE_URL` in the shell: build, `Migrations applied.`, deploy.
3. On the Worker's URL: the same checks as for Vercel (health, setup, admin pages, sign-out, the redirect of a signed-out `/admin/users`, 404, headers of a page and of an asset under `/assets/`, which Cloudflare serves with the `_headers` file of the build).
4. Run the cron trigger once from the dashboard (Triggers → Cron → run), then check in `wrangler tail` that it logged no `scheduled tick failed` and no `no waitUntil` warning, and that `system_state` has a fresh `last_tick`.

## Image storage

Images of the club (logos and template images) are stored privately and served by the app itself under `/media/<id>.<ext>`: the address is the only protection, an id of 22 random base64url characters, because the images end up in e-mails and a mailbox sends no session. Each platform has its own store; the app picks it from what is configured:

| Platform | Storage | Setup |
| --- | --- | --- |
| Cloudflare Workers | R2 bucket, binding `MEDIA_BUCKET` (`apps/web/wrangler.jsonc`) | `wrangler r2 bucket create vereinsbote-media --jurisdiction eu`, once before the first deployment. The jurisdiction is fixed when the bucket is created and keeps the data in the EU. The bucket stays private: no public bucket URL, no custom domain |
| Vercel | private Vercel Blob store | Create the store in the region `fra1` (Frankfurt) with access "Private" (Storage tab of the project; it adds `BLOB_READ_WRITE_TOKEN` to the project's environment). The app passes `access: 'private'` on every call, so a public store fails instead of leaking images |
| Node/Docker | any S3 service | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, all five or none. The bucket must exist. `http://` endpoints work for `localhost` only. The client is `s3mini`. For Docker Compose put them in `docker/.env` |

- **Development and tests:** `docker/compose.dev.yml` starts SeaweedFS (`weed mini`) with the bucket `vereinsbote` at <http://localhost:8333>, access key `vereinsbote`, secret `vereinsbote-dev-secret`. The E2E tests and the CI services use it too. `TEST_S3_URL` runs the S3 contract test against it (see [Local development](#local-development)).
- **Without a storage** (no `S3_*`, no token, no binding) the app runs; uploads are refused with a notice and `/media` answers 404.
- **Packages:** `s3mini` and `@vercel/blob` load only behind the build constants (`import.meta.env.VITE_VB_PLATFORM`), like `pg` and `nodemailer`, so the Cloudflare bundle holds neither. CI greps that bundle for `nodemailer`, `pg`, `s3mini` and `@vercel/blob` (by the `node_modules/` path of the latter three, because their names also appear in our own source maps).
- **`/media`:** serves GET and HEAD (other methods get `405`; a failing database or storage an empty `503` with `Cache-Control: no-store`, logged by error code only), `Cache-Control: public, max-age=86400` (one day), plus `CDN-Cache-Control` with the same value on Vercel; Workers do not cache (reading R2 is cheap). The response has its own security headers: `default-src 'none'; sandbox`, `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: cross-origin`, so a mail client can show the image but the file can never run as a page. A deleted image can stay visible for up to a day in caches and in mails already sent.
- **Uploads:** the browser scales an image to at most 1200 px width and re-encodes it (JPEG or PNG, EXIF rotation applied); the server checks the bytes again (type, at most 1200 × 4000 px and 2 MB) and stores it only through `storeImage`.

## Brand and mails

The corporate design (CD) is set by admins on `/admin/brand`: club name, header and footer logo, colours (a contrast check at the field warns below 4.5:1 and does not block saving), font stacks that mail clients have, an optional font the recipient may have installed, the footer (address, register, imprint, privacy, website, free text) and up to five more footer links, each shown as text or as a social icon. Saving a changed CD that another tab or admin changed meanwhile is refused with a notice. The page shows a live preview of a sample mail (as desktop, as phone or as text; on screens below 1024 px on its own tab). Until a CD is saved the neutral default applies, and the start page points admins to it.

- **Standard layout:** mails are built from blocks (heading, text, image, button, divider, spacer, two columns) in one standard layout made of tables and inline styles for mail clients, with the CD applied when the mail is compiled. `compileMail` (`apps/web/src/mail/render/compile.ts`) renders the HTML and the plain-text version once, with a marker per recipient value; `fillMail` puts a recipient's values into the slots in one pass. Values are escaped for HTML, left as they are in the text and put on one line in the subject. A value is never parsed again, so a first name like `{{contact.email}}` appears literally.
- **Placeholders** (`{{key}}`, `{{key | "fallback"}}`) work only in text, never in attributes, URLs or `<style>`. `salutation` is chosen by gender, name and company, in the informal (du) or formal (Sie) form.
- **Social icons:** `apps/web/public/social/<platform>-<dark|light|brand>.png` (48 × 48 px, shown at 24 px) are checked in and served as static files. They come from [`simple-icons`](https://simpleicons.org) (CC0 1.0), generated by `vp run --filter web icons:social` (needs Playwright's Chromium; run it by hand when the set changes). The logos are trademarks of their owners and used only to link to the club's own profile on that platform; the license of the icon set does not cover the trademarks. LinkedIn has no icon, because `simple-icons` removed it: a LinkedIn link is shown as text.

## Templates and layouts

A template is a mail's content, kept per area (`/templates`): everyone with `read` in the area sees it and its preview, `edit` creates, changes, duplicates and deletes it and uploads images, and the admin role alone gives no access. Global layouts (`/admin/layouts`) are for admins: a layout wraps the content of templates in the whole club, with the CD and the base fields as its only values, and a template picks one.

- **Block editor:** headings, formatted text (bold, italic, links, lists), images, buttons, dividers, spacers, two columns and placeholders, all reachable by keyboard (Tab to the toolbar, Alt+F10 from the text into it). A template is saved only through `saveTemplate`, which runs the checks (limits, placeholders, links, images of the area, a missing alt text; the other accessibility findings are hints, not save checks; a block template may be 256 KB as JSON, imported HTML falls under the import's 500 KB limit instead) and records which images it uses. The text editor, Tiptap, is a browser library that loads when the editor opens; when it fails to load (a broken connection, or a deploy since the page was opened), each field shows the error with a button that loads it again, and the rest of the editor stays usable.
- **Preview:** next to the editor (on screens below 1024 px on its own tab), as desktop or phone, with sample contacts or a real contact of the area; the preview follows the editor 300 ms after the last change. The values come only from `previewValues`, which filters real contacts by the user's access like the contact pages do. The mail is shown in a sandboxed frame (`/preview-frame`, see [Operations](#operations)).
- **Image library** (`/images`): images of an area, uploaded in the browser (scaled to at most 1200 px) and stored through `storeImage` (see [Image storage](#image-storage)). A template that uses an image blocks its deletion.
- **HTML import:** a template or a layout can start from existing HTML. `importHtml` (`apps/web/src/server/html-import/`) is the only way HTML enters: it enforces the size limit (500 KB, a warning from 102 KB, where Gmail clips), removes scripts, event handlers and other active content, cleans CSS, checks placeholders (contact values only in text, brand values only where the CD allows them) and links images only from the area's library; what it removes or refuses comes back as findings. A chosen file is read in the encoding it declares (a byte order mark or a `<meta>` charset), else as UTF-8 or, when it is no valid UTF-8, as Windows-1252, the encoding of HTML saved by Word and older Outlook versions; the imported HTML then declares UTF-8, the encoding it is sent in. CSS that classic Outlook for Windows ignores is reported from an excerpt of [caniemail](https://www.caniemail.com) (`apps/web/src/server/html-import/caniemail-outlook.json`, MIT licensed, Copyright (c) 2019 Remi Parmentier, with source and date in the file). The excerpt is not fetched at build or test time; refresh it by hand with `vp run --filter web caniemail:update` and commit the file.
- **Starter template:** a new template can start from the invitation starter instead of empty.

### Sample mails and the Mailpit relay

`vp run --filter web mail:sample` sends four sample mails (the standard layout with all blocks to a woman informally; the formal form to a company; two columns; the full CD with logos and icon links) with invented data to `sample@example.org` through `DEV_SMTP_URL`, so they land in Mailpit (<http://localhost:8025>). It reads `DEV_SMTP_URL` (required) and `APP_URL` from the environment (load `apps/web/.env` as shown above). Real mailboxes cannot reach `localhost`, so every image goes along as an inline attachment (`cid:`); the photo is generated on the fly.

For a look in real mail clients, Mailpit can release (relay) a mail to your own mailbox:

```sh
cp docker/mailpit-relay.example.yaml docker/mailpit-relay.yaml   # fill in your SMTP account
docker compose -f docker/compose.dev.yml -f docker/compose.relay.yml up -d mailpit
vp run --filter web mail:sample
```

Then open a mail in Mailpit, press "Release" and enter the address of a mailbox of your own. **`docker/mailpit-relay.yaml` holds the credentials of an SMTP account: it is in `.gitignore` and must never be committed.** Only `docker/mailpit-relay.example.yaml`, with placeholder values, is in the repository. Before a release that touches the layout, look at the four mails in Outlook (classic and new), Gmail (web and app), Apple Mail and the iOS mail app. The E2E tests already check them with Mailpit's HTML check (at least 80 % supported) and with axe, but only real clients show how they look.

## Contacts and imports

Contacts are the club's members and partners (`/contacts`). Everyone with at least `read` in an area sees the list and the base fields (numbers, organization, names, e-mail, gender, groups, tags). The protected fields (birth date, entry and exit date, address and protected custom fields) reach only users with `read` in an area the field is assigned to for that kind of contact; the server does not send them to anyone else. The admin role alone gives no access to contacts.

- **Members** come from the CSV or XLSX export of the club's membership software (`/contacts/import/members`, needs `edit` in the members area). The column mapping is saved with every confirmed import and suggested for the next one. A confirmed import replaces the members: rows missing from the file or left out by a filter, and members whose exit date has come, are deleted. When that would delete more than 20 % of the members, the import needs an explicit confirmation with the number. Members cannot be edited in the app; corrections happen in the membership software.
- **Partners** come from an export of their own (`/contacts/import/partners`) or are created and edited in the app (`/contacts/new`), with tags; both need `edit` in the partners area. The import matches by customer number, otherwise by e-mail address, and deletes nothing on its own: partners missing from the export are deleted only when they are ticked in the preview.
- **Suppressions and opt-outs** are stored apart from the contact, under the member number, the customer number or, for a partner without one, the e-mail address. They survive every import and apply again when a contact comes back. Partners without a customer number that share an address share them as well.
- **Stale member data:** when the last confirmed member import is older than the configured weeks (8 by default), readers of the members area and admins see a banner, and the active admins get a weekly mail (see [Operations](#operations)). Before the first import the start page points to it.
- **The import file never leaves the browser.** It is read there with `read-excel-file` (XLSX) and `papaparse` (CSV), which the page loads only when a file is read; only the values of the mapped columns go to the server, as gzip-compressed JSON, and nothing is stored between the steps. `fflate` unzips XLSX files synchronously, because its asynchronous unzip starts a Worker from a `blob:` URL, which a Content Security Policy without `worker-src blob:` blocks.

## Sending

Mails leave the app through a **connection** to a provider and a **sender** on it; admins set both up on `/admin/sending`. The areas decide who may send from a sender.

- **Connections:** Microsoft Graph (tenant, client ID and client secret of an app registration; the secret's expiry date is entered by hand, because Graph does not tell it) and Resend (API key, an optional webhook signing secret for bounces and complaints). Every secret is stored encrypted (AES-GCM, see [Operations](#operations)) and is never shown again: a stored secret is an empty field, and an empty field keeps it. Saving new credentials checks them at once (Graph fetches a token; Resend cannot be checked without sending, so its test mail decides).
- **Senders:** an address with a display name, an optional reply-to address, the connection and the areas the sender is released to. A sender without an area sends system mails only. On Graph a sender has its own throttling (mails per minute) and daily limit; on Resend both belong to the connection and hold for all its senders together. A new sender, and one whose address or connection changed, gets the **self test**: the credentials, a test mail to the admin and, for Graph, the restriction test, which reads a mailbox of the tenant that is not the sender's. A Graph app registration should be restricted to the sender mailboxes (an application access policy); when other mailboxes are readable, the page warns in red. The test can be run again from the sender's page.
- **System sender:** exactly one sender sends the system mails (sign-in links, invitations, warnings), marked on its page. Until one is set, admins see a notice on the start page.
- **Outbox:** every mail is an entry with a status. The tick sends the due entries of each sender in turns, personal mails before group mails, within the throttling and the daily limit (the day is the club's, Europe/Berlin; personal mails due today keep a reserve that group mails may not use). A failed attempt is retried after 5 minutes, 30 minutes, 2 hours and 8 hours, then the entry fails. A quota refusal by the provider pauses that sender (Graph) or connection (Resend) for at least an hour, then one entry tests it. **An entry whose outcome is unclear (a send that did not answer in time) is marked „unsicher“ and is never sent again automatically**, so nobody gets a mail twice; the sender's row shows how many there are.
- **Warnings:** see [Operations](#operations).

### Fake providers for development and tests

`vp run --filter web dev:providers` starts a stand-in for Microsoft Graph and Resend on port 3200 (`apps/web/e2e/fakes/providers.ts`). Set `DEV_PROVIDERS_URL=http://localhost:3200` (with an `http://localhost` `APP_URL`; the app refuses the variable on any other host, on Cloudflare and on Vercel) and create a Graph or Resend connection with any tenant, client ID and secret: the fake takes every secret except `wrong-secret`, which it answers with 401 (a way to see a disturbed connection). Accepted mail goes to Mailpit through `localhost:1025`. The restriction test of a Graph sender reads a mailbox that is not a sender mailbox and so answers „restricted“; `readable@verein.test` answers „readable“ (the warning). **Never use real accounts in tests or development**; the fake exists so that nobody has to.

## Operations

- **Remove `SETUP_TOKEN` after the setup.** `/setup` is then switched off.
- **System mails** (sign-in links, invitations, the stale data warning) go through the sender an admin marks for system mails on `/admin/sending`, directly and not through the outbox, in the CD's standard layout and the recipient's language; when that layout cannot be rendered (e.g. an `http://` `APP_URL` in development), a plain version goes. Graph sends them without a copy in "Sent Items", Resend without the archive copy. They count against the daily limit of the sender (Graph) or the connection (Resend) but are never held back by it; a mail the provider then refuses still counts. **Until a system sender is set**, the start page tells admins so, and system mails go only through `DEV_SMTP_URL` (development) or not at all; users can still sign in with Microsoft when it is configured. The setup's own session is then the only way in for the first admin. Sessions last 7 days and are renewed when used, so it lapses after 7 days without use; keep it alive or configure Microsoft sign-in.
- **Sign-in links** lead to a confirmation page (`/login/confirm`) whose „Anmelden“ button signs in; merely opening the link (as mail scanners do) uses nothing up. A link is valid for 15 minutes and works once. Each address gets at most one link per minute and ten per day (Europe/Berlin); further requests are answered the same way but send nothing. An invitation that could not be sent is marked in the user list, and admins can send it again („Einladung erneut senden“, at most once a minute per user).
- **Rotating `APP_SECRET` signs everyone out** (the session cookies no longer verify) and resets the login link windows. It also makes the **stored connection secrets undecryptable** (Graph client secrets, Resend API keys and webhook secrets are encrypted with a key derived from `APP_SECRET`). Afterwards no system mail goes out, no sign-in link included, until an admin enters the credentials of the connections again. The way back: sign in without a mail, through Microsoft sign-in (when configured) or the setup path (`SETUP_TOKEN` set again, `/setup`), open `/admin/sending`, and save every connection with its secret entered anew. A connection whose secret cannot be decrypted counts as disturbed; the mails of its senders wait in the outbox and go out once the connection works again.
- **Security headers:** pages and API responses carry `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a `Content-Security-Policy` with a nonce per request (`default-src 'self'`, scripts need that nonce, no `unsafe-eval` (zod runs without its JIT, `z.config({ jitless: true })` in `apps/web/src/zod-config.ts`), `img-src 'self' blob: data:`, `worker-src 'none'`, `frame-ancestors 'none'`, `upgrade-insecure-requests` with an `https:` `APP_URL`), set by the request middleware in `apps/web/src/start.ts`. The confirmation page of sign-in links (`/login/confirm`) sends `Referrer-Policy: strict-origin`, so the token in its URL does not reach the `Referer` of its own requests. Two paths differ otherwise: `/media/*` gets `default-src 'none'; sandbox` (see [Image storage](#image-storage)), and `/preview-frame`, the document of the sandboxed iframe that shows the mail preview, gets a policy of its own (`default-src 'none'`, scripts with the nonce only, inline styles, `img-src 'self' https:` so the preview can show images of imported templates, `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`; only GET, other methods get `405`, and an unreadable setting an empty `503`). The built assets under `/assets/` and the icons under `/social/` never reach that middleware: Nitro's static handler (Node), Vercel's CDN and Cloudflare's Workers assets serve them. They get the base headers (`Content-Security-Policy: frame-ancestors 'none'` instead of the page policy, as a file has no nonce) from each platform's configuration (`apps/web/src/platform/static-headers.ts`): a Nitro route rule on Node, the routes of `.vercel/output/config.json` on Vercel, and a `_headers` file in `dist/cloudflare/client` on Cloudflare.
- **Errors:** pages show a generic error or not-found page, and a failed server function sends a generic error to the browser. The server logs only the error's code or name, also for Better Auth's own errors, and a 5xx response of Better Auth only as `better auth HTTP <status>`, so no query parameters, tokens or addresses end up in the logs.
- **Contact settings** are on `/admin/contact-settings` (admins only): the members area and the partners area, the areas that see each protected field per kind of contact, the protection of custom fields and the weeks after which the member data counts as stale. The setup makes „Mitglieder“ the members area and „Finanzen“ the partners area. **Instances set up before this version** have neither: an admin chooses both there once. Until then nobody can import, maintain partners or set suppressions and opt-outs.
- **Imports** take at most 10,000 rows (4,000,000 bytes compressed, 16 MiB unpacked). A server function call with form data (only the import sends any) above 4.5 MB is answered with 413 before its body is read, one whose body breaks off with 400 (`apps/web/src/platform/body-limit.ts`), so a large request cannot fill the memory of a Node server; Vercel refuses such requests itself.
- **Stale member data warning:** while the member data is stale, a tick step mails all active admins once a week, each in their language. It goes through the system mailer (see System mails above); without a system sender and `DEV_SMTP_URL`, or when the provider refuses it, the attempt is logged by its error code (`stale import warning failed`) and in the activity log, and the next attempt comes a week later.
- **Sending warnings:** a tick step mails all active admins, each in their language, about a Graph secret that is about to expire (30, 14, 7 and 1 day before, each once), a connection the provider refuses (once per disturbance) and, at most once a club day, the new failed or uncertain entries of the outbox (counts per sender, never a recipient). The start page and `/admin/sending` show the same state to admins: the expiring secret from 30 days on, the disturbance, and per sender the open, uncertain and failed entries and today's count against the limit. If the system sender itself is the disturbed one, the warning mails go only through `DEV_SMTP_URL` or not at all; the pages still show it. A warning whose activity log entry cannot be written is sent again by the next tick.
- **Templates, images and layouts:** nothing to set up beyond [Image storage](#image-storage) (without a storage, uploads are refused). Deleting an image or a global layout that a template uses is refused until the template changes. An imported template's images must come from its area's library, those of a global layout from the CD's logos.
- **Housekeeping:** every tick deletes expired login links, closed login link windows, the sign-in link counts of past days, expired sessions and rate limiter rows idle for more than two minutes. A second tick step, `stale-import-warning`, sends the weekly warning about stale member data.
- **Run Node/Docker only behind a reverse proxy.**
  - The proxy terminates HTTPS and sets `X-Forwarded-For` to the client's address; for nginx, `proxy_set_header X-Forwarded-For $remote_addr;`.
  - Requests for sign-in links are limited per address. Without the header, all clients share one limit.
  - Cloudflare and Vercel set the address themselves.
- **Two database pools on Node.**
  - The tick runs on a second pool of its own, next to the pool of the requests. Both are node-postgres pools with at most 10 connections each.
  - The database's connection limit must cover both.
- **Database pool errors** are logged as `db pool error <code>` (Neon's WebSocket errors as `db pool error Event error`). Errors of a pool that is closing, as every request's pool does on Cloudflare, are not logged: they are the sockets going away, not the database.
- **Sending tables:** `mail_connections` (connections with the encrypted secrets), `senders` and `sender_areas` (senders and their released areas), `outbox_entries` (the outbox), `send_quota_days` (the daily counts per sender or connection) and `send_scope_pauses` (scopes paused after a quota refusal). Migrations create them on deploy; nothing needs to be set up by hand. A connection or sender in use (a sender with waiting outbox entries or an occasion, a connection with senders) cannot be deleted.
- **Health:** `GET /api/health` answers 200 with `{"ok":true}` when the database is reachable, otherwise 503.

## CI

`.github/workflows/ci.yml` runs on every push and every pull request. The one exception is a push to `changesets-ghcommit-temp/**`: the release workflow points that temporary branch at the `main` commit before it writes the version commit onto it, so a run there would be cancelled within seconds and its cancelled checks would show on the `main` commit.

- `check`: `vp check`, `pnpm check:catalog`, `pnpm check:vite-plus`, `pnpm cve` (dependency advisories) and, on pull requests, commitlint over all commits of the pull request
- `test`: `vp test --coverage`, with a PostgreSQL and a SeaweedFS service container (trust authentication, so the workflow holds no password) and `TEST_POSTGRES_URL` and `TEST_S3_URL`, so the concurrency and storage tests run as well; then the SonarQube Cloud scan (see [Security scanning](#security-scanning))
- `build`: the three targets. The job also checks that Tiptap, `read-excel-file`, `papaparse` and `fflate` are in no server bundle (the editor and the import reader load them by dynamic `import()` in the browser only; the check looks for a chunk named after them or their `node_modules/` path), and that `nodemailer`, `pg` (with `pg-pool` and `pg-protocol`), `s3mini` and `@vercel/blob` do not end up in the Cloudflare bundle: it fails on their module paths (`node_modules/pg-pool/…`), which the bundle keeps in comments and source maps, but not on the copy of pg's `package.json` that Neon's driver carries as text.
- `docker`: builds `docker/Dockerfile` (without pushing)
- `e2e`: the end-to-end tests, against PostgreSQL, Mailpit and SeaweedFS as service containers

`voidzero-dev/setup-vp` sets up Vite+, Node (from `.node-version`) and pnpm (from `packageManager`), and installs the dependencies with `--frozen-lockfile`. A newer push cancels the running checks of the same branch or pull request; on `main`, every commit keeps its run.

## Security scanning

Three scanners look at the code and the dependencies. None needs a secret except SonarQube Cloud.

- **cve-lite (`pnpm cve`):**
  - It checks `pnpm-lock.yaml` against OSV and the npm registry advisories and fails on `high` or `critical` (`cve-lite . --fail-on high --verbose`, cache in `.cache/cve-lite`).
  - It runs locally in the `pre-push` hook (skipped when `CI` is set) and in the CI `check` job.
  - It knows only OSV and npm advisories. Snyk uses its own database and can report more, so a clean `pnpm cve` does not mean a clean Snyk check.
  - Fix a finding by updating the dependency or, when the parent has no fix yet, with a scoped entry in `overrides` (like the esbuild one in `pnpm-workspace.yaml`).
- **SonarQube Cloud** analyzes in CI, not through Automatic Analysis (that cannot import coverage).
  - `sonar-project.properties` holds the organization `mheob`, the project key `mheob_vereinsbote` and the paths. The `test` job runs `vp test --coverage` (provider v8, report `coverage/lcov.info`, configured in the root `vite.config.ts`) and then the scan action. The scan runs on pushes to `main` and on pull requests of this repository, not on forks (they get no secrets).
  - The quality gate asks for 80 % coverage on new code. It counts the unit tests only, so `sonar.coverage.exclusions` leaves out the code that runs only inside the framework or a runtime and is tested end to end instead: routes, React components (`*.tsx`), server functions (thin wrappers around the tested `server/` modules), the router, the Node and Workers entry points, the migration CLIs and the sample mail CLI (`sample-cli.ts`). Plain modules next to them (hooks, helpers) still count. The test files themselves are excluded from the sources.
  - `sonar.cpd.exclusions` leaves the two dictionaries `i18n/de.ts` and `i18n/en.ts` out of the duplication check: they share their key structure by design.
  - Setup by the owner: in SonarQube Cloud import `mheob/vereinsbote` into the organization `mheob` (it gets the key `mheob_vereinsbote`), switch Automatic Analysis off in the project's administration (Analysis Method), create a token (My Account, Security) and add it as the repository secret `SONAR_TOKEN`. Optionally add the SonarQube Cloud check to the `main` ruleset as a required status check.
  - `@vitest/coverage-v8` must have the version of Vitest that Vite+ bundles. It is part of the `vite-plus toolchain` Renovate group and of `pnpm check:vite-plus`.
- **Snyk** checks the pull requests through its GitHub integration; there is no Snyk CLI or token in CI.
  - Setup by the owner: import the repository in Snyk. Its PR check then reports new vulnerabilities in the lockfile.
  - `.snyk` is the policy file. Ignore only a finding that no released version fixes, with a reason and an expiry date, so it gets reviewed again. Otherwise update the dependency.

## Releases

Versions, the changelog, git tags and GitHub Releases come from [Changesets](https://github.com/changesets/changesets) (`.changeset/`). Only the app (`apps/web`, package `web`) is versioned; the root package is not. Nothing is published to npm (`access: restricted`).

- **Changesets:** a pull request with a user-facing change carries a Markdown file in `.changeset/` (`pnpm changeset`) that names the bump (`patch`, `minor`, `major`) and the changelog text. Dependency updates and other changes without a user-facing effect need none; nothing in CI requires one.
- **Release pull request:** on every push to `main` that touches `.changeset/`, `apps/`, `pnpm-lock.yaml` or the workflow, `.github/workflows/release.yml` runs [`changesets/action`](https://github.com/changesets/action). With changesets present it opens or updates the pull request "chore(release): version packages". It runs `pnpm run version-packages` (`changeset version`, which raises the version in `apps/web/package.json`, writes `apps/web/CHANGELOG.md` through `@mheob/changeset-changelog` and deletes the used changesets).
- **Release:** merging that pull request leaves no changesets, so the next run executes `pnpm run release` (`changeset git-tag`: a git tag `web@<version>` for the new version), pushes the tag and creates the GitHub Release from the changelog entry.
- **First release:** the initial changeset (`minor`) turns `0.0.0` into `0.1.0`.
- **The code owner's approval is the release gate.**
  - The version pull request is opened by the GitHub App `mheob-helper` (author `mheob-helper[bot]`), so it needs the approval of a code owner before Kodiak merges it. That approval is the deliberate release step. The app must not be on the bypass list of the `main` ruleset.
  - The branch ruleset for `main` must have "Require review from Code Owners" and either "Dismiss stale pull request approvals when new commits are pushed" or "Require approval of the most recent reviewable push", because Changesets keeps pushing to the open version pull request: an approval must not carry over to commits the owner has not seen.
  - The owner's own pull requests bypass the review (see "Contributing and merging"). That is why the release pull request must never be opened with the owner's token.
- **Release app:** the workflow creates a short-lived installation token of the GitHub App `mheob-helper` with [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token), limited to `contents: write` and `pull-requests: write` and revoked when the job ends. A `GITHUB_TOKEN` would not trigger CI on the release pull request. Its commits and tags carry the app's bot user (`mheob-helper[bot]`) as Git identity.
  - Setup by the owner: install the app on the repository with the repository permissions Contents and Pull requests (read and write), then create (Settings, Secrets and variables, Actions) the variable `BOT_CLIENT_ID` (the app's client ID) and the secret `BOT_PRIVATE_KEY` (a private key of the app).
- Its `GITHUB_TOKEN` is read-only (`permissions: contents: read`) like in every other workflow; only the app token writes. The workflow is the only one with persisted checkout credentials (`changeset git-tag` checks existing tags with an authenticated `git ls-remote`); it runs only on `main`, never code from pull requests.

## Supply-chain security

- **Pins:**
  - GitHub Actions are pinned to the commit SHA of their release (`uses: owner/action@<sha> # vX.Y.Z`).
  - Container images are pinned by digest (`image:tag@sha256:…`) in the Dockerfile, in both Compose files and in the CI service containers.
- **CI:**
  - The CI workflow runs with a read-only token (`permissions: contents: read`) and `persist-credentials: false`, without `pull_request_target`. The release workflow runs only on `main` and writes with the token of the release app (see [Releases](#releases)).
- **pnpm (`pnpm-workspace.yaml`):**
  - It installs only versions that are at least a day old (`minimumReleaseAge`).
  - It refuses versions published with less trust evidence than their predecessors (`trustPolicy: no-downgrade`).
  - It runs install scripts only for packages listed in `allowBuilds` (`strictDepBuilds`).
  - Transitive dependencies come from the registry only (`blockExoticSubdeps`).
  - Exceptions are listed in the file with their reasons.
  - `overrides` lift vulnerable transitive versions: drizzle-kit's loader (`@esbuild-kit/core-utils`) pins esbuild 0.18, which has a dev server advisory (fixed in 0.25), and drizzle-kit itself asks for esbuild 0.25, which Snyk rates critical (insecure binary download in `installFromNPM`, fixed in 0.28.1). Both scoped overrides resolve that esbuild to the catalog version. `vite` and `vitest` follow the catalog as well (Vite+).

### Keeping the pins current with Renovate

The [Renovate GitHub App](https://github.com/apps/renovate) must be installed for the repository. It reads `.github/renovate.json`, which extends `github>mheob/renovate-config`. Do not add a `renovate.json` at the root (the onboarding pull request creates one): Renovate reads it first and would ignore the rules in `.github/renovate.json`.

- That preset includes `config:best-practices`, which sets and updates the SHA pins of the actions and the digests of the images.
- Renovate also updates the versions in the pnpm catalog, `packageManager` and `.node-version`.
- Updates come once a week, with non-major updates grouped.

Rules of this repository in `.github/renovate.json`:

- `vite-plus`, its core (`vite` in the catalog), `vitest` and `@vitest/coverage-v8` come together in one pull request. `pnpm check:vite-plus` (`scripts/check-vite-plus-versions.ts`) fails CI when the installed versions differ from what `vite-plus` declares.
- `oxfmt` and `oxlint` get no updates of their own. They follow the versions that ship with Vite+.
- `nitro` (Nitro 3 is a release candidate) waits for approval on the Dependency Dashboard and gets a pull request of its own.

## Contributing and merging

- **Kodiak:**
  - [Kodiak](https://kodiakhq.com) merges a pull request as soon as all checks are green, without needing a label.
  - Its configuration is shared by all repositories and lives in `mheob/.github` (`.github/.kodiak.toml`); this repository has none of its own.
  - It squash-merges: the pull request's title and description become the commit message, then the branch is deleted.
  - So the title follows Conventional Commits, and closing keywords such as `Closes #123` belong in the pull request's description, not only in individual commits.
- **Private vulnerability reporting** must be switched on in the repository settings (the "Private vulnerability reporting" switch on the security settings page, called "Advanced Security" or "Code security" depending on the GitHub plan). Without it the Security tab offers no "Report a vulnerability" button, and `SECURITY.md` points nowhere.
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
