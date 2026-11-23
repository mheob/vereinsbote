# Vereinsbote

Vereinsbote ist eine Open-Source-Web-App, mit der ein Verein E-Mails an seine Mitglieder und Partner verschickt. Die Oberfläche gibt es auf Deutsch (Standard) und Englisch.

## Voraussetzungen

- Node.js 26 (siehe `.node-version`)
- pnpm 12 (siehe `packageManager` in `package.json`)
- [Vite+](https://viteplus.dev) mit der CLI `vp`
- Docker, für PostgreSQL und Mailpit

## Lokale Entwicklung

```sh
pnpm install
docker compose -f docker/compose.dev.yml up -d   # PostgreSQL :5432, Mailpit :1025 (SMTP) und :8025 (Web)
cp apps/web/.env.example apps/web/.env           # ausfüllen, siehe unten
set -a; . apps/web/.env; set +a                  # die Variablen in die Shell laden
vp run --filter web db:migrate
vp dev                                           # http://localhost:3000
```

- In `apps/web/.env` die Secrets erzeugen (die Befehle stehen in der Datei) und `DEV_SMTP_URL=smtp://localhost:1025` setzen. Dann landen alle Mails in Mailpit unter <http://localhost:8025>.
- Beim ersten Start führt `/setup` mit dem `SETUP_TOKEN` durch die Ersteinrichtung des ersten Admins.
- Prüfen: `vp check` (Format, Lint, Typen), `vp test`, `pnpm check:catalog` und `pnpm check:vite-plus`.
- Committen: `pnpm commit` startet czg für Conventional Commits. Die Git-Hooks (`.vite-hooks/`) installiert `pnpm install` über `vp config`.

### End-to-End-Tests

```sh
docker compose -f docker/compose.dev.yml up -d
pnpm --filter web exec playwright install chromium   # einmalig
vp run --filter web e2e
```

Playwright baut die Node-Ausgabe und startet sie auf Port 3100 mit festen Testwerten (`apps/web/e2e/env.ts`). Jeder Lauf leert die Datenbank `vereinsbote_e2e` und das Postfach von Mailpit. Die Entwicklungsdatenbank `vereinsbote` bleibt unberührt. `compose.dev.yml` legt `vereinsbote_e2e` an, wenn das Volume neu entsteht. Fehlt sie in einem älteren Volume, hilft `docker compose -f docker/compose.dev.yml down -v`.

## Umgebungsvariablen

Alle Variablen sind in `apps/web/.env.example` beschrieben und werden beim Start geprüft (`apps/web/src/server/env.ts`).

| Variable | Pflicht | Zweck |
| --- | --- | --- |
| `DATABASE_URL` | ja | PostgreSQL-Verbindung (`postgres://…`) |
| `APP_URL` | ja | Öffentliche Adresse, `https://` (`http://` nur für localhost) |
| `APP_SECRET` | ja | 32 Byte, Base64; verschlüsselt gespeicherte Zugangsdaten |
| `CRON_SECRET` | ja | Mindestens 32 Zeichen; schützt den Tick (`/api/tick`) |
| `SETUP_TOKEN` | nein | Schaltet `/setup` frei, bis der erste Admin existiert |
| `MS_LOGIN_CLIENT_ID`, `MS_LOGIN_CLIENT_SECRET`, `MS_LOGIN_TENANT_ID` | nein | Anmeldung mit Microsoft, alle drei oder keine |
| `DEV_SMTP_URL` | nein | Nur Entwicklung: Systemmails per SMTP, z. B. an Mailpit |
| `HEARTBEAT_URL` | nein | Wird nach jedem erfolgreichen Tick aufgerufen |
| `TICK_INTERVAL_MS` | nein | Nur Node/Docker: Abstand der Ticks, Standard 15 Minuten |

## Builds und Deployment

Es gibt drei Ziele. Bei allen laufen die Migrationen, bevor die neue Version Anfragen beantwortet.

| Ziel | Build | Ausgabe | Migrationen |
| --- | --- | --- | --- |
| Node/Docker | `vp run --filter web build:node` | `apps/web/dist/node` | beim Start des Servers |
| Vercel | `vp run --filter web build:vercel` | `apps/web/.vercel/output` | im Build-Befehl (`apps/web/vercel.json`) |
| Cloudflare Workers | `vp run --filter web build:cloudflare` | `apps/web/dist/cloudflare` | in `deploy:cloudflare` |

### Node und Docker

Die Node-Ausgabe enthält alle Abhängigkeiten und die Migrationen. Sie startet mit `node apps/web/dist/node/server/index.mjs`, den Port setzt `PORT` (Standard 3000). Beim Start wendet der Server zuerst die offenen Migrationen an und beantwortet bis dahin keine Anfrage. Schlagen sie fehl, beendet er sich mit Code 1.

Mit Docker Compose (App und PostgreSQL):

1. `docker/.env` anlegen: die Variablen aus `apps/web/.env.example` außer `DATABASE_URL` (die setzt `compose.yml`), dazu `POSTGRES_PASSWORD`. Das Passwort steht in einer URL, also nur URL-sichere Zeichen verwenden, z. B. `openssl rand -hex 24`.
2. `docker compose -f docker/compose.yml up -d --build`
3. `curl -s localhost:3000/api/health` liefert `{"ok":true}`.

Das Image (`docker/Dockerfile`) baut in einer eigenen Stufe und enthält zur Laufzeit nur Node und `apps/web/dist/node`, ohne `node_modules`, Quelltext und npm. Der Server läuft als Benutzer `node`. Compose startet ihn mit schreibgeschütztem Dateisystem (nur `/tmp` ist beschreibbar), ohne Capabilities und mit `no-new-privileges`. Die App lauscht nur auf `127.0.0.1:3000`.

### Vercel

- Root Directory des Projekts ist `apps/web`.
- `apps/web/vercel.json` setzt den Build-Befehl: erst `db:migrate`, dann `build:vercel`. Er steht in der Datei statt in den Projekteinstellungen, damit er versioniert ist und im Review sichtbar wird.
- Cron und `maxDuration` für `/api/tick` stehen in der Nitro-Konfiguration (`apps/web/vite.config.ts`), nicht in `vercel.json`.
- `DATABASE_URL` muss auch im Build verfügbar sein. Preview-Deployments migrieren die Datenbank, die für Preview eingetragen ist.

### Cloudflare Workers

- Die Variablen sind Secrets des Workers: `wrangler secret put DATABASE_URL`, ebenso `APP_URL`, `APP_SECRET`, `CRON_SECRET` und die optionalen.
- Deploy: `vp run --filter web build:cloudflare`, danach `vp run --filter web deploy:cloudflare` mit `DATABASE_URL` in der Shell. Das Skript migriert zuerst und ruft dann `wrangler deploy` auf.
- Der Cron-Trigger steht in `apps/web/wrangler.jsonc`.

## Betrieb

- **`SETUP_TOKEN` nach der Einrichtung entfernen.** Danach ist `/setup` abgeschaltet.
- **Node/Docker nur hinter einem Reverse Proxy betreiben.** Er beendet HTTPS und setzt `X-Forwarded-For` auf die Adresse des Clients, bei nginx mit `proxy_set_header X-Forwarded-For $remote_addr;`. Die Anfragen nach Anmeldelinks sind pro Adresse begrenzt. Ohne den Header teilen sich alle Clients ein Limit. Cloudflare und Vercel setzen die Adresse selbst.
- **Zwei Datenbank-Pools auf Node.** Der Tick läuft mit einem eigenen, zweiten Pool neben dem der Anfragen (node-postgres, je höchstens 10 Verbindungen). Das Verbindungslimit der Datenbank muss für beide reichen.
- **Migrationen ohne Sperre.** Laufen mehrere Node-Instanzen, sollte eine neue Version zuerst auf einer Instanz starten.
- Zustand prüfen: `GET /api/health` antwortet mit 200 und `{"ok":true}`, wenn die Datenbank erreichbar ist, sonst mit 503.

## CI

`.github/workflows/ci.yml` läuft bei jedem Push und jedem Pull Request:

- `check`: `vp check`, `pnpm check:catalog`, `pnpm check:vite-plus` und bei Pull Requests commitlint über alle Commits des Pull Requests
- `test`: `vp test`
- `build`: die drei Ziele. Zusätzlich prüft der Job, dass `nodemailer` und `pg` nicht im Cloudflare-Bundle landen.
- `e2e`: die End-to-End-Tests gegen PostgreSQL und Mailpit als Service-Container

Vite+, Node (aus `.node-version`) und pnpm (aus `packageManager`) richtet `voidzero-dev/setup-vp` ein. Die Abhängigkeiten installiert es mit `--frozen-lockfile`.

## Sicherheit der Lieferkette

- GitHub Actions sind auf den Commit-SHA ihres Releases gepinnt (`uses: owner/action@<sha> # vX.Y.Z`). Container-Images sind per Digest gepinnt (`image:tag@sha256:…`), im Dockerfile, in beiden Compose-Dateien und bei den Services der CI.
- Die CI läuft mit einem nur lesenden Token (`permissions: contents: read`) und `persist-credentials: false`, ohne `pull_request_target`. Überholte Läufe werden abgebrochen.
- pnpm (`pnpm-workspace.yaml`) installiert nur Versionen, die mindestens einen Tag alt sind (`minimumReleaseAge`). Es lehnt Versionen ab, die mit weniger Vertrauensnachweis veröffentlicht wurden als ihre Vorgänger (`trustPolicy: no-downgrade`). Install-Skripte führt es nur für Pakete in `allowBuilds` aus (`strictDepBuilds`), und transitive Abhängigkeiten kommen nur aus der Registry (`blockExoticSubdeps`). Ausnahmen stehen mit Begründung in der Datei.

### Pins aktuell halten mit Renovate

Die [Renovate GitHub App](https://github.com/apps/renovate) muss für das Repository installiert sein. Sie liest `.github/renovate.json`, die `github>mheob/renovate-config` erweitert. Darin steckt `config:best-practices`, das die SHA-Pins der Actions und die Digests der Images setzt und aktualisiert. Renovate aktualisiert außerdem die Versionen im pnpm-Catalog, `packageManager` und `.node-version`. Updates kommen einmal pro Woche, nicht-major gebündelt.

Eigene Regeln in `.github/renovate.json`:

- `vite-plus`, sein Core (`vite` im Catalog) und `vitest` kommen gemeinsam in einem Pull Request. `pnpm check:vite-plus` (`scripts/check-vite-plus-versions.ts`) lässt die CI fehlschlagen, wenn die installierten Versionen nicht zu dem passen, was `vite-plus` deklariert.
- `oxfmt` und `oxlint` bekommen keine eigenen Updates. Sie folgen den Versionen, die mit Vite+ kommen.
- `nitro` (Nitro 3 ist ein Release Candidate) wartet auf eine Freigabe im Dependency Dashboard und bekommt einen eigenen Pull Request.

## Beitragen und Mergen

- [Kodiak](https://kodiakhq.com) merged Pull Requests, sobald alle Checks grün sind. Ein Label dafür braucht es nicht. Die Konfiguration gilt für alle Repositories und liegt in `mheob/.github` (`.github/.kodiak.toml`), dieses Repository hat keine eigene.
- Kodiak merged per Squash. Titel und Beschreibung des Pull Requests werden zur Commit-Nachricht, danach wird der Branch gelöscht. Der Titel folgt deshalb den Conventional Commits. Schlüsselwörter wie `Closes #123` gehören in die Beschreibung des Pull Requests, nicht nur in einzelne Commits.
- Major-Updates von Renovate tragen das Label `major ⚠️`. Kodiak merged sie nicht, sie werden von Hand geprüft und gemerged.
- Pull Requests von Renovate brauchen die Freigabe eines Code Owners (`.github/CODEOWNERS`). Das ist eine Einstellung des Repositorys, keine Datei: ein Branch-Ruleset für `main` mit „Require a pull request before merging“, „Require review from Code Owners“ und den CI-Jobs als „Required status checks“.

## Lizenz

[MIT](LICENSE)
