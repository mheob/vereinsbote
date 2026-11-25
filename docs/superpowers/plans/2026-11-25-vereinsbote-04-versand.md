# Vereinsbote – Teilplan 4: Versand – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mails gehen wirklich raus. Ein Admin verbindet den Verein mit Microsoft Graph oder Resend und richtet Absender pro Bereich ein; Systemmails laufen über den echten Absender im CD-Layout. Ehrenamtliche verschicken über einen Anlass Wellen mit Vorschau, Testmail, Anhängen und Bestätigung; der Postausgang verteilt sie gedrosselt, innerhalb der Tageslimits, nie doppelt. Empfänger melden sich ab, Rückläufer werden erkannt.

**Architecture:**
- **Fachlogik in Modulen ohne Framework**, getestet mit PGlite: `server/sending` (Anbindungen, Absender, Adapter, MIME, Postausgang, Kontingent, Systemmails, Warnungen) in 4a; `server/occasions`, `server/waves`, `server/attachments`, `server/unsubscribe`, `server/bounces` in 4b. Routen und Server-Funktionen bleiben dünne Hüllen.
- **Adapter über `fetch`** mit einer gemeinsamen `Transport`-Schnittstelle; `fetch` und Basis-URLs werden eingespeist. Ein **Nachbau-Server** (`apps/web/e2e/fakes/providers.ts`) ahmt Graph und Resend nach und stellt an Mailpit zu; die App spricht ihn nur über `DEV_PROVIDERS_URL` an.
- **Postausgang als Tabelle**, abgearbeitet von einem Schritt der Zeitsteuerung; die Quelle eines Eintrags (in 4b: die Welle) liefert ein austauschbarer „Preparer“.
- **Rendern** über `compileMail`/`fillMail` aus Teilplan 3; die kompilierte Fassung liegt an der Welle.

**Tech Stack:** wie Teilplan 3, ohne neue Laufzeit-Abhängigkeit (eigener MIME-Baustein, Entscheidung 2). Der Nachbau-Server nutzt `nodemailer` (schon im Catalog) für die Zustellung an Mailpit.

**Spec:** `docs/superpowers/specs/2026-11-25-vereinsbote-04-versand-design.md` (verbindlich; gilt vor der Master-Spec `docs/superpowers/specs/2026-11-23-vereinsbote-design.md`, Abschnitte 5, 6.4, 6.6, 6.7, 6.10, 7)
**Fahrplan und Glossar:** `docs/superpowers/plans/2026-11-23-vereinsbote-00-fahrplan.md`
**Branches:**
- **4a (Tasks 1–11):** `feat/sending`. Enthält den Commit mit Design und Plan.
- **4b (Tasks 12–21):** `feat/occasions`, angelegt von `main`, nachdem 4a gemergt ist.

## Global Constraints

- **Grundlage:** Alle Regeln aus `AGENTS.md` und die Global Constraints der Teilpläne 1–3 gelten unverändert. Für diesen Teilplan besonders:
  - Vite+ (`vp`); pnpm-Catalog strikt; neueste stabile Versionen; `@/`-Imports; alles, was Code ist, englisch (Glossar: `sender`, `transport`, `outbox`, `wave`, `occasion`, `optOut`, `suppression`, `bounce`, `tick`); sichtbare Texte nur in `de.ts`/`en.ts`.
  - Jede Route mit `pageHead` bzw. `adminPageHead`. Formulare mit `PostForm` und `SubmitButton`.
  - Server-Funktionen mit zod, `requireRequestPrincipal` und Ablehnungen als Ergebnis (`{ ok: false, failure }`); Server-Module nur in den Handlern dynamisch importieren.
  - WCAG 2.2 AA mit axe in E2E; jede E2E-Datei importiert `test` aus `e2e/helpers/test.ts`; TDD.
- **Rechte (Design 18):**
  - Anbindungen, Absender, Systemabsender, Bereichsfreigaben: Admin (`assertAdmin`).
  - Anlass ansehen, Versandübersicht: `read` im Bereich. Anlass anlegen/ändern/archivieren/löschen, Markierung „E-Mail ungültig“ aufheben: `edit`. Versenden, Testmail, Welle stoppen, unklaren Eintrag erneut senden: `send`.
  - „Die Admin-Rolle allein gibt keinen Zugriff“ auf Bereiche, also auch nicht auf Empfänger.
- **Nie doppelt, nie an die Falschen (Design 8, 11):**
  - Ein Eintrag wird mit einer einzigen Anweisung übernommen (`FOR UPDATE SKIP LOCKED`); „in Versand“ länger als 10 Minuten → „unklar“, nie automatisch erneut.
  - Vor jedem Versand: Kontakt neu laden, `isMailable`, kein Widerspruch (Anlass, Bereich), keine Markierung „E-Mail ungültig“; Werte nach Bereich und Feldschutz, nie nach Benutzer.
- **Zahlen (Design):**
  - Wiederholung: höchstens 5 Versuche, Wartezeiten 5 min / 30 min / 2 h / 8 h (bzw. `Retry-After`, wenn länger).
  - Drosselung Graph Standard 30 Mails pro Minute.
  - Anmeldelinks: höchstens 10 pro Adresse und Kalendertag (zusätzlich zum Fenster von 60 s). „Einladung erneut senden“ höchstens einmal pro Minute und Benutzer. Testmails höchstens 20 pro Benutzer und Stunde.
  - Anhänge: PDF, JPEG, PNG (Signatur geprüft); höchstens 5 Dateien, 4 MiB (4 194 304 Bytes) pro Datei, 20 MiB pro Mail; über Graph darf die Anfrage (Base64 der MIME-Nachricht) höchstens 4 000 000 Bytes groß sein.
  - Geplanter Versand höchstens ein Jahr voraus. Verwaiste Anhänge nach einem Tag weg.
  - Webhook: Body höchstens 64 KiB, Zeitstempel höchstens 5 Minuten alt. Abmelden „Rückgängig“ 30 Minuten.
  - Secret-Warnmails 30, 14, 7 und 1 Tag vorher; Hinweis in der Oberfläche ab 30 Tagen.
- **Datenschutz:**
  - Keine Adressen, Tokens, Zugangsdaten, Mailinhalte in Logs, URLs, Fehlermeldungen oder Protokoll-Details; Logs nur über `errorLabel`; Antworten der Anbieter nur als klassifizierter Code.
  - Das Aktivitätsprotokoll nennt Kontakte über `auditTarget`, Benutzer als `user:<id>`, alles andere über IDs.
  - Zugangsdaten nur verschlüsselt (AES-GCM mit AAD), nie an den Browser zurück.
  - Testdaten sind erfunden (`example.org`, `*.example`, `*.test`). Kein echtes Konto, kein echter Key, nirgends.
- **Plattform:**
  - Adapter, MIME und Webhook-Prüfung laufen auf Node, Vercel und Workers: nur `fetch` und WebCrypto, keine Node-Module, kein `eval`.
  - `nodemailer` bleibt auf dem Node-Pfad hinter der Build-Konstante (Systemmails über `DEV_SMTP_URL`) und im Nachbau-Server; nie im Cloudflare-Bundle.
  - `DEV_PROVIDERS_URL` nur, wenn `APP_URL` `http:` auf `localhost`/`127.0.0.1` ist und `VITE_VB_PLATFORM` weder `cloudflare` noch `vercel` (sonst `EnvError`).
- **Sonar-Abdeckung:** Neue Logik steht in reinen Modulen mit Unit-Tests; Routen, `components/**/*.tsx` und `functions/**` prüft das E2E.
- **Fertig heißt:**
  - `vp check` meldet 0 Fehler und 0 Warnungen. `vp test` ist grün, mit `TEST_POSTGRES_URL` und `TEST_S3_URL` ebenso. `vp run --filter web e2e` ist grün.
  - Jede neue Seite hat `pageHead` und einen axe-Check. Kein E2E-Test sieht eine CSP-Verletzung.
- **Commits:** GitButler, nie `git add`/`git commit`, nie `-s`, **keine `Co-Authored-By`-Zeile**. Jeder Task endet mit:

```bash
but commit -b <branch> -F - <die Dateien aus „Files“ dieses Tasks, inkl. erzeugter Migrationen und pnpm-lock.yaml> <<'EOF'
<type>(<scope>): <beschreibung, höchstens 50 Zeichen, klein, ohne Punkt>
EOF
```

- **Release und Doku:** Je PR ein `minor`-Changeset (`web`). `README.md`, `AGENTS.md` und `CONTRIBUTING.md` ziehen Task 11 (4a) und Task 21 (4b) nach.

## Entscheidungen dieses Plans

Was das Design dem Builder überlässt (Design 23), hier festgelegt:

1. **Module:** `server/sending/{transport,mime,graph,resend,resend-webhook,connections,senders,errors,failures,open-transport,quota,outbox,outbox-step,system-mail,system-mailer,warnings}.ts`; 4b `server/occasions/`, `server/waves/`, `server/attachments/`, `server/unsubscribe/`, `server/bounces/`.
2. **MIME selbst gebaut** (`server/sending/mime.ts`, keine Abhängigkeit): CRLF, `MIME-Version: 1.0`, `multipart/mixed` → `multipart/alternative` (Text, HTML), Teile Base64 mit 76 Zeichen pro Zeile, Kopfzeilen mit Nicht-ASCII als RFC-2047-B-Wörter, Dateinamen als RFC-2231. Jeder Kopfzeilenwert läuft durch `cleanHeaderText` (kein CR/LF). Grund: wenige Zeilen, volle Kontrolle über Kopfzeilen-Einschleusung; die verbreiteten Bibliotheken zielen auf Node.
3. **Tabellen** (4a): `mail_connections`, `senders`, `sender_areas`, `outbox_entries`, `send_quota_days`, `login_link_days`; Spalten `user.invitation_sent_at`, `user.invitation_failed`. (4b): `occasions`, `waves`, `wave_contacts`, `attachments`, `contact_bounces`, `processed_reports`, `webhook_events`; Spalten `outbox_entries.wave_id`, FK `contact_opt_outs.occasion_id → occasions(id) on delete cascade` und ein Unique-Index für `scope = 'occasion'`.
4. **Kontingent-Bereich (`QuotaScope`):** `sender:<id>` bei Graph, `connection:<id>` bei Resend (Design 6.2, 7). `send_quota_days(scope text, day date, count int, primary key (scope, day))`; gezählt wird bei Annahme durch den Anbieter.
5. **Reserve:** Anzahl der Einträge `personal`, Zustand `planned`, im selben Bereich, mit `not_before` bis Ende des heutigen Tages (Europe/Berlin), einschließlich überfälliger. Rundschreiben laufen nur, solange `count + reserve < limit`.
6. **Drosselung:** pro Bereich höchstens `perMinute` Sendungen je 60-s-Fenster; dazwischen wartet der Schritt über ein eingespeistes `sleep`. Der Schritt beendet sich, bevor das Zeitbudget abläuft, und meldet `moreWork`.
7. **Message-ID:** `<` + 22 Zeichen base64url (16 Zufallsbytes) + `@` + Domain der Absenderadresse + `>`.
8. **Graph-Endpunkte:** Token `POST {login}/{tenant}/oauth2/v2.0/token`; Senden `POST {graph}/users/{mailbox}/sendMail` (MIME: `Content-Type: text/plain`, Body Base64; Systemmail: JSON mit `saveToSentItems: false`); Rückläufer `GET {graph}/users/{mailbox}/mailFolders/inbox/messages` mit Filter auf `receivedDateTime` und der erweiterten Eigenschaft Nachrichtenklasse (`String 0x001A`, `REPORT.IPM.Note.NDR`); Beschränkungstest `GET {graph}/users/{probe}/messages?$top=1`. Standard `login = https://login.microsoftonline.com`, `graph = https://graph.microsoft.com/v1.0`; mit `DEV_PROVIDERS_URL` `{base}/login` und `{base}/graph/v1.0`.
9. **Resend-Endpunkt:** `POST {api}/emails` mit `Idempotency-Key`; Standard `https://api.resend.com`, mit `DEV_PROVIDERS_URL` `{base}/resend`. Fehlerklassen nach dem `name` im Fehlerkörper (z. B. `daily_quota_exceeded`, `monthly_quota_exceeded` → `quota`; `rate_limit_exceeded` → `transient`; 401/403 → `unauthorized`; 422 Empfänger → `rejected`); der Builder prüft die Namen gegen die aktuelle Resend-Doku und hält sie in einer Tabelle im Adapter. Resend hat keinen günstigen Prüfaufruf für Keys mit „Sending access“: Eine gestörte Resend-Anbindung prüft der Postausgang, indem er pro Lauf genau einen fälligen Eintrag versucht.
10. **Webhook:** Route `/api/webhooks/resend/$connectionId`; Svix-Schema (`svix-id`, `svix-timestamp`, `svix-signature`; HMAC-SHA256 über `id.timestamp.body` mit dem Base64-Teil des `whsec_…`-Secrets; mehrere Signaturen durch Leerzeichen getrennt).
11. **Nachbau-Server:** `apps/web/e2e/fakes/providers.ts`, Node-HTTP auf Port 3200, gestartet als zweiter `webServer` in `playwright.config.ts` und lokal mit `vp run --filter web dev:providers`. Er nimmt jedes Secret außer `wrong-secret` (→ 401), stellt angenommene Mails per SMTP an `localhost:1025` zu und hat Steuer-Endpunkte unter `/__control/…` (siehe Task 5). Lesen auf Postfächer, die nicht in der Liste `senders` des Nachbaus stehen, beantwortet er mit 403 (Beschränkung wirkt), außer für `readable@verein.test` (200, für den Warnfall).
12. **Systemmailer pro Anfrage:** `createSystemMailer` bekommt die Datenbank und baut den Absender pro Aufruf aus der Tabelle; `AppContext.mailer` entsteht deshalb zusammen mit `auth` (pro Anfrage auf Cloudflare, pro Isolate sonst). Ohne Systemabsender: `DEV_SMTP_URL` (Node, lokal) bzw. `MailerNotConfiguredError`.
13. **`TickContext` bekommt `storage: ObjectStorage | null`** (für Anhänge); `runTick` nimmt es in `RunTickDeps`, die drei Aufrufer (`/api/tick`, Node-Intervall, Cloudflare `scheduled`) öffnen es wie bisher den Speicher der Anfrage.
14. **Routen:** 4a `/admin/sending` (Übersicht), `/admin/sending/connections/new`, `/admin/sending/connections/$connectionId`, `/admin/sending/senders/new`, `/admin/sending/senders/$senderId`, `/login/confirm` (Datei `routes/login_.confirm.tsx`). 4b `/occasions`, `/occasions/new`, `/occasions/$occasionId`, `/occasions/$occasionId/send`, `/sending` (Versandübersicht, Bereich per Auswahl), `/sending/waves/$waveId`, `/unsubscribe/$token`, `/api/webhooks/resend/$connectionId`.
15. **Empfänger-Filter (4b):** dieselben Filter wie die Kontaktliste (Kontaktart, Gruppe, Schlagwort, Suchbegriff) plus Einzelauswahl. Feldwert-Filter gibt es in der Kontaktliste nicht; sie kommen nicht in Teilplan 4 (Design 10.1: „wie in der Kontaktliste“). Die privaten Helfer `searchCondition` und `filterConditions` aus `server/contacts/contacts.ts` werden nach `server/contacts/filters.ts` verschoben und exportiert.
16. **`unsubscribe.url`:** Registry-Eintrag (Gruppe `layout`, Kontext `attribute`); im HTML-Import ein eigener Satz `URL_SLOT_KEYS = {'unsubscribe.url'}` neben `URL_BRAND_KEYS` (nur ganzer `href`, ohne Ersatztext); `compileMail` bekommt die Option `{ unsubscribe: boolean }`: Mit `true` wird `unsubscribe.url` zum Slot, das Standard-Layout zeigt den Link in der Fußzeile, und fehlt der Platzhalter in HTML, hängt `compileMail` eine Zeile vor `</body>` und ans Ende des Nur-Texts. Mit `false` ist ein vorhandener `{{unsubscribe.url}}` ein Fehler `invalid: 'unsubscribe'`.
17. **Mailquelle auf dem Server:** `previewSource`/`mailLayoutOf` ziehen aus `components/editor/preview-source.ts` nach `mail/templates/mail-source.ts` (browser-sicher); Editor und Versand nutzen dieselbe Funktion.
18. **Einmal-Schlüssel des Ablaufs:** Der Browser erzeugt beim Öffnen des Ablaufs eine UUID; `waves.request_id` ist unique.
19. **E2E:** Projekt `sending` (hängt von `templates` ab), Datei `apps/web/e2e/sending.e2e.ts`; Läufe der Zeitsteuerung per `POST /api/tick` mit `CRON_SECRET` aus `e2e/env.ts` (Helfer `runTick` in `e2e/helpers/tick.ts`).
20. **Reihenfolge der Tick-Schritte** (Spec 7: Versand, Rückläufer, Fristen, Warnungen; Teilplan 5 setzt die Datumsregeln vor `outbox`): `pruneAuthRecords`, `outbox`, `graphBounces`, `attachmentCleanup`, `staleImportWarning`, `sendingWarnings`. Jeder Task, der einen Schritt hinzufügt, setzt ihn an diese Stelle.

## Review Focus

1. **Zwei Läufe gleichzeitig oder ein Abbruch mitten im Senden:** Kein Eintrag geht doppelt raus; ein hängender Eintrag wird „unklar“ und nicht wiederholt. Tests in Task 7 (PostgreSQL) und Task 7 (Unit).
2. **Der Kontakt ändert sich zwischen Bestätigen und Versand:** Austrittsdatum erreicht, Sperre, Widerspruch, gelöscht durch Import, neue Adresse (persönlich: folgt; Rundschreiben: fällt heraus, nächster rückt nach). Tests in Task 16.
3. **Tageslimit an der Tagesgrenze Europe/Berlin**, auch in der Nacht der Zeitumstellung; persönliche Mails bekommen ihre Reserve, Rundschreiben laufen am nächsten Tag weiter; ein erschöpftes Resend-Kontingent verbraucht keine Versuche. Tests in Task 7.
4. **Kopfzeilen und Dateinamen:** Anzeigename oder Betreff mit CR/LF, Umlauten, Emoji, 200 Zeichen; Dateiname mit Umlaut, Anführungszeichen und Pfadteilen. Keine Kopfzeile lässt sich anhängen, alles kommt lesbar an. Tests in Task 2 und Task 14.
5. **Abmeldelink:** manipuliertes oder fremdes Token wird abgelehnt; die Ein-Klick-Abmeldung kommt vom Mailanbieter ohne Cookies und ohne `Origin` und wirkt; ein GET (Link-Scanner) ändert nichts. Tests in Task 18.

Die Dateien stehen im Block **Files** jedes Tasks. Tests liegen neben dem Code, E2E unter `apps/web/e2e`.

---

# Teil 4a – Anbindungen, Postausgang, Systemmails (`feat/sending`)

### Task 1: Verschlüsselung mit AAD und `DEV_PROVIDERS_URL`

**Files:**
- Modify: `apps/web/src/server/crypto/secrets.ts`, `apps/web/src/server/env.ts`, `apps/web/e2e/env.ts` (`DEV_PROVIDERS_URL: 'http://localhost:3200'`), `apps/web/.env.example` (falls vorhanden)
- Test: `apps/web/src/server/crypto/secrets.test.ts`, `apps/web/src/server/env.test.ts` (Ergänzungen)

**Interfaces:**
- Produces:

```ts
// server/crypto/secrets.ts
export const encryptSecret: (plaintext: string, key: CryptoKey, aad: string) => Promise<string>   // 'v2.<iv>.<ciphertext>'
export const decryptSecret: (token: string, key: CryptoKey, aad: string) => Promise<string>      // nur 'v2'; sonst SecretDecryptError
export function secretAad(table: string, rowId: string, field: string): string                    // `${table}/${rowId}/${field}`
// server/env.ts
interface Env { /* … */ devProvidersUrl: URL | null }
```

- [ ] **Step 1: Failing Tests schreiben**

```ts
// secrets.test.ts
it('round-trips with the same associated data', …)
it('refuses a ciphertext moved to another row or field', …)   // aad 'mail_connections/a/client_secret' vs '…/b/…' → SecretDecryptError
it('refuses the old v1 format', …)                             // 'v1.<iv>.<ct>' → SecretDecryptError
// env.test.ts
it('accepts DEV_PROVIDERS_URL with a local http APP_URL', …)   // devProvidersUrl.origin === 'http://localhost:3200'
it.each(['https://verein.example', 'http://192.168.1.5:3000'])('refuses DEV_PROVIDERS_URL with APP_URL %s', …)   // EnvError.variables enthält 'DEV_PROVIDERS_URL'
it('refuses a DEV_PROVIDERS_URL that is not http on a local host', …)
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/server/crypto apps/web/src/server/env.test.ts` meldet FAIL.
- [ ] **Step 3: Umsetzen.**
  - AES-GCM mit `additionalData = encoder.encode(aad)`; Token-Version `v2`. Bisher speichert nichts verschlüsselte Werte (Design 17), `v1` fällt ersatzlos weg.
  - `DEV_PROVIDERS_URL` nach dem Muster von `misplacedNeonProxy`: in `VARIABLE_ORDER`, Schema (nur `http:`, Host `localhost`/`127.0.0.1`, nur Origin), `Env`, Ablehnung außerhalb lokaler Entwicklung; auf Cloudflare- und Vercel-Builds immer abgelehnt (`import.meta.env.VITE_VB_PLATFORM`).
- [ ] **Step 4: Prüfen.** Dieselben Tests melden PASS. `vp check` meldet 0/0.
- [ ] **Step 5: Commit** – `feat(security): bind secrets to their place`

---

### Task 2: Transport-Schnittstelle und MIME

**Files:**
- Create: `apps/web/src/server/sending/{transport,mime}.ts`
- Test: `apps/web/src/server/sending/{transport,mime}.test.ts`

**Interfaces:**
- Consumes: `cleanHeaderText` (`mail/escape.ts`)
- Produces:

```ts
// server/sending/transport.ts
export type AttachmentType = 'application/pdf' | 'image/jpeg' | 'image/png'
export interface MailAttachment { readonly filename: string; readonly contentType: AttachmentType; readonly bytes: Uint8Array }
export interface OutgoingMail {
  readonly kind: 'regular' | 'system'            // system: Graph JSON ohne Ablage, ohne Archiv-Kopie
  readonly from: Readonly<{ address: string; name: string }>
  readonly replyTo: string | null
  readonly to: string
  readonly bcc: string | null
  readonly subject: string; readonly html: string; readonly text: string
  readonly messageId: string
  readonly listUnsubscribe: string | null       // URL; setzt auch List-Unsubscribe-Post
  readonly attachments: readonly MailAttachment[]
  readonly idempotencyKey: string | null
}
export type SendFailureClass = 'transient' | 'rejected' | 'unauthorized' | 'quota' | 'uncertain'   // uncertain: Anfrage ging raus, Ergebnis unbekannt (Ruling R2)
export type SendResult =
  | { ok: true; providerId: string | null }
  | { ok: false; failure: SendFailureClass; code: string; retryAfterMs: number | null }
export interface BounceReport { readonly reportId: string; readonly originalMessageId: string; readonly hard: boolean; readonly receivedAt: Date }
export interface Transport {
  readonly send: (mail: Readonly<OutgoingMail>) => Promise<SendResult>
  readonly probe: (() => Promise<SendResult>) | null                  // Graph: Token holen; Resend: null (Entscheidung 9)
  readonly fetchBounces: ((since: Date | null, limit: number) => Promise<{ reports: BounceReport[]; until: Date | null }>) | null
}
export function newMessageId(senderAddress: string): string
export function retryAfterMs(headers: Headers, now: Date): number | null   // Sekunden oder HTTP-Datum
// server/sending/mime.ts
export function buildMime(mail: Readonly<OutgoingMail>, date: Date): string
export const GRAPH_REQUEST_LIMIT_BYTES = 4_000_000
export function graphRequestBytes(mail: Readonly<OutgoingMail>, date: Date): number   // Länge von Base64(buildMime(...))
```

- [ ] **Step 1: Failing Tests schreiben**

```ts
// mime.test.ts
it('builds text and html alternatives with crlf line ends', …)   // Content-Type multipart/alternative; keine einzelne \n
it('encodes non-ascii subject and display name as rfc 2047 words', …)   // 'Einladung zum Sommerfest 🎉' und 'Förderverein Süd'
it('cannot add a header through a line break', …)                 // Betreff 'Hallo\r\nBcc: x@example.org' → genau eine Bcc-Zeile fehlt, Betreff einzeilig
it('sets List-Unsubscribe and the one-click header together', …)
it('wraps base64 parts at 76 characters and names files per rfc 2231', …)   // 'Anmeldung "Süd"/../x.pdf' → Dateiname ohne Pfad, maskiert
it('keeps the given Message-ID and Reply-To', …)
it('measures the graph request size', …)                          // graphRequestBytes einer Mail mit 2 MiB PDF > GRAPH_REQUEST_LIMIT_BYTES; mit 1 MiB darunter
// transport.test.ts
it('makes message ids with 22 random characters and the sender domain', …)
it.each([['120', 120_000], ['Wed, 25 Nov 2026 10:00:00 GMT', …]])('reads Retry-After %s', …)
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/server/sending` meldet FAIL.
- [ ] **Step 3: Umsetzen** nach Entscheidung 2. Kein Wert wird ungeprüft in eine Kopfzeile geschrieben.
- [ ] **Step 4: Prüfen.** Tests PASS; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(sending): add transport interface and mime`

---

### Task 3: Graph-Adapter

**Files:**
- Create: `apps/web/src/server/sending/graph.ts`
- Test: `apps/web/src/server/sending/graph.test.ts`

**Interfaces:**
- Consumes: Task 2
- Produces:

```ts
export interface GraphSettings { readonly tenantId: string; readonly clientId: string; readonly clientSecret: string }
export interface GraphEndpoints { readonly login: string; readonly graph: string }
export function graphEndpoints(env: Pick<Env, 'devProvidersUrl'>): GraphEndpoints                 // Entscheidung 8
export interface GraphDeps { readonly fetch: typeof fetch; readonly endpoints: GraphEndpoints; readonly now: () => Date }
export function createGraphTransport(settings: GraphSettings, mailbox: string, deps: GraphDeps): Transport
export type RestrictionResult = 'restricted' | 'readable' | 'unknown'
export function checkMailboxRestriction(settings: GraphSettings, probeMailbox: string, deps: GraphDeps): Promise<RestrictionResult>
export function classifyGraphResponse(status: number, body: unknown, headers: Headers, now: Date): SendResult    // rein
export function parseNdr(message: unknown): BounceReport | null                                                 // rein
```

**Regeln:**
- Das Token gilt nur innerhalb des Transports (ein Lauf, eine Anfrage); kein Cache über Anfragen.
- `regular` → MIME-`sendMail`; überschreitet `graphRequestBytes` die Grenze, liefert `send` `{ ok: false, failure: 'rejected', code: 'graph.tooLarge' }` ohne Aufruf. `system` → JSON-`sendMail` mit `saveToSentItems: false`, ohne Anhänge.
- Klassen: 401/403 und `invalid_client` beim Token → `unauthorized`; 429/5xx/Netzfehler/Zeitüberschreitung → `transient` (mit `Retry-After`); 400 mit ungültigem Empfänger → `rejected`; Codes wie `graph.unauthorized`, `graph.throttled`, `graph.server`, `graph.recipient`.
- `parseNdr`: Statuscode des Berichts `5.x.x` → `hard: true`, `4.x.x` → `false`; Original-Message-ID aus den mitgelieferten Kopfzeilen der Original-Mail (`In-Reply-To`/`References` oder der angehängte Kopf); ohne Message-ID `null`.
- `checkMailboxRestriction`: 403 → `restricted`, 200 → `readable`, sonst `unknown`.

- [ ] **Step 1: Failing Tests schreiben** (alle mit eingespeistem `fetch`, das Anfragen aufzeichnet)

```ts
it('gets a token per transport and sends the mime as base64 text', …)   // genau ein Token-Aufruf für zwei Mails; Content-Type text/plain
it('sends system mail as json without saving it', …)                    // saveToSentItems false; kein Anhang; kein List-Unsubscribe
it('refuses a mail over the graph request limit without calling graph', …)
it.each([[401, 'unauthorized'], [403, 'unauthorized'], [429, 'transient'], [503, 'transient'], [400, 'rejected']])('classifies %i', …)
it('honours Retry-After on 429', …)
it('reads hard and soft bounce reports', …)                             // erfundene NDR-Fixtures im Test
it('tells restricted, readable and unknown mailboxes apart', …)
it('never puts the secret into an error code or message', …)
```

- [ ] **Step 2: Tests laufen lassen.** `vp test run apps/web/src/server/sending/graph.test.ts` meldet FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** Tests PASS; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(sending): add graph transport`

---

### Task 4: Resend-Adapter und Webhook-Prüfung

**Files:**
- Create: `apps/web/src/server/sending/{resend,resend-webhook}.ts`
- Test: `apps/web/src/server/sending/{resend,resend-webhook}.test.ts`

**Interfaces:**
- Consumes: Task 2
- Produces:

```ts
// resend.ts
export function resendEndpoint(env: Pick<Env, 'devProvidersUrl'>): string   // Entscheidung 9
export interface ResendDeps { readonly fetch: typeof fetch; readonly endpoint: string; readonly now: () => Date }
export function createResendTransport(apiKey: string, deps: ResendDeps): Transport          // probe: null, fetchBounces: null
export function classifyResendResponse(status: number, body: unknown, headers: Headers, now: Date): SendResult
// resend-webhook.ts
export type ResendEvent =
  | { readonly id: string; readonly type: 'bounce'; readonly emailId: string; readonly hard: boolean }
  | { readonly id: string; readonly type: 'complaint'; readonly emailId: string }
  | { readonly id: string; readonly type: 'other' }
export const WEBHOOK_MAX_BYTES = 65_536
export const WEBHOOK_TOLERANCE_MS = 300_000
export function verifyResendWebhook(secret: string, headers: Headers, body: string, now: Date): Promise<ResendEvent | null>   // null = Signatur/Zeit/Form falsch
```

**Regeln:**
- Senden mit `from` („Name <adresse>“), `to`, `bcc` (nur `regular`), `reply_to`, `subject`, `html`, `text`, `headers` (`List-Unsubscribe`, `List-Unsubscribe-Post`, `Message-ID`), `attachments` (Base64) und Kopfzeile `Idempotency-Key`. Antwort-`id` → `providerId`.
- Fehlerklassen nach Entscheidung 9. Signaturvergleich in konstanter Zeit (`secretsMatch`).

- [ ] **Step 1: Failing Tests schreiben**

```ts
// resend.test.ts
it('sends with an idempotency key and the unsubscribe headers', …)
it('adds the archive copy for regular mail only', …)
it.each([['daily_quota_exceeded', 'quota'], ['monthly_quota_exceeded', 'quota'], ['rate_limit_exceeded', 'transient'], [401, 'unauthorized'], ['validation_error', 'rejected']])('classifies %s', …)
// resend-webhook.test.ts
it('accepts a correctly signed bounce and reads hard and soft', …)
it('accepts any of several signatures', …)
it('refuses a wrong signature, an old timestamp and a body over 64 KiB', …)
it('maps unknown event types to other', …)
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** PASS; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(sending): add resend transport`

---

### Task 5: Nachbau-Server für Graph und Resend

**Files:**
- Create: `apps/web/e2e/fakes/providers.ts`, `apps/web/e2e/fakes/providers.test.ts`, `apps/web/e2e/helpers/providers.ts`
- Modify: `apps/web/playwright.config.ts` (zweiter `webServer`, Port 3200), `apps/web/package.json` (`dev:providers`), `apps/web/vite.config.ts` (Test-`include` deckt `e2e/fakes/*.test.ts` ab, falls nötig)

**Interfaces:**
- Consumes: Task 3 und 4 (der Test spricht den Nachbau mit den echten Adaptern an)
- Produces:

```ts
// e2e/fakes/providers.ts
export interface FakeProvidersOptions { readonly port: number; readonly deliver: (mime: string, envelope: Readonly<{ from: string; to: string[] }>) => Promise<void> }
export function startFakeProviders(options: FakeProvidersOptions): Promise<{ url: string; close: () => Promise<void> }>
// Endpunkte: POST /login/:tenant/oauth2/v2.0/token · POST /graph/v1.0/users/:mailbox/sendMail (MIME oder JSON)
//   GET /graph/v1.0/users/:mailbox/mailFolders/inbox/messages · GET /graph/v1.0/users/:mailbox/messages
//   POST /resend/emails · POST /__control/reset · GET /__control/requests
//   POST /__control/graph/ndr { mailbox, originalMessageId, hard } · POST /__control/resend/webhook { appUrl, connectionId, secret, emailId, type, hard }
//   POST /__control/senders { mailboxes }   (Postfächer, die lesbar sind; Entscheidung 11)
// e2e/helpers/providers.ts
export function resetProviders(): Promise<void>
export function addNdr(input: Readonly<{ mailbox: string; originalMessageId: string; hard: boolean }>): Promise<void>
export function sendResendWebhook(input: …): Promise<number>   // HTTP-Status der App
export function recordedRequests(): Promise<readonly { method: string; path: string }[]>
```

**Regeln:**
- Läuft nur in Entwicklung und Tests; liegt unter `e2e/`, nie im App-Bundle.
- Antwortet wie die Anbieter (Statuscodes, JSON-Formen der Adapter-Tests). Secret `wrong-secret` → 401. JSON-`sendMail` ohne `saveToSentItems: false` merkt er sich als „abgelegt“ (für einen Test in Task 8).
- Idempotenz bei Resend: gleicher `Idempotency-Key` → keine zweite Zustellung.
- Zustellung über `nodemailer` an `localhost:1025` (Mailpit); MIME wird roh weitergereicht, JSON wird zu einfacher MIME.

- [ ] **Step 1: Failing Tests schreiben** (`providers.test.ts`, Zustellung in eine Liste statt an Mailpit)

```ts
it('delivers a mime mail sent through the real graph transport', …)
it('refuses wrong-secret with 401', …)
it('lists an injected bounce report that parseNdr reads', …)
it('answers 403 for mailboxes that are not senders', …)
it('drops a second resend mail with the same idempotency key', …)
it('signs a webhook that verifyResendWebhook accepts', …)
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.** `playwright.config.ts` startet `node e2e/fakes/providers.ts` (Node 26 führt TypeScript ohne Typ-Syntax-Erweiterungen direkt aus; sonst wie `migrate-cli.ts` mit `tsx`) mit `url: 'http://localhost:3200/__control/requests'`.
- [ ] **Step 4: Prüfen.** Tests PASS; `vp run --filter web e2e` bleibt grün; `vp check` 0/0.
- [ ] **Step 5: Commit** – `test(sending): add fake graph and resend servers`

---

### Task 6: Anbindungen und Absender

**Files:**
- Create:
  - `apps/web/src/server/db/schema/sending.ts` (`mail_connections`, `senders`, `sender_areas`)
  - `apps/web/src/server/sending/{connections,senders,errors,failures,open-transport}.ts`
  - `apps/web/src/functions/sending.ts`
  - `apps/web/src/routes/admin/sending/{index,connections.new,connections.$connectionId,senders.new,senders.$senderId}.tsx`
  - `apps/web/src/components/admin/sending/{connection-form,sender-form,self-test-result,delete-sending-dialog}.tsx`
- Modify: `apps/web/src/server/db/schema/index.ts`, `apps/web/src/server/audit/audit.ts`, `apps/web/src/components/admin-nav.tsx` („Versand“), `apps/web/src/i18n/{de,en}.ts`, Migration (erzeugt)
- Test: `apps/web/src/server/sending/{connections,senders,open-transport}.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4, `assertAdmin`, `writeAudit`, `normalizeEmail`, `deriveSecretsKey`
- Produces:

```ts
// server/sending/connections.ts
export type ConnectionKind = 'graph' | 'resend'
export type ConnectionInput =
  | { kind: 'graph'; name: string; tenantId: string; clientId: string; clientSecret: string | null; secretExpiresOn: string }   // null = unverändert
  | { kind: 'resend'; name: string; apiKey: string | null; webhookSecret: string | null; perMinute: number; dailyLimit: number | null }
export interface ConnectionSummary { id: string; kind: ConnectionKind; name: string; secretExpiresOn: string | null; disturbedSince: Date | null;
  restriction: RestrictionResult | null; perMinute: number | null; dailyLimit: number | null; senders: number; version: number }
export function listConnections(db: Db, actor: Principal): Promise<ConnectionSummary[]>
export function createConnection(db: Db, actor: Principal, input: ConnectionInput, key: CryptoKey): Promise<{ id: string }>
export function updateConnection(db: Db, actor: Principal, id: string, input: ConnectionInput, version: number, key: CryptoKey): Promise<{ version: number }>
export function deleteConnection(db: Db, actor: Principal, id: string): Promise<void>              // ConnectionInUseError
// server/sending/senders.ts
export interface SenderInput { email: string; displayName: string; replyTo: string | null; connectionId: string;
  perMinute: number | null; dailyLimit: number | null; archiveBcc: string | null; areaIds: readonly string[] }   // perMinute/dailyLimit nur Graph, archiveBcc nur Resend
export interface SenderSummary extends SenderInput { id: string; connectionKind: ConnectionKind; isSystem: boolean; version: number }
export function listSenders(db: Db, actor: Principal): Promise<SenderSummary[]>
export function createSender(db: Db, actor: Principal, input: SenderInput): Promise<{ id: string }>
export function updateSender(db: Db, actor: Principal, id: string, input: SenderInput, version: number): Promise<{ version: number }>
export function deleteSender(db: Db, actor: Principal, id: string): Promise<void>                  // SenderInUseError
export function setSystemSender(db: Db, actor: Principal, senderId: string | null): Promise<void>
export function sendersForArea(db: Db, areaId: string): Promise<{ id: string; email: string; displayName: string }[]>   // für 4b
// server/sending/open-transport.ts
export type QuotaScope = `sender:${string}` | `connection:${string}`
export interface SenderTransport { readonly transport: Transport; readonly sender: SenderSummary; readonly scope: QuotaScope;
  readonly perMinute: number; readonly dailyLimit: number | null; readonly connectionId: string }
export function openSenderTransport(db: Db, env: Env, senderId: string, deps: Readonly<{ fetch: typeof fetch; now: () => Date }>): Promise<SenderTransport>
export interface SelfTestResult { token: 'ok' | 'failed'; testMail: 'sent' | 'failed'; restriction: RestrictionResult | null }
export function runSelfTest(db: Db, env: Env, actor: Principal, senderId: string, probeMailbox: string | null, deps): Promise<SelfTestResult>
// server/sending/errors.ts
export class ConnectionNotFoundError, ConnectionChangedError, ConnectionInUseError (senders: number),
  SenderNotFoundError, SenderChangedError, SenderEmailTakenError, SenderInUseError (reason: 'occasions' | 'entries'), SenderAreaInUseError (occasions: string[])
```

**Schema:**
- **`mail_connections`:** `id uuid pk`, `kind` (check), `name` (unique, case-insensitiv), `tenant_id`, `client_id`, `secret_ciphertext text not null` (Graph-Secret bzw. Resend-Key), `webhook_secret_ciphertext text null`, `secret_expires_on date null`, `per_minute int null`, `daily_limit int null`, `disturbed_since timestamptz null`, `disturbed_code text null`, `restriction text null`, `restriction_checked_at`, `version`, erstellt/geändert von und am. AAD = `secretAad('mail_connections', id, '<spalte>')`.
- **`senders`:** `id uuid pk`, `email` unique, `display_name`, `reply_to`, `connection_id → mail_connections on delete restrict`, `per_minute`, `daily_limit`, `archive_bcc`, `is_system boolean not null default false` mit partiellem Unique-Index `where is_system`, `version`, erstellt/geändert.
- **`sender_areas`:** `(sender_id → senders cascade, area_id → areas cascade)` als Primärschlüssel.

**Regeln:**
- Alles nur Admin. Zugangsdaten verlassen den Server nie; Formulare zeigen „gespeichert“ und ein leeres Feld (leer = unverändert).
- Ein Absender lässt sich nicht löschen, solange ein Anlass ihn nutzt (ab Task 12) oder (ab Task 7) Einträge `planned`, `sending` oder `uncertain` an ihm hängen; gesendete Einträge behalten ihre Daten (`sender_id` wird `null`, Task 7).
- Graph-Absender: `perMinute` Standard 30. Resend-Absender erben Drosselung und Limit der Anbindung (Design 6.2).
- Neue Zugangsdaten setzen `disturbed_since` zurück, wenn der Selbsttest das Token bekommt.
- Selbsttest (Design 6.1): Token → Testmail an `principal`-Adresse (Systemmail-Art `regular`, Betreff aus i18n) → Beschränkungstest mit `probeMailbox` (vorbelegt mit der Adresse des Admins). Ergebnis an der Anbindung speichern; Protokoll `sender.self_tested` mit Ergebnis ohne Adressen.
- Protokoll: `connection.created|updated|deleted`, `sender.created|updated|deleted`, `sender.system_set`, `sender.self_tested`.
- Seite `/admin/sending`: Anbindungen (Art, Name, Zustand: in Ordnung / gestört / Secret läuft in N Tagen ab / Beschränkung lesbar), Absender (Adresse, Anbindung, Bereiche, „Systemabsender“). Zahlen des Postausgangs kommen in Task 10 dazu.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// connections.test.ts
it('lets only admins manage connections', …)
it('stores secrets encrypted and never returns them', …)       // Zeile enthält 'v2.'; listConnections ohne Secret-Feld
it('keeps the secret when the field is empty', …)
it('refuses deleting a connection with senders', …)
it('refuses a stale version', …)
// senders.test.ts
it('releases a sender to areas and lists it per area', …)
it('keeps exactly one system sender', …)                       // zweiter setSystemSender ersetzt den ersten
it('refuses a second sender with the same address, case-insensitive', …)
it('ignores perMinute and dailyLimit for resend senders', …)
// open-transport.test.ts
it('opens a graph transport with scope sender:<id> and a resend transport with scope connection:<id>', …)
it('runs the self test and stores the restriction result', …)  // gegen fetch-Attrappe: 403 → restricted, 200 → readable
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.** `vp run --filter web db:generate`.
- [ ] **Step 4: Prüfen.** Tests PASS; `vp check` 0/0. Die Seiten zeigt erst Task 11 im E2E; hier genügt `vp dev` von Hand.
- [ ] **Step 5: Commit** – `feat(sending): add connections and senders`

---

### Task 7: Postausgang

**Files:**
- Create:
  - Schema in `apps/web/src/server/db/schema/sending.ts` (Ergänzung: `outbox_entries`, `send_quota_days`)
  - `apps/web/src/server/sending/{quota,outbox,outbox-step}.ts`
- Modify: `apps/web/src/server/tick/{tick,steps}.ts` (`storage` im `TickContext`, Schritt `outbox`), `apps/web/src/server/sending/senders.ts` (`deleteSender` lehnt bei offenen Einträgen ab: `SenderInUseError('entries')`), `apps/web/src/routes/api/tick.ts`, `apps/web/src/platform/{node-server,cloudflare-scheduled,cloudflare-worker}.ts`, Migration (erzeugt)
- Test: `apps/web/src/server/sending/{quota,outbox,outbox-step}.test.ts`, `apps/web/src/server/sending/outbox.postgres.test.ts`, `apps/web/src/server/tick/tick.test.ts` (Ergänzung)

**Interfaces:**
- Consumes: Task 2, Task 6 (`openSenderTransport`, `QuotaScope`), `todayInClubZone`, `TickStep`
- Produces:

```ts
// server/sending/outbox.ts
export type EntryStatus = 'planned' | 'sending' | 'sent' | 'bounced' | 'failed' | 'skipped' | 'cancelled' | 'uncertain'
export type EntryPriority = 'personal' | 'group'
export const MAX_ATTEMPTS = 5
export const RETRY_DELAYS_MS = [300_000, 1_800_000, 7_200_000, 28_800_000] as const
export const UNCERTAIN_AFTER_MS = 600_000
export function nextAttemptDelay(attempts: number, retryAfterMs: number | null): number | null     // null = keine Versuche mehr
export interface ClaimedEntry { id: string; source: 'wave'; sourceId: string; senderId: string; priority: EntryPriority; attempts: number;
  messageId: string }   // beim ersten Übernehmen erzeugt und gespeichert, bei jedem weiteren Versuch dieselbe (Ruling R4)
export type PreparedMail =
  | { kind: 'send'; mail: OutgoingMail; recipient: string }
  | { kind: 'skip'; reason: string }          // z. B. 'suppressed', 'exited', 'optedOut', 'invalidEmail', 'gone', 'addressChanged'
  | { kind: 'fail'; code: string }            // z. B. 'missing:contact.firstName'
export interface EntryPreparer { readonly prepare: (db: Db, entry: Readonly<ClaimedEntry>, ctx: Readonly<{ now: Date; storage: ObjectStorage | null; env: Env }>) => Promise<PreparedMail> }
export function markUncertain(db: Db, now: Date): Promise<number>
// server/sending/quota.ts
export interface QuotaState { used: number; limit: number | null; reserved: number }
export function quotaToday(db: Db, scope: QuotaScope, now: Date): Promise<QuotaState>
export function mayStart(state: QuotaState, priority: EntryPriority): boolean                         // rein
export function countSent(db: Db, scope: QuotaScope, now: Date): Promise<void>
export function estimateDays(input: Readonly<{ mails: number; limit: number | null; usedToday: number; reservedPerDay: number }>): number   // rein, für 4b
// server/sending/outbox-step.ts
export interface OutboxDeps { readonly preparers: Readonly<Record<ClaimedEntry['source'], EntryPreparer>>; readonly fetch: typeof fetch;
  readonly sleep: (ms: number) => Promise<void> }
export function createOutboxStep(deps: Readonly<OutboxDeps>): TickStep
export function kickOutbox(platform: Platform, run: () => Promise<unknown>): void                      // „sofort“: kurzer Lauf in waitUntil
// server/tick/tick.ts (Änderung)
interface TickContext { /* … */ readonly storage: ObjectStorage | null }
```

**Schema:**
- **`outbox_entries`:** `id uuid pk`, `source text` (check `'wave'`), `source_id uuid`, `sender_id uuid null → senders on delete set null` (Löschsperre für offene Einträge in `deleteSender`), `priority` (check), `status` (check, Index `(status, not_before)`), `not_before timestamptz`, `attempts int`, `next_attempt_at`, `claimed_at`, `last_error_code text`, `message_id text` (unique), `provider_id text` (Index), `recipient text null` (beim Senden genutzte Adresse), `sent_at`, `created_at`. 4b ergänzt `wave_id`.
- **`send_quota_days`:** Entscheidung 4.

**Regeln:**
- Der Schritt: `markUncertain`, dann für jeden Absender mit fälligen Einträgen (gestörte Anbindungen ausgenommen, außer dem Prüfversuch aus Entscheidung 9) Einträge übernehmen (`update … set status='sending', claimed_at=now() where id in (select … for update skip locked limit n) returning`), vorbereiten, senden, Ergebnis speichern.
- Ergebnis: `ok` → `sent`, `countSent`, `message_id`/`provider_id`; `uncertain` → sofort `uncertain` (nie automatisch erneut, Design 8.5); `transient` → `planned` mit `next_attempt_at` oder `failed` nach `MAX_ATTEMPTS`; `rejected` → `failed`; `unauthorized` → zurück auf `planned` ohne Versuch, Anbindung `disturbed_since` setzen; `quota` → zurück auf `planned` ohne Versuch, der Bereich pausiert bis `jetzt + max(retryAfterMs, 1 h)`; danach prüft genau ein Eintrag, ob der Anbieter wieder annimmt (Ruling R5; Resend zählt gleitend über 24 Stunden).
- Vorrang und Reserve nach Entscheidung 5; Drosselung nach Entscheidung 6; Grenze der Unteranfragen: höchstens 40 Sendungen pro Lauf und Absender auf Cloudflare (`platformName() === 'cloudflare'`), sonst durch Budget und Drosselung begrenzt.
- `moreWork`, solange fällige Einträge übrig sind, die nicht am Limit oder an einer Störung hängen.
- `tickSteps` = `[pruneAuthRecords, staleImportWarning, outbox]`; in 4a ist `preparers` leer (keine Quelle), Task 16 setzt `wave`.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// quota.test.ts
it('counts per scope and club day', …)                         // 23:59 und 00:01 Europe/Berlin zählen in verschiedene Tage
it('starts a new day correctly in the night of the clock change', …)   // 2027-03-28 und 2027-10-31
it('reserves capacity for personal mail due today', …)          // limit 10, used 6, reserved 4 → group false, personal true
it('estimates the days of a wave', …)                          // 250 Mails, Limit 100, 20 reserviert/Tag → 4
// outbox-step.test.ts (Preparer- und Transport-Attrappen, PGlite)
it('sends due entries and stores message id and provider id', …)
it('throttles to perMinute per scope', …)                       // 31 Einträge, perMinute 30 → ein sleep(…) vor der 31.
it('sends personal before group and keeps the reserve', …)
it('retries transient failures with growing delays and fails after five attempts', …)
it('fails rejected recipients at once', …)
it('marks a disturbed connection and keeps its entries without spending attempts', …)
it('moves entries to the next day on a quota refusal', …)
it('marks entries stuck in sending for ten minutes as uncertain and never resends them', …)
it('records skip and fail from the preparer', …)
// outbox.postgres.test.ts (describe.skipIf ohne TEST_POSTGRES_URL)
it('never hands one entry to two concurrent runs', …)           // zwei Läufe parallel, 50 Einträge → jede Message-ID genau einmal gesendet
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.** `vp run --filter web db:generate`. `runTick`-Aufrufer reichen `storage` durch (Entscheidung 13).
- [ ] **Step 4: Prüfen.** Tests PASS, mit `TEST_POSTGRES_URL` ebenso; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(sending): add the outbox`

---

### Task 8: Systemmails über den echten Absender

**Files:**
- Create: `apps/web/src/server/sending/{system-mail,system-mailer}.ts`
- Modify:
  - `apps/web/src/server/mail/system-mailer.ts` (wird zur Fassade auf `server/sending/system-mailer.ts`; `SystemMail` neu), `apps/web/src/server/mail/testing.ts`
  - `apps/web/src/platform/context.ts` (Mailer pro DB, Entscheidung 12)
  - Aufrufer: `apps/web/src/server/auth/auth.ts` (`sendLoginLink`), `apps/web/src/server/users/users.ts` (`sendInvitation`), `apps/web/src/server/contacts/stale-import.ts` (`sendWarning`, Schritt bekommt den Mailer aus `ctx`)
  - `apps/web/src/server/frame.ts` und `apps/web/src/routes/admin/index.tsx` (Hinweis „Noch kein Absender für Systemmails“ für Admins)
  - `apps/web/src/i18n/{de,en}.ts` (`mail.system.*`: Überschrift, Absätze, Button für Anmeldelink, Einladung, Warnungen)
- Test: `apps/web/src/server/sending/{system-mail,system-mailer}.test.ts`, bestehende Tests von `auth`, `users`, `stale-import`, `frame`

**Interfaces:**
- Consumes: Task 2, 3, 4, 6, 7 (`countSent`), `compileMail`, `getBrand`, Blocks aus Teilplan 3
- Produces:

```ts
// server/sending/system-mail.ts
export interface SystemMailContent { readonly heading: string; readonly paragraphs: readonly string[]; readonly button: Readonly<{ label: string; url: string }> | null }
export function composeSystemMail(content: SystemMailContent, subject: string, brand: Readonly<BrandState>, appOrigin: string, locale: Locale):
  Promise<{ html: string; text: string; layout: 'brand' | 'plain' }>      // CD-Standard-Layout, sonst schlicht
// server/mail/system-mailer.ts (neu)
export interface SystemMail { readonly to: string; readonly locale: Locale; readonly subject: string; readonly content: SystemMailContent }
export interface SystemMailer { readonly send: (mail: Readonly<SystemMail>) => Promise<void> }
export function createSystemMailer(deps: Readonly<{ env: Env; db: Db; fetch?: typeof fetch; now?: () => Date }>): SystemMailer
export function hasSystemSender(db: Db): Promise<boolean>
```

**Regeln:**
- Systemabsender gesetzt → `openSenderTransport`, Mail `kind: 'system'` (Graph JSON ohne Ablage, Resend ohne Archiv-Kopie), `countSent`, kein Postausgang. Ein Fehler wirft weiter (die Aufrufer protokollieren ihn wie bisher über `errorLabel`).
- Kein Systemabsender: `DEV_SMTP_URL` auf dem Node-Pfad (wie bisher, nun mit HTML aus `composeSystemMail`), sonst `MailerNotConfiguredError`.
- `composeSystemMail` rendert Überschrift, Absätze und Button als Bausteine des Standard-Layouts mit `locale` (die festen Texte des Layouts liegen schon zweisprachig vor). Globale Layouts gelten nicht. Bei `missingBrand`, `invalid` oder Ausnahme: schlichte Fassung (Text und einfaches HTML ohne CD).
- Der Link (Anmeldelink, Einladung) steht in den Bausteinen als fertige URL, nicht als Platzhalter.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// system-mail.test.ts
it('renders a system mail in the brand layout in the given language', …)   // en: englische Layout-Texte
it('falls back to the plain mail when a required brand value is missing', …)
it('escapes the link and the texts', …)
// system-mailer.test.ts (PGlite, fetch-Attrappe)
it('sends through the system sender as json without saving and counts it', …)
it('uses DEV_SMTP_URL when no system sender exists', …)    // SMTP-Attrappe
it('throws MailerNotConfiguredError without system sender and smtp', …)
// frame.test.ts
it('tells admins that no system sender is set', …)
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.** Die Stellen, die heute `mailer.send({ subject, text })` aufrufen, bauen `content` aus den neuen i18n-Schlüsseln.
- [ ] **Step 4: Prüfen.** Tests PASS (auch die bestehenden von `auth`, `users`, `stale-import`); `vp run --filter web e2e` grün (Anmeldelinks gehen ohne Systemabsender weiter über `DEV_SMTP_URL`); `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(sending): send system mails through the sender`

---

### Task 9: Anmeldelinks und Einladungen

**Files:**
- Create: `apps/web/src/routes/login_.confirm.tsx`, `apps/web/src/server/auth/login-link-days.ts`
- Modify:
  - Schema `apps/web/src/server/db/schema/auth.ts` (`login_link_days`; `user.invitation_sent_at`, `user.invitation_failed`), Migration (erzeugt)
  - `apps/web/src/server/auth/auth.ts` (Tageslimit, Link auf `/login/confirm?token=…`), `apps/web/src/server/auth/prune.ts` (alte Tageszähler löschen)
  - `apps/web/src/server/users/users.ts` (`resendInvitation`, Fehlschlag merken), `apps/web/src/functions/users.ts`, `apps/web/src/components/admin/users-table.tsx`
  - `apps/web/src/server/audit/audit.ts` (`'user.invitation_resent'`), `apps/web/src/i18n/{de,en}.ts`
  - `apps/web/e2e/helpers/sign-in.ts` (folgt dem Link und klickt „Anmelden“)
- Test: `apps/web/src/server/auth/{auth,login-link-days}.test.ts`, `apps/web/src/server/users/users.test.ts` (Ergänzungen)

**Interfaces:**
- Consumes: Task 8, `verifyLoginLink`, `forwardSetCookie`, `hashLoginWindowEmail`
- Produces:

```ts
// server/auth/login-link-days.ts
export const LOGIN_LINKS_PER_DAY = 10
export function takeLoginLinkOfDay(db: Db, emailHash: string, now: Date): Promise<boolean>   // atomar; false ab dem 11. am Club-Tag
// server/users/users.ts
export function resendInvitation(deps: InviteDeps, actor: Principal, userId: string): Promise<{ mailSent: boolean } | { refused: 'notInvited' | 'tooSoon' }>
// functions/auth (Route-Datei): confirmLoginLink  // POST { token } → verifyLoginLink → Cookies → redirect({ reloadDocument: true, to: AFTER_SIGN_IN_PATH })
```

**Regeln:**
- `createLinkSender` prüft Fenster (60 s) **und** Tageslimit in derselben Reihenfolge für jede Adresse (bekannt oder nicht), damit Antwortzeit und Ergebnis nichts verraten.
- Die Mail verlinkt `/login/confirm?token=…`. Die Seite zeigt nur „Anmelden“ (PostForm); erst das Absenden prüft und verbraucht das Token. Ungültig oder abgelaufen → Weiterleitung nach `/login?error=…` mit der bestehenden Fehleranzeige.
- `inviteUser` setzt `invitation_sent_at` und `invitation_failed`. `resendInvitation`: Admin, Status `invited`, frühestens 60 s nach `invitation_sent_at`; Protokoll `user.invitation_resent`.
- Die Benutzerliste zeigt „Einladung nicht verschickt“ bei `invitation_failed` und den Knopf „Einladung erneut senden“ bei Status `invited`.

- [ ] **Step 1: Failing Tests schreiben**

```ts
it('sends at most ten login links per address and club day', …)
it('counts unknown addresses the same way', …)
it('links to the confirmation page instead of the verify endpoint', …)
it('remembers a failed invitation and resends it at most once a minute', …)
it('refuses to resend an invitation to an active user', …)
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.** `vp run --filter web db:generate`.
- [ ] **Step 4: Prüfen.** Tests PASS; E2E `fundament` und alle anderen grün mit dem neuen `signIn`; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(auth): confirm login links and resend invites`

---

### Task 10: Warnungen und Zustand der Absender

**Files:**
- Create: `apps/web/src/server/sending/warnings.ts`
- Modify: `apps/web/src/server/tick/steps.ts` (Schritt `sendingWarnings`), `apps/web/src/server/system-state.ts` (neue `StateKey`s), `apps/web/src/server/frame.ts` (Hinweis Secret-Ablauf und Störung für Admins), `apps/web/src/routes/admin/sending/index.tsx` (Zahlen und Kontingent), `apps/web/src/server/sending/connections.ts` (`sendingOverview`), `apps/web/src/server/contacts/stale-import.ts` (Nacharbeit), `apps/web/src/i18n/{de,en}.ts`
- Test: `apps/web/src/server/sending/warnings.test.ts`, `apps/web/src/server/contacts/stale-import.test.ts` (Ergänzung), `apps/web/src/server/contacts/stale-import.postgres.test.ts` (neu)

**Interfaces:**
- Produces:

```ts
export const SECRET_WARNING_DAYS = [30, 14, 7, 1] as const
export function secretWarningStage(expiresOn: string, today: string): (typeof SECRET_WARNING_DAYS)[number] | null   // rein
export const sendingWarnings: TickStep     // Secret-Stufen (je einmal), Störung (einmal pro Störung), Tageszusammenfassung (höchstens einmal pro Club-Tag)
export interface SendingOverview { connections: (ConnectionSummary & { daysToExpiry: number | null })[];
  senders: (SenderSummary & { quota: QuotaState; open: number; uncertain: number; failed: number })[] }
export function sendingOverview(db: Db, actor: Principal, now: Date): Promise<SendingOverview>   // ohne Empfänger
```

**Regeln:**
- Merker in `system_state` (`sending_secret_warned`: `{ [connectionId]: stage }`, `sending_disturbance_warned`: `{ [connectionId]: disturbedSince }`, `sending_digest_day`); Merker zuerst setzen, dann senden, dann protokollieren – wie die Warn-Mail bei alten Daten, aber mit der Nacharbeit aus Teilplan 2: Schlägt das Protokoll fehl, wird der Merker zurückgenommen.
- Empfänger: aktive Admins in ihrer Sprache; Inhalt nennt Anbindung, Zahlen pro Bereich und Absender, nie Empfänger.
- Ist der Systemabsender selbst gestört, gehen die Warnungen über `DEV_SMTP_URL` (lokal) oder gar nicht; die Oberfläche zeigt die Störung trotzdem.

- [ ] **Step 1: Failing Tests schreiben**

```ts
it.each([['2026-12-25', '2026-11-25', 30], ['2026-12-02', '2026-11-25', 7], ['2026-12-31', '2026-11-25', null]])('stage for %s on %s', …)
it('warns each stage once', …)
it('warns once per disturbance and again after a new one', …)
it('sends at most one digest per club day and only with new failed or uncertain entries', …)
it('takes the claimed week back when the audit entry fails', …)     // stale-import, Nacharbeit
// stale-import.postgres.test.ts
it('sends the stale warning once when one of two mails fails', …)  // Nacharbeit aus Teilplan 2
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** Tests PASS; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(sending): warn admins about senders`

---

### Task 11: E2E, Doku, Changeset und Abschluss 4a

**Files:**
- Create: `apps/web/e2e/sending.e2e.ts`, `apps/web/e2e/helpers/tick.ts`, `.changeset/add-sending-foundation.md`
- Modify: `apps/web/playwright.config.ts` (Projekt `sending`, hängt von `templates` ab), `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/superpowers/plans/2026-11-23-vereinsbote-00-fahrplan.md` (Punkte aus Teilplan 1 erledigt)

**E2E (`sending`, gegen Nachbau-Server und Mailpit):**

```ts
test('an admin connects graph, adds a sender and makes it the system sender', …)   // Selbsttest: Beschränkung wirkt; Mail in Mailpit; axe auf allen /admin/sending-Seiten
test('a login link comes through graph and signs in only after confirming', …)    // GET der Bestätigungsseite meldet nicht an; Klick auf „Anmelden“ schon
test('the system mail is not saved in sent items', …)                            // recordedRequests: JSON mit saveToSentItems false
test('a disturbed connection shows up and recovers with a new secret', …)        // Secret wrong-secret, Tick, Hinweis; neues Secret, Selbsttest, Hinweis weg
test('an admin resends a failed invitation', …)
test('a secret about to expire is shown to admins', …)                          // Ablaufdatum in 10 Tagen
```

**Doku:**
- `README.md`: Abschnitt „Sending“ (Anbindungen, Absender, Systemabsender, Tageslimit, Drosselung), `DEV_PROVIDERS_URL` und Nachbau-Server (`vp run --filter web dev:providers`), neue Tabellen in der Betriebsübersicht.
- `AGENTS.md`: Mails gehen nur über `Transport`/`openSenderTransport`, nie direkt an einen Anbieter; Systemmails nur über `createSystemMailer`; Zugangsdaten nur mit `encryptSecret(…, secretAad(…))`; `DEV_PROVIDERS_URL` nur lokal; neuer E2E-Projektname `sending` und Tick-Helfer; Postausgang: ein Eintrag wird nie automatisch erneut gesendet, wenn er „unklar“ ist.
- `CONTRIBUTING.md`: Nachbau-Server starten; keine echten Konten in Tests.

**Changeset** (`web`, `minor`):

```md
---
'web': minor
---

Add sending foundations: connections to Microsoft Graph and Resend with encrypted credentials, senders released per area, an outbox with throttling, daily limits, priority and retries, system mails through the club's own sender in its brand layout, a confirmation step for login links, resending invitations, and warnings about expiring secrets and disturbed connections.
```

- [ ] **Step 1: E2E schreiben**, laufen lassen (FAIL, solange Teile fehlen), Lücken schließen.
- [ ] **Step 2: Gesamtprüfung.** `vp check` 0/0; `vp test` grün, mit `TEST_POSTGRES_URL` und `TEST_S3_URL` ebenso; `vp run --filter web e2e` grün (alle Projekte, keine CSP-Verletzung); `build:node`, `build:vercel`, `build:cloudflare` laufen, die Bundle-Checks sind sauber (kein `nodemailer` im Cloudflare-Bundle); `pnpm check:catalog`, `pnpm check:vite-plus`, `pnpm cve` enden mit 0; `pnpm exec changeset status --since=origin/main` nennt `web` `minor`.
- [ ] **Step 3: Commit** – `docs(sending): document the sending foundations`

---

# Teil 4b – Anlass und manueller Versand (`feat/occasions`)

### Task 12: Anlässe

**Files:**
- Create:
  - Schema `apps/web/src/server/db/schema/occasions.ts` (`occasions`)
  - `apps/web/src/server/occasions/{occasions,errors,failures}.ts`, `apps/web/src/functions/occasions.ts`
  - `apps/web/src/routes/occasions/{route,index,new,$occasionId}.tsx`, `apps/web/src/components/occasions/{occasion-form,occasion-table,delete-occasion-dialog}.tsx`
- Modify:
  - `apps/web/src/server/db/schema/contacts.ts` (FK `contact_opt_outs.occasion_id → occasions(id) on delete cascade`, Unique-Index `(kind, contact_key, occasion_id) where scope = 'occasion'`)
  - `apps/web/src/server/templates/templates.ts` und `apps/web/src/server/templates/{errors,failures}.ts` (`TemplateInUseError` mit Anlass-Namen; `deleteTemplate` fängt die FK-Verletzung)
  - `apps/web/src/server/sending/senders.ts` (`SenderAreaInUseError`, `SenderInUseError('occasions')`)
  - `apps/web/src/server/frame.ts`, `apps/web/src/components/main-nav.tsx` („Anlässe“), `apps/web/src/server/audit/audit.ts`, `apps/web/src/i18n/{de,en}.ts`, Migration (erzeugt)
- Test: `apps/web/src/server/occasions/occasions.test.ts`, `apps/web/src/server/templates/templates.test.ts`, `apps/web/src/server/sending/senders.test.ts` (Ergänzungen)

**Interfaces:**
- Consumes: Task 6 (`sendersForArea`), Teilplan 3 (`getTemplate`, `listTemplates`)
- Produces:

```ts
export type OccasionKind = 'personal' | 'circular'
export interface OccasionInput { name: string; kind: OccasionKind; templateId: string; senderId: string; unsubscribe: boolean }
export interface OccasionRecord extends OccasionInput { id: string; areaId: string; trigger: 'manual'; archivedAt: Date | null; waves: number; version: number }
export function listOccasions(db: Db, actor: Principal): Promise<OccasionRecord[]>                 // alle Bereiche mit read
export function getOccasion(db: Db, actor: Principal, id: string): Promise<OccasionRecord>
export function createOccasion(db: Db, actor: Principal, areaId: string, input: OccasionInput): Promise<{ id: string }>
export function updateOccasion(db: Db, actor: Principal, id: string, input: OccasionInput, version: number): Promise<{ version: number }>
export function removeOccasion(db: Db, actor: Principal, id: string, version: number): Promise<'deleted' | 'archived'>
export function defaultUnsubscribe(kind: OccasionKind): boolean                                     // circular → true
// server/occasions/errors.ts: OccasionNotFoundError, OccasionChangedError, OccasionNameTakenError, OccasionInvalidError (problem: 'templateArea' | 'senderNotReleased' | 'archived')
```

**Schema:** `occasions`: `id uuid pk`, `area_id → areas restrict`, `name` (unique pro Bereich, case-insensitiv), `kind` (check), `trigger text not null default 'manual'` (check `'manual'`; Teilplan 5 erweitert), `template_id → templates on delete restrict` (Constraint-Name für `TemplateInUseError`), `sender_id → senders on delete restrict`, `unsubscribe boolean`, `archived_at`, `version`, erstellt/geändert.

**Regeln:**
- Vorlage aus demselben Bereich; Absender dem Bereich freigegeben (`sender_areas`); beides beim Anlegen und Ändern geprüft.
- `removeOccasion`: ohne Wellen löschen, sonst `archived_at` setzen (Design 9). Archivierte Anlässe sind nicht wählbar und nicht änderbar.
- Freigabe eines Absenders für einen Bereich entfernen: abgelehnt, solange ein (auch archivierter) Anlass des Bereichs ihn nutzt.
- Protokoll: `occasion.created|updated|archived|deleted` (Ziel `occasion:<id>`, Details `{ areaId }`).
- Seiten: Liste pro Bereich (Name, Art, Vorlage, Absender, letzte Welle), Formular mit dem Satz „Ein Anlass steht für eine wiederkehrende Art von Mail …“ (Design 9).

- [ ] **Step 1: Failing Tests schreiben**

```ts
it('creates occasions with read, edit and send rights as in design 18', …)
it('presets the unsubscribe link by kind', …)
it('refuses a template of another area and a sender not released to the area', …)
it('archives an occasion with waves and deletes one without', …)
it('blocks deleting a template that an occasion uses', …)       // deleteTemplate → TemplateInUseError mit Anlass-Namen
it('blocks removing a sender release that an occasion uses', …)
it('links an occasion opt-out to a real occasion and removes it with the occasion', …)
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.** `vp run --filter web db:generate`.
- [ ] **Step 4: Prüfen.** Tests PASS; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(occasions): add occasions`

---

### Task 13: Mailquelle auf dem Server, Werte und Abmelde-Platzhalter

**Files:**
- Create: `apps/web/src/mail/templates/mail-source.ts`, `apps/web/src/server/templates/sending-values.ts`
- Modify:
  - `apps/web/src/components/editor/preview-source.ts` (nutzt `mail-source.ts`)
  - `apps/web/src/mail/placeholders/registry.ts` (`unsubscribe.url`), `apps/web/src/mail/render/{compile,standard-layout}.tsx|ts` (Option `unsubscribe`, Fußzeilen-Link, angehängte Zeile), `apps/web/src/server/html-import/{media-refs,placeholders}.ts` (`URL_SLOT_KEYS`), `apps/web/src/server/templates/allowed-placeholders.ts` (`unsubscribe.url` erlaubt in Vorlagen und Layouts)
  - `apps/web/src/i18n/{de,en}.ts` (`mail.layout.unsubscribe`, `mail.placeholder.unsubscribe.url`)
  - Snapshots `apps/web/src/mail/render/__snapshots__` (bewusst, `vp test -u`, Diff lesen)
- Test: `apps/web/src/mail/templates/mail-source.test.ts`, `apps/web/src/server/templates/sending-values.test.ts`, `apps/web/src/mail/render/compile.test.ts`, `apps/web/src/server/html-import/bypass.test.ts` (nur erweitern), `render.snapshot.test.tsx`

**Interfaces:**
- Produces:

```ts
// mail/templates/mail-source.ts (browser-sicher)
export interface LayoutHtml { readonly id: string; readonly html: string }
export function mailLayoutOf(layout: TemplateLayout, layouts: readonly LayoutHtml[]): MailLayout
export function mailSourceOf(input: TemplateInput, layouts: readonly LayoutHtml[], media: ReadonlyMap<string, MediaInfo>): MailSource
// server/templates/sending-values.ts
export function templateMailSource(db: Db, template: Readonly<TemplateRecord>, appOrigin: string): Promise<MailSource>   // Layouts und Bilder des Bereichs
export interface SendingValueContext { allowed: AllowedPlaceholders; customFields: Readonly<Record<ContactKind, readonly CustomFieldRecord[]>> }
export function sendingValueContext(db: Db, areaId: string): Promise<SendingValueContext>    // einmal pro Welle bzw. Lauf
export function sendingValues(ctx: Readonly<SendingValueContext>, contact: Readonly<ContactRecord>, salutation: SalutationTexts): Map<string, string>   // rein; nur deliveredByKind und allowed.keys
// mail/render/compile.ts (Änderung)
export function compileMail(source, brand, appOrigin, locale = DEFAULT_LOCALE, options: Readonly<{ unsubscribe: boolean }> = { unsubscribe: false }): Promise<CompileResult>
type CompileFailure = … | 'unsubscribe'
```

**Regeln:** Entscheidung 16 und 17. `unsubscribe.url` ist der einzige Nicht-CD-Schlüssel, der als ganzer `href` stehen darf; im Klick-Editor wird er nicht angeboten (das Standard-Layout setzt den Link selbst). Ein Wert für den Slot kommt nur vom Postausgang, nie aus Kontaktdaten.

- [ ] **Step 1: Failing Tests schreiben**

```ts
it('builds the same mail source on server and in the editor', …)
it('delivers only fields of the area and never asks for a user', …)   // Bereich ohne Geburtsdatum → Schlüssel fehlt
it('adds the unsubscribe link to the standard footer when asked', …)
it('appends an unsubscribe line to imported html without the placeholder', …)   // HTML vor </body>, Nur-Text am Ende
it('refuses {{unsubscribe.url}} when the occasion allows no link', …)         // invalid: 'unsubscribe'
it('allows {{unsubscribe.url}} only as a whole href without fallback', …)       // bypass.test.ts: '…{{unsubscribe.url}}/x', Ersatztext, in src, in CSS → abgelehnt
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.** Snapshots nur nach Lesen des Diffs aktualisieren.
- [ ] **Step 4: Prüfen.** Tests PASS; E2E `templates` grün (Editor-Vorschau unverändert); `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(mail): add unsubscribe placeholder and values`

---

### Task 14: Anhänge

**Files:**
- Create: Schema `apps/web/src/server/db/schema/attachments.ts`, `apps/web/src/server/attachments/{attachments,signature,cleanup}.ts`, Server-Funktionen in `apps/web/src/functions/waves.ts` (Hochladen, Entfernen)
- Modify: `apps/web/src/server/tick/steps.ts` (`attachmentCleanup`), Migration (erzeugt)
- Test: `apps/web/src/server/attachments/{attachments,signature,cleanup}.test.ts`

**Interfaces:**
- Produces:

```ts
export const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const
export const MAX_ATTACHMENT_BYTES = 4_194_304; export const MAX_ATTACHMENTS = 5; export const MAX_ATTACHMENTS_TOTAL = 20_971_520
export function sniffAttachmentType(bytes: Uint8Array): AttachmentType | null                     // %PDF-, FF D8 FF, 89 50 4E 47
export function safeFileName(name: string, type: AttachmentType): string                           // ohne Pfad, Steuerzeichen; Endung passend
export interface AttachmentRecord { id: string; areaId: string; waveId: string | null; name: string; type: AttachmentType; size: number }
export function storeAttachment(db: Db, storage: ObjectStorage, actor: Principal, occasionId: string, file: Readonly<{ name: string; bytes: Uint8Array }>): Promise<AttachmentRecord>   // send im Bereich
export function removeAttachment(db: Db, storage: ObjectStorage, actor: Principal, id: string): Promise<void>   // nur ohne Welle
export function readAttachments(storage: ObjectStorage, records: readonly AttachmentRecord[]): Promise<MailAttachment[]>
export const attachmentCleanup: TickStep                                                           // ohne Welle, älter als 1 Tag
```

**Schema:** `attachments`: `id text pk` (22 Zeichen base64url wie Bilder), `area_id → areas restrict`, `occasion_id → occasions cascade`, `wave_id null` (FK kommt in Task 15), `name`, `type` (check), `size`, `created_by`, `created_at`. Speicherschlüssel `attachments/<id>`.

- [ ] **Step 1: Failing Tests schreiben**

```ts
it.each([['%PDF-1.7…', 'application/pdf'], ['\xFF\xD8\xFF…', 'image/jpeg'], ['<html>', null]])('sniffs %s', …)
it('refuses a renamed html file even with a pdf name', …)
it('refuses files over 4 MiB, a sixth file and more than 20 MiB together', …)
it('cleans file names', …)          // '../Anmeldung "Süd".pdf' → 'Anmeldung Süd.pdf'
it('needs send in the area', …)
it('removes attachments without a wave after one day', …)
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.** `vp run --filter web db:generate`.
- [ ] **Step 4: Prüfen.** PASS; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(occasions): add attachments`

---

### Task 15: Welle anlegen

**Files:**
- Create: Schema `apps/web/src/server/db/schema/waves.ts` (`waves`, `wave_contacts`), Schema `apps/web/src/server/db/schema/bounces.ts` (nur `contact_bounces`; Task 19 ergänzt die übrigen Tabellen), `apps/web/src/server/bounces/bounces.ts` (nur `isEmailInvalid`), `apps/web/src/server/contacts/filters.ts`, `apps/web/src/server/waves/{recipients,merge,waves,errors,failures}.ts`
- Modify: `apps/web/src/server/contacts/contacts.ts` (nutzt `filters.ts`), Schema `outbox_entries.wave_id → waves cascade`, `attachments.wave_id → waves cascade`, `apps/web/src/functions/waves.ts`, `apps/web/src/server/audit/audit.ts`, Migration (erzeugt)
- Test: `apps/web/src/server/waves/{recipients,merge,waves}.test.ts`, `apps/web/src/server/waves/waves.postgres.test.ts`

**Interfaces:**
- Consumes: Task 7 (`quotaToday`, `estimateDays`), Task 12, 13, 14, `isMailable`, `loadContactAccess`, `compareCodePoints`, `todayInClubZone`
- Produces:

```ts
// server/waves/recipients.ts
export interface RecipientSelection { readonly kind: ContactKind | 'both'; readonly query: string; readonly filters: Pick<ContactFilters, 'group' | 'tag'>; readonly contactIds: readonly string[] | null }   // contactIds = Einzelauswahl
export type ExclusionReason = 'suppressed' | 'exited' | 'noEmail' | 'invalidEmail' | 'optedOutOccasion' | 'optedOutArea'
export interface ResolvedRecipients { mailable: ContactRecord[]; excluded: Record<ExclusionReason, number> }
export function resolveRecipients(db: Db, actor: Principal, occasion: Readonly<OccasionRecord>, selection: RecipientSelection, now: Date): Promise<ResolvedRecipients>
// server/waves/merge.ts (rein)
export interface PlannedMail { readonly address: string; readonly contacts: readonly ContactRecord[] }   // contacts[0] füllt die Mail
export function planMails(kind: OccasionKind, contacts: readonly ContactRecord[]): PlannedMail[]        // personal: je Kontakt; circular: je Adresse, Reihenfolge Design 11.2
// server/bounces/bounces.ts (nur dieses Stück; Task 19 ergänzt)
export function isEmailInvalid(db: Db, contact: Pick<ContactRecord, 'kind' | 'contactKey' | 'email'>): Promise<boolean>
// Schema contact_bounces: (kind, contact_key, email) Primärschlüssel, source, created_at, entry_id null
// server/waves/waves.ts
export interface WaveSummaryInput { occasionId: string; selection: RecipientSelection; attachmentIds: readonly string[] }
export interface WaveSummary { mails: number; merged: number; excluded: Record<ExclusionReason, number>; attachmentsBytes: number;
  estimatedDays: number; graphTooLarge: boolean; problem: 'compile' | 'missingBrand' | 'unsubscribe' | 'noRecipients' | null }
export function summarizeWave(db: Db, actor: Principal, input: WaveSummaryInput, appOrigin: string, now: Date): Promise<WaveSummary>
export function confirmWave(db: Db, actor: Principal, input: WaveSummaryInput & { requestId: string; notBefore: Date | null }, appOrigin: string, now: Date):
  Promise<{ waveId: string; mails: number } | { refused: NonNullable<WaveSummary['problem']> | 'graphTooLarge' | 'scheduleOutOfRange' }>
```

**Schema:**
- **`waves`:** `id uuid pk`, `occasion_id → occasions restrict`, `area_id`, `request_id uuid unique`, `kind` (Kopie der Art), `sender_id`, `unsubscribe boolean`, `compiled jsonb not null` (die kompilierte Fassung), `salutation_texts jsonb`, `template_id`, `template_version`, `not_before timestamptz`, `stopped_at`, `stopped_by`, `created_by`, `created_at`.
- **`wave_contacts`:** `(entry_id → outbox_entries cascade, position int)` Primärschlüssel, `contact_id uuid null` (kein FK: Kontakte werden durch Importe gelöscht), `contact_key`, `kind`, `email` (beim Bestätigen).

**Regeln:**
- `resolveRecipients` nutzt die Sicht des Benutzers (Teilplan 2: Filter auf geschützte Felder nur, wenn sichtbar) und `loadContactAccess` außerhalb der Transaktion.
- `confirmWave`: `send` im Bereich; Vorlage mit `compileMail(…, 'de', { unsubscribe: occasion.unsubscribe })` kompilieren; Problem → `refused`; `requestId` doppelt → dieselbe Welle zurück (Entscheidung 18); in einer Transaktion Welle, Einträge (`priority` aus der Art, `not_before`), `wave_contacts` und Verknüpfung der Anhänge; Protokoll `wave.created` (Ziel `wave:<id>`, Details `{ occasionId, mails }`). Bei Graph-Absender `graphTooLarge` prüfen (Design 6.4, mit `graphRequestBytes` einer Probe-Mail mit allen Anhängen).
- `notBefore`: `null` = sofort (danach `kickOutbox`), sonst nicht in der Vergangenheit und höchstens ein Jahr voraus.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// merge.test.ts
it('merges a circular per address with members before partners, then by number, then by id', …)
it('never merges personal occasions', …)
// recipients.test.ts
it.each(['suppressed', 'exited', 'noEmail', 'invalidEmail', 'optedOutOccasion', 'optedOutArea'])('counts %s as excluded', …)
it('filters protected fields only for users who see them', …)
// waves.test.ts
it('stores the compiled template, so later template changes do not touch the wave', …)
it('refuses a wave when a required brand value is missing, before any entry exists', …)
it('refuses a template with {{unsubscribe.url}} for an occasion without link', …)
it('returns the same wave for the same request id', …)
it('refuses attachments too large for graph', …)
it('estimates the days from the daily limit and the reserve', …)
it('needs send in the area', …)
// waves.postgres.test.ts
it('creates one wave for two concurrent confirmations with the same request id', …)
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.** `vp run --filter web db:generate`.
- [ ] **Step 4: Prüfen.** PASS, auch mit `TEST_POSTGRES_URL`; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(occasions): create waves`

---

### Task 16: Welle versenden und stoppen

**Files:**
- Create: `apps/web/src/server/waves/{preparer,stop}.ts`, `apps/web/src/server/unsubscribe/{token,url}.ts`
- Modify: `apps/web/src/server/tick/steps.ts` (`preparers: { wave: wavePreparer }`), `apps/web/src/functions/waves.ts` (`stopWave`, `resendUncertain`), `apps/web/src/server/audit/audit.ts` (`'wave.stopped'`, `'wave.entry_resent'`)
- Test: `apps/web/src/server/waves/{preparer,stop}.test.ts`, `apps/web/src/server/unsubscribe/token.test.ts`

**Interfaces:**
- Consumes: Task 7 (`EntryPreparer`, `PreparedMail`), Task 13 (`sendingValues`, `sendingValueContext`), Task 14 (`readAttachments`)
- Produces:

```ts
export const wavePreparer: EntryPreparer
// server/unsubscribe/token.ts
export interface UnsubscribePayload { contacts: readonly { kind: ContactKind; key: string }[]; occasionId: string; areaId: string }
export function deriveUnsubscribeKey(appSecret: Uint8Array): Promise<CryptoKey>                 // HKDF info 'vereinsbote:unsubscribe:v1'
export function sealUnsubscribe(key: CryptoKey, payload: Readonly<UnsubscribePayload>): Promise<string>   // AES-GCM, AAD 'unsubscribe', base64url
export function openUnsubscribe(key: CryptoKey, token: string): Promise<UnsubscribePayload | null>
// server/unsubscribe/url.ts
export function unsubscribeUrl(appUrl: URL, key: CryptoKey, payload: Readonly<UnsubscribePayload>): Promise<string>   // `${APP_URL}/unsubscribe/<token>`
// server/waves/stop.ts
export function stopWave(db: Db, actor: Principal, waveId: string): Promise<{ cancelled: number }>
export function resendUncertain(db: Db, actor: Principal, entryId: string): Promise<void>      // uncertain → planned, Protokoll
```

**Regeln (Design 11.3):**
- Pro Eintrag: `wave_contacts` laden; jeden Kontakt neu laden; ausschließen nach Sperre, `isMailable`, Widerspruch (Anlass, Bereich), Markierung „E-Mail ungültig“, gelöscht.
- **Geänderte Adresse:** persönlich → aktuelle Adresse; Rundschreiben → Kontakt fällt aus dem Eintrag (der nächste rückt nach), sonst `skip('addressChanged')`.
- Erster verbleibender Kontakt füllt die Mail mit `sendingValues` und `fillMail`; fehlender Pflichtwert → `fail('missing:<key>')`.
- `unsubscribe.url` = `unsubscribeUrl` mit allen verbleibenden Kontakten des Eintrags (Design 12); `listUnsubscribe` gleich.
- Absender, Antwortadresse, Archiv-Kopie aus dem Absender; Anhänge der Welle; `messageId` aus dem Eintrag (`ClaimedEntry.messageId`, Ruling R4); `idempotencyKey` = Eintrags-ID.
- `stopWave` (`send`): alle `planned` → `cancelled`, `stopped_at`; Protokoll `wave.stopped`.

- [ ] **Step 1: Failing Tests schreiben**

```ts
it('skips a contact whose exit date has come since the confirmation', …)
it('skips suppressed, opted-out, invalid and deleted contacts', …)
it('lets the next contact of a merged address move up', …)
it('sends a personal mail to the new address after an import', …)
it('drops a contact with a new address from a circular entry', …)
it('fails an entry with a missing required value and names only the key', …)
it('fills current values and puts every merged contact into the unsubscribe link', …)
it('attaches the files of the wave and sets the idempotency key', …)
it('stops a wave and keeps entries already sent', …)
it('resends an uncertain entry only on request and logs it', …)
// token.test.ts
it('round-trips and hides the member number', …)       // Token enthält 'nr:' nicht im Klartext
it('refuses a changed or foreign token', …)
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** PASS; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(occasions): send and stop waves`

---

### Task 17: Oberfläche des manuellen Versands

**Files:**
- Create: `apps/web/src/routes/occasions/$occasionId.send.tsx`, `apps/web/src/components/sending/{send-flow,recipient-step,attachment-step,preview-step,confirm-dialog,test-mail-button}.tsx`, `apps/web/src/server/waves/test-mail.ts`
- Modify: `apps/web/src/functions/waves.ts` (`summarize`, `confirm`, `searchRecipients`, `loadRecipientValues`, `sendTestMail`), `apps/web/src/i18n/{de,en}.ts`
- Test: `apps/web/src/server/waves/test-mail.test.ts`

**Interfaces:**
- Consumes: Task 13–16, `MailPreview`, `useCompiledPreview`, `createStepGuard`, `kickOutbox`
- Produces:

```ts
export const TEST_MAILS_PER_HOUR = 20
export function sendTestMail(deps: Readonly<{ db: Db; env: Env; storage: ObjectStorage | null; fetch: typeof fetch; now: () => Date }>, actor: Principal,
  input: Readonly<{ occasionId: string; contactId: string; attachmentIds: readonly string[] }>): Promise<{ ok: true } | { refused: 'rate' | 'graphTooLarge' | 'compile' | 'missing'; keys?: string[] }>
```

**Regeln:**
- Schritte wie Design 10: Empfänger (Einzelauswahl über die Suche oder Filter; Zählung mit Ausschlussgründen und Zusammenlegungen live über `summarize`), Anhänge, Vorschau (Kontakt wählbar, bei Rundschreiben die zusammengelegten Namen), Testmail, Bestätigen (Dialog mit allen Zahlen aus `WaveSummary`, „sofort“ oder „geplant“ mit Datum und Uhrzeit in Europe/Berlin über React Aria).
- Vorschau-Werte des Ablaufs kommen von `previewValues` (Sicht des Benutzers); die Welle selbst nutzt später `sendingValues`.
- Hat der Anlass einen Graph-Absender, warnt der Anhang-Schritt schon beim Hochladen, sobald `summarize` `graphTooLarge` meldet (Design 6.4).
- Testmail: Betreff mit Vorsatz „[Test] “, Abmeldelink auf `/unsubscribe/test` (die Seite sagt nur „Testmail – nichts geändert“), direkt über den Absender, `countSent`, Protokoll `wave.test_sent`.
- Fokus und Ansagen: Schrittwechsel setzt den Fokus auf die Überschrift; Zählungen in einer Live-Region; Fehler am Feld.

- [ ] **Step 1: Failing Tests schreiben**

```ts
it('sends a test mail to the user with the preview contact values and a [Test] subject', …)
it('limits test mails to twenty per user and hour', …)
it('refuses a test mail too large for graph', …)
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** PASS; `vp check` 0/0; die E2E-Fälle kommen in Task 21.
- [ ] **Step 5: Commit** – `feat(occasions): add the sending flow`

---

### Task 18: Abmelden

**Files:**
- Create: `apps/web/src/server/unsubscribe/unsubscribe.ts`, `apps/web/src/routes/unsubscribe.$token.tsx`, `apps/web/src/functions/unsubscribe.ts`
- Modify: `apps/web/src/server/contacts/suppressions.ts` (Widerspruch ohne Benutzer), `apps/web/src/server/audit/audit.ts` (`'contact.unsubscribed'`, `'contact.unsubscribe_undone'`), `apps/web/src/i18n/{de,en}.ts`
- Test: `apps/web/src/server/unsubscribe/unsubscribe.test.ts`

**Interfaces:**
- Consumes: Task 16 (`UnsubscribePayload`, `openUnsubscribe`, `sealUnsubscribe`, `deriveUnsubscribeKey`)
- Produces:

```ts
// server/unsubscribe/unsubscribe.ts
export type UnsubscribeScope = 'occasion' | 'area'
export interface UnsubscribePage { clubName: string; occasionName: string | null; areaName: string | null; valid: boolean }
export function describeUnsubscribe(db: Db, payload: UnsubscribePayload | null): Promise<UnsubscribePage>   // nie Namen oder Adressen von Kontakten
export function unsubscribe(db: Db, payload: UnsubscribePayload, scope: UnsubscribeScope, now: Date): Promise<{ undo: string }>   // undo = versiegelt, 30 min
export function undoUnsubscribe(db: Db, key: CryptoKey, undo: string, now: Date): Promise<boolean>
// server/contacts/suppressions.ts
export function optOutByKey(tx: Db, input: Readonly<{ kind: ContactKind; contactKey: string; scope: UnsubscribeScope; occasionId: string | null; areaId: string | null }>): Promise<boolean>   // idempotent, actor null
```

**Regeln (Design 12, 17):**
- Route `/unsubscribe/$token`: GET rendert die Seite (öffentlich, ohne Rahmen-Navigation, Sprache der Anfrage) und ändert nichts. `server.handlers.POST` beantwortet nur die Ein-Klick-Abmeldung (`Content-Type: application/x-www-form-urlencoded`, Body `List-Unsubscribe=One-Click`): Widerspruch für den Anlass, Antwort `200` ohne Inhalt; ohne Cookies und ohne `Origin`.
- Das Formular der Seite ruft eine Server-Funktion (`submitUnsubscribe`) ohne `requireRequestPrincipal` auf; die CSRF-Middleware schützt sie (gleiche Herkunft).
- Widersprüche für alle Kontakte des Tokens, in einer Transaktion mit `lockImportState` je Art und `bumpStockVersion`; Protokoll pro Kontakt mit `auditTarget`, Akteur `null`.
- `token = 'test'` → Seite „Testmail – nichts geändert“.
- Ungültiges Token → dieselbe neutrale Seite „Link ungültig“, Status 404, keine Details.

- [ ] **Step 1: Failing Tests schreiben**

```ts
// unsubscribe.test.ts
it('opts out every contact of the mail from the occasion', …)
it('opts out from the whole area when chosen', …)
it('is idempotent and survives an import', …)
it('undoes within 30 minutes and not later', …)
it('describes the page without names or addresses', …)
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** PASS; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(occasions): let recipients unsubscribe`

---

### Task 19: Rückläufer

**Files:**
- Create: `apps/web/src/server/bounces/{graph-step,resend-webhook-handler}.ts`, `apps/web/src/routes/api/webhooks/resend.$connectionId.ts`
- Modify: Schema `apps/web/src/server/db/schema/bounces.ts` (Ergänzung: `processed_reports`, `webhook_events`; `contact_bounces` stammt aus Task 15), `apps/web/src/server/bounces/bounces.ts` (Ergänzung), `apps/web/src/server/tick/steps.ts` (`graphBounces`), `apps/web/src/server/contacts/{mailable,contacts}.ts` (Markierung im Kontakt und in der Liste), `apps/web/src/server/audit/audit.ts` (`'contact.bounce_cleared'`), Migration (erzeugt)
- Test: `apps/web/src/server/bounces/{bounces,graph-step,resend-webhook-handler}.test.ts`

**Interfaces:**
- Consumes: Task 3 (`fetchBounces`), Task 4 (`verifyResendWebhook`), Task 7
- Produces:

```ts
export function recordBounce(db: Db, input: Readonly<{ entry: { messageId: string } | { providerId: string }; hard: boolean; source: 'graph' | 'resend'; at: Date }>): Promise<'marked' | 'logged' | 'unknown'>
export function recordComplaint(db: Db, providerId: string, at: Date): Promise<boolean>          // Widerspruch für den Bereich, alle Kontakte des Eintrags
export function clearBounce(db: Db, actor: Principal, contactId: string): Promise<void>          // edit im Bereich der Welle oder der Kontaktart
export function isEmailInvalid(db: Db, contact: Pick<ContactRecord, 'kind' | 'contactKey' | 'email'>): Promise<boolean>
export const graphBounces: TickStep                                                              // pro Graph-Absender, ab letzter Prüfung (system_state), Grenze 50 pro Lauf
export function handleResendWebhook(request: Request, deps: Readonly<{ db: Db; env: Env; key: CryptoKey; now: () => Date }>): Promise<Response>
```

**Schema:**
- **`contact_bounces`:** `(kind, contact_key, email)` Primärschlüssel, `source`, `created_at`, `entry_id null`.
- **`processed_reports`:** `(connection_id, report_id)` Primärschlüssel, `processed_at`.
- **`webhook_events`:** `id text pk` (Svix-ID), `received_at`.

**Regeln (Design 13, 17):**
- Hart → Eintrag `bounced`, alle Kontakte des Eintrags markiert (Adresse aus `wave_contacts`); weich → nur `last_error_code`. Bericht bzw. Ereignis nur einmal verarbeitet.
- Webhook: nur `POST`, Body höchstens 64 KiB (vor dem Lesen über `Content-Length`, beim Lesen abgebrochen), Anbindung muss Resend sein, Signatur und Zeit gültig → `200`; sonst `400`/`401`/`404`/`413` ohne Details. Liegt außerhalb der CSRF-Middleware (Server-Route).
- Eine Markierung greift nicht mehr, sobald die Adresse des Kontakts eine andere ist.

- [ ] **Step 1: Failing Tests schreiben**

```ts
it('marks every contact of a hard bounce and only logs a soft one', …)
it('processes a graph report once', …)
it('turns a complaint into an area opt-out for every contact of the mail', …)
it('lets a new address clear the marking', …)
it('lets users with edit clear the marking', …)
it('answers the webhook only with a valid signature, once per event, within 64 KiB', …)
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.** `vp run --filter web db:generate`.
- [ ] **Step 4: Prüfen.** PASS; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(occasions): track bounces`

---

### Task 20: Versandübersicht

**Files:**
- Create: `apps/web/src/server/waves/overview.ts`, `apps/web/src/routes/sending/{route,index,waves.$waveId}.tsx`, `apps/web/src/components/sending/{wave-table,entry-table,bounce-list,stop-wave-dialog}.tsx`
- Modify: `apps/web/src/functions/waves.ts`, `apps/web/src/server/frame.ts` und `apps/web/src/components/main-nav.tsx` („Versand“ mit Zahl der Rückläufer), `apps/web/src/i18n/{de,en}.ts`
- Test: `apps/web/src/server/waves/overview.test.ts`

**Interfaces:**
- Produces:

```ts
export type WaveState = 'planned' | 'running' | 'done' | 'stopped'
export interface WaveRow { id: string; occasionName: string; notBefore: Date; state: WaveState; counts: Record<EntryStatus, number> }
export function listWaves(db: Db, actor: Principal, areaId: string, page: number): Promise<{ items: WaveRow[]; total: number }>   // read
export interface EntryRow { id: string; recipientName: string; recipientEmail: string; status: EntryStatus; code: string | null; merged: number }
export function listEntries(db: Db, actor: Principal, waveId: string, page: number): Promise<{ items: EntryRow[]; total: number }>   // Basisfelder, read
export function listBounces(db: Db, actor: Principal, areaId: string): Promise<{ contactId: string; name: string; email: string; at: Date }[]>
export function bounceCount(db: Db, principal: Principal): Promise<number>     // für die Navigation
```

**Regeln:** Design 16. Kein Mailinhalt; Fehlercodes übersetzt (`outbox.code.*`); Aktionen „Welle stoppen“ und „erneut senden“ (unklar) nur mit `send`, „Markierung aufheben“ mit `edit`. Bereichswahl wie auf den Vorlagen-Seiten.

- [ ] **Step 1: Failing Tests schreiben**

```ts
it('lists waves of an area with counts per state for read users only', …)
it('derives the wave state from entries and stop time', …)
it('shows base fields of recipients and no mail content', …)
it('counts bounces for the navigation per visible area', …)
```

- [ ] **Step 2: Tests laufen lassen.** FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** PASS; `vp check` 0/0.
- [ ] **Step 5: Commit** – `feat(occasions): add the sending overview`

---

### Task 21: E2E, Doku, Changeset und Abschluss 4b

**Files:**
- Modify: `apps/web/e2e/sending.e2e.ts` (Ergänzung), `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/superpowers/plans/2026-11-23-vereinsbote-00-fahrplan.md` (Punkte aus Teilplan 3 für Teilplan 4 erledigt)
- Create: `.changeset/add-occasions-and-sending.md`

**E2E (`sending`):**

```ts
test('an editor creates a circular occasion and an admin may not see its recipients', …)
test('a circular goes out once per address with the attachment and unsubscribe headers', …)   // Filter, Anhang (PDF), Vorschau mit zusammengelegten Namen, Testmail in Mailpit, Bestätigen, Tick, je Adresse eine Mail mit List-Unsubscribe
test('a recipient unsubscribes from the area, undoes it and unsubscribes again', …)           // Seite ohne Namen; nächste Welle schließt den Kontakt aus; GET allein ändert nichts
test('one-click unsubscribe works without cookies', …)                                        // request.post ohne Cookies
test('personal mails go first under a small daily limit', …)                                 // Limit 3, Rundschreiben 5, persönlich 2; Tick; Mailpit-Reihenfolge
test('a hard bounce marks the contacts and an editor clears the marking', …)                  // addNdr bzw. sendResendWebhook
test('a wave can be stopped', …)                                                              // geplant in 1 Stunde, stoppen, Tick, keine Mail
test('a template used by an occasion cannot be deleted', …)
// axe auf /occasions, /occasions/new, /occasions/$id, /occasions/$id/send (jeder Schritt und Dialog), /sending, /sending/waves/$id, /unsubscribe/$token
```

**Doku:**
- `README.md`: Anlässe, Wellen, Anhänge, Abmelden (öffentliche Route, Ein-Klick), Rückläufer (Graph-Abruf, Resend-Webhook-URL `/api/webhooks/resend/<id>` im Resend-Dashboard eintragen), Grenzen.
- `AGENTS.md`: Wellen entstehen nur über `confirmWave` (kompilierte Fassung, Einmal-Schlüssel); Werte für den Versand nur über `sendingValues`; Widersprüche ohne Benutzer nur über `optOutByKey`; öffentliche Routen prüfen Token bzw. Signatur selbst; `unsubscribe.url` ist der einzige Nicht-CD-Schlüssel in `href`.
- `CONTRIBUTING.md`: Bypass-Korpus um `unsubscribe.url` erweitert (nur erweitern).

**Changeset** (`web`, `minor`):

```md
---
'web': minor
---

Add occasions and manual sending: occasions per area as personal mail or circular, waves with recipient filters, attachments, a preview per recipient, a test mail and a confirmation with the expected duration, one mail per address for circulars, stopping a wave, an unsubscribe page with one-click unsubscribe, bounce tracking for Graph and Resend, and a sending overview per area.
```

- [ ] **Step 1: E2E schreiben**, laufen lassen, Lücken schließen.
- [ ] **Step 2: Gesamtprüfung** wie Task 11 Step 2.
- [ ] **Step 3: Commit** – `docs(occasions): document occasions and sending`
