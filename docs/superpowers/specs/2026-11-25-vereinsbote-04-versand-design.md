# Vereinsbote – Teilplan 4: Versand (Design)

Stand: 2026-11-25 · Status: freigegeben am 2026-11-25

Ergänzt die Spec `2026-11-23-vereinsbote-design.md` (Abschnitte 5, 6.4, 6.6, 6.7, 6.10 und 7) für Teilplan 4 des Fahrplans. Wo dieses Dokument von der Spec abweicht, gilt dieses Dokument; die Spec wird im selben Schritt angepasst (siehe 21). Es baut auf den Designs von Teilplan 2 (`…-02-kontakte-design.md`) und 3 (`…-03-gestaltung-design.md`) auf.

Markierung **[Claude]** = Vorgabe, die im Gespräch nicht ausdrücklich abgestimmt wurde. Diese Punkte stehen am Ende gesammelt.

---

## 1. Worum es geht und warum

Teilplan 4 bringt die Mails aus der App hinaus. Bisher gehen nur Systemmails, und auch die nur in der Entwicklung über `DEV_SMTP_URL` an Mailpit; auf Vercel und Cloudflare kommt heute keine Mail an, nicht einmal ein Anmeldelink. Nach Teilplan 4 verbindet ein Admin den Verein mit Microsoft 365 (Graph) oder Resend, und Ehrenamtliche verschicken Einladungen und andere manuelle Mails selbst: mit Vorschau pro Empfänger, Testmail an sich selbst und Bestätigung. Der Postausgang verteilt die Mails gedrosselt und innerhalb der Tageslimits, Empfänger können sich abmelden, unzustellbare Adressen werden erkannt.

- **Ehrenamtliche verschicken selbst** (Spec 1). Der Ablauf schützt vor Fehlern durch Vorschau, Testmail, Bestätigungsdialog mit Empfängerzahl und die Möglichkeit, eine laufende Welle zu stoppen.
- **Nie doppelt, nie an die Falschen** (Spec 2, Anti-Ziele). Lieber eine Mail zu wenig und sichtbar als „unklar“ markiert als eine doppelt; vor jedem Versand prüft die App erneut, ob der Kontakt noch angeschrieben werden darf.
- **Nicht still ausfallen:** abgelaufene Secrets, gestörte Anbindungen und fehlgeschlagene Mails melden sich bei den Admins.

**Erfolg:** Die Veranstaltungs-Zuständige wählt den Anlass „Einladungen“, startet eine Welle für das Sommerfest, filtert die Empfänger, hängt den Flyer an, prüft die Vorschau mit einem echten Kontakt, schickt sich eine Testmail und bestätigt. Die Mails gehen über das Vereinspostfach raus, eine pro Familie, ohne dass das Tageslimit die Geburtstagsmails verdrängt. Wer sich abmeldet, bekommt beim nächsten Rundschreiben nichts mehr.

---

## 2. Ziele, Nicht-Ziele, Anti-Ziele

### Ziele

- Anbindungen für Microsoft Graph und Resend; Absender mit Bereichsfreigabe, Drosselung und Tageslimit.
- Postausgang mit Drosselung, Tageslimit, Vorrang, Wiederholung und Selbst-Anstoß.
- Systemmails (Anmeldelink, Einladung, Warnungen) über den echten Absender, im CD-Layout mit Rückfall.
- Anlass (Auslöser „manuell“) mit Art „persönlich“ oder „Rundschreiben“.
- Manueller Versand: Empfänger, allgemeine Anhänge, Vorschau pro Empfänger, Testmail, Bestätigung, sofort oder geplant.
- Doppelte Adressen bei Rundschreiben zusammenlegen.
- Abmelden mit öffentlicher Seite und `List-Unsubscribe`.
- Rückläufer bei Graph und Resend.
- Warnung vor Ablauf des Graph-Secrets.
- Pflichtpunkte aus den Teilplänen 1 und 3 (siehe 20).

### Nicht-Ziele (für Teilplan 4)

- Datumsregeln, Geburtstage, Jubiläen, Vorschau-Mail, Dashboard (Teilplan 5). Teilplan 4 baut Anlass und Art so, dass Teilplan 5 nur den Auslöser ergänzt.
- Rechnungen (PDF auslesen, XRechnung, Empfängervorschlag) und `.ics` (Teilplan 6). Teilplan 6 setzt auf die allgemeinen Anhänge auf.
- Löschfristen für Versandprotokoll und Anhänge (Teilplan 7).
- Allgemeiner SMTP-Versand im Betrieb (Spec 2). `DEV_SMTP_URL` bleibt nur für die Entwicklung.
- Öffnungs- und Klick-Tracking, Zustellbestätigungen als eigener Status.
- Vier-Augen-Freigabe (Spec 2).
- Konten bei Microsoft oder Resend anlegen; Tests gegen echte Anbieter (siehe 5.3).

### Anti-Ziele (Fehlschlag, auch wenn technisch alles läuft)

- Eine Mail geht doppelt raus, weil ein Lauf abbricht oder zwei Läufe gleichzeitig arbeiten.
- Ein Mitglied, das zwischen Bestätigung und Versand ausgetreten, gesperrt oder abgemeldet ist, bekommt die Mail trotzdem.
- Ein Bereich verschickt über ein Postfach, das ihm nicht freigegeben ist.
- Ein Rundschreiben verdrängt die persönlichen Mails des Tages aus dem Tageslimit.
- Ein abgelaufenes Secret oder eine gestörte Anbindung fällt niemandem auf.
- Ein Mail-Scanner verbraucht den Anmeldelink, bevor der Mensch klickt.
- Zugangsdaten, Adressen oder Mailinhalte landen in Logs, URLs oder Fehlermeldungen.
- Die Abmeldeseite verrät Namen oder Adressen; ein erratener Link meldet fremde Kontakte ab.

---

## 3. Rahmen

- Alle Regeln aus `AGENTS.md` gelten: Vite+, pnpm-Catalog, neueste stabile Versionen, React Aria Components, `PostForm`, Server-Funktionen mit zod und eigener Autorisierung, `useT`/`translate`, `pageHead`, WCAG 2.2 AA mit axe in E2E, CSP-Fixture, Fehlercodes statt Personendaten in Logs, TDD, erfundene Testdaten.
- Läuft gleich auf Node, Vercel und Cloudflare Workers. `nodemailer` nur auf dem Node-Pfad hinter der Build-Konstante, wie bisher.
- Kontaktzugriff nur über `loadContactAccess` (Teilplan 2), nie in einer Transaktion. Schreibzugriffe auf Widersprüche nehmen die Import-Sperre (`lockImportState`).
- Mails an Kontakte sind deutsch (Teilplan 2). Systemmails gehen in der Sprache des Benutzers.
- Rendern über `compileMail`/`fillMail` aus Teilplan 3; Werte pro Empfänger hängen nur an Bereich und Feldschutz, nicht an einem Benutzer.
- Zeitsteuerung aus Teilplan 1 (`tickSteps`, Zeitbudget, `runTickChain`), Zeitzone Europe/Berlin (`todayInClubZone`).
- Größenordnung (Spec 3): 300–1.000 Mitglieder, Spitzen von etwa 1.000 Mails an einem Tag; Exchange-Richtwert 30 Mails pro Minute; Resend Free 100 Mails pro Tag.
- Keine Konten, keine echten Zugangsdaten in Repo, CI oder Tests (siehe 5.3).

---

## 4. Abgestimmte Entscheidungen

Im Gespräch am 2026-11-25 festgelegt:

1. **Allgemeine Anhänge kommen in Teilplan 4** (PR 4b), nicht erst mit den Rechnungen. Teilplan 6 setzt nur das Auslesen der Rechnung darauf.
2. **Der Anlass hat eine Art:** „persönlich“ (eine Mail pro Kontakt, Vorrang beim Tageslimit; z. B. Geburtstag, Rechnung) oder „Rundschreiben“ (eine Mail pro Adresse, nachrangig; z. B. Einladung). Die Art steuert Vorrang und Zusammenlegen, nicht die Zahl der Empfänger.
3. **Zusammenlegen bei Rundschreiben:** Teilen sich mehrere Kontakte eine Adresse, geht eine Mail mit den Werten (Anrede) des ersten Kontakts; die Vorschau zeigt, wer zusammengelegt wurde, das Versandprotokoll vermerkt alle (Reihenfolge in 11).
4. **Absender werden pro Bereich freigegeben.** Ein Anlass wählt nur Absender, die seinem Bereich freigegeben sind.
5. **Systemmails gehen im CD-Layout mit Rückfall** auf eine schlichte Fassung, in der Sprache des Benutzers, über den einen „Absender für Systemmails“.
6. **Abmeldeseite mit zwei Wahlen:** „nur dieser Anlass“ (vorausgewählt) oder „alle Mails aus diesem Bereich“. Die Ein-Klick-Abmeldung des Mailprogramms gilt nur für den Anlass.
7. **Getestet wird mit Nachbau-Servern** für Graph und Resend, die an Mailpit zustellen (5.3).
8. **Ein Design, zwei PRs** (4a, 4b; siehe 19).
9. **Graph-Rechte bleiben `Mail.Send` und `Mail.Read`** (6.4). Über Graph geht jede Mail als ein MIME-Aufruf; Anhänge sind dort auf rund 2 MB pro Mail begrenzt, Upload-Sessions entfallen.

Im Gespräch vorgeschlagen und ohne Widerspruch geblieben: Anbindung als eigenes Objekt; Ablauf des manuellen Versands; erneute Prüfung vor jedem Versand; Welle stoppen; Wiederholung mit wachsenden Abständen und Zustand „unklar“; Systemmails am Postausgang vorbei; Tageslimit für Anmeldelinks und Bestätigungsseite; „Einladung erneut senden“; nur harte Rückläufer markieren; Versandübersicht pro Bereich; Graph-Versand über MIME.

---

## 5. Bauwege

### 5.1 Postausgang

Tabelle in der Datenbank, abgearbeitet von der vorhandenen Zeitsteuerung (**gewählt**). Verworfen: Warteschlangen der Plattformen (Cloudflare Queues, Vercel Queues) – auf jeder Plattform anders, Docker hat keine, und die „nie doppelt“-Garantie hängt an Postgres-Transaktionen. Externe Dienste kosten Geld und ein weiteres Konto.

### 5.2 Anbindungen

Eigene, schlanke Adapter über `fetch`, ohne SDKs (**gewählt**). Das Graph-SDK und MSAL brauchen Node-Module und laufen nicht auf Workers; das Resend-SDK wäre eine Abhängigkeit für eine Handvoll Aufrufe. Eigene Adapter lassen sich mit eingespeistem `fetch` testen und gegen die Nachbau-Server (5.3) richten. Für den MIME-Aufbau wählt der Builder eine Bibliothek, die im Browser, auf Workers und unter Node ohne `eval` läuft (oder baut einen kleinen eigenen Baustein, siehe 23).

### 5.3 Testen ohne Konten

| | A) nur Entwicklungs-Anbindung SMTP → Mailpit | **B) Nachbau-Server (gewählt)** | C) beides |
|---|---|---|---|
| Was E2E prüft | Ablauf der App, nicht den Code von Graph und Resend | den ganzen Weg: Token, MIME, Senden, Rückläufer-Abruf, Webhook-Signatur | wie B |
| Aufwand | am kleinsten | ein kleiner Node-Dienst mit den benötigten Endpunkten | am größten, zwei Wege für einen Zweck |

- Der **Nachbau-Server** ist ein kleiner lokaler HTTP-Dienst (nur Entwicklung und Tests). Er ahmt die Endpunkte nach, die die Adapter nutzen (Token-Abruf bei Microsoft, Graph-Senden und Posteingang lesen, Resend-Senden), stellt jede angenommene Mail über SMTP an Mailpit zu und kann auf Zuruf eines Tests einen Unzustellbarkeitsbericht in den Graph-Posteingang legen oder einen signierten Resend-Webhook an die App schicken.
- Die App nutzt ihre echten Adapter; nur die Basis-URLs zeigen auf den Nachbau. Das schaltet eine neue Variable **`DEV_PROVIDERS_URL`** frei, die nur gilt, wenn `APP_URL` eine lokale `http:`-Adresse ist und der Build nicht Vercel oder Cloudflare ist (Build-Konstante) – sonst lehnt `parseEnv` sie ab. So kann eine falsch gesetzte Variable in Produktion keine Zugangsdaten an einen fremden Host schicken.
- Systemmails nutzen lokal weiter `DEV_SMTP_URL`, solange kein Absender für Systemmails eingerichtet ist.
- **Restrisiko:** Gegen ein echtes Microsoft-365-Postfach und ein echtes Resend-Konto prüft erst jemand mit eigenem Tenant bzw. Key (vor der Veröffentlichung, Teilplan 8 bzw. Abnahme durch den Projektinhaber). Was der Nachbau nicht wissen kann (z. B. ob Exchange eine selbst gesetzte Message-ID behält, wie genau ein NDR aussieht), steht in 23 als zu prüfen.

---

## 6. Anbindungen

Eine **Anbindung** ist ein eigenes Objekt mit den Zugangsdaten zu einem Anbieter; mehrere Absender teilen sich eine Anbindung, so wie in Entra eine App-Registrierung mehrere Postfächer bedient. **[Claude]** Verwaltet nur der Admin.

### 6.1 Microsoft Graph

- **Felder:** Name, Tenant-ID, Client-ID, Client-Secret, **Ablaufdatum des Secrets** (Pflicht, von Hand eingetragen). **[Claude]** Graph verrät das Ablaufdatum nur mit dem Recht `Application.Read.All`, das die App sonst nicht braucht.
- **Anmeldung als App** (Client Credentials, Scope `https://graph.microsoft.com/.default`). Das Token wird höchstens für die Dauer eines Laufs bzw. einer Anfrage gehalten, nicht über Anfragen hinweg (Regel „request-scoped“).
- **Rechte:** nur `Mail.Send` und `Mail.Read`, beide in Exchange auf die Absenderpostfächer beschränkt (RBAC for Applications); die Anleitung (Teilplan 8) liefert die Befehle. Kein `Mail.ReadWrite` (Entscheidung 9, siehe 6.4).
- **Versand über MIME:** Nur im MIME-Format lassen sich `List-Unsubscribe`, `List-Unsubscribe-Post` und eine eigene `Message-ID` setzen; im JSON-Format erlaubt Graph nur `x-`-Kopfzeilen, und `sendMail` antwortet ohne Message-ID. Mails gehen in „Gesendete Elemente“ (Standard von Graph).
- **[Claude] Systemmails über JSON ohne Ablage:** Anmeldelinks und Einladungen enthalten Zugänge zur App; wer das Systempostfach mitliest, könnte sich damit anmelden. Systemmails gehen deshalb über `sendMail` im JSON-Format mit `saveToSentItems: false`; sie brauchen weder Abmelde-Kopfzeilen noch eine Message-ID für Rückläufer.
- **Selbsttest beim Speichern** einer Anbindung bzw. eines Graph-Absenders:
  1. Token holen (Tenant, Client-ID, Secret stimmen).
  2. Testmail vom Absender an die Adresse des Admins.
  3. **Beschränkungstest** (Spec 6.6): Leseversuch auf ein Postfach des Tenants, das kein Absender ist. **[Claude]** Der Admin gibt die Adresse an, vorbelegt mit seiner eigenen. Antwort „verboten“ = Beschränkung wirkt; Lesen gelingt = deutliche Warnung (bleibt als Hinweis an der Anbindung stehen, bis ein späterer Test besteht); „nicht gefunden“ oder andere Fehler = „nicht prüfbar“ mit Hinweis.
- **Rückläufer:** siehe 13.

### 6.2 Resend

- **Felder:** Name, API-Key, Webhook-Signing-Secret.
- **[Claude]** Die Doku empfiehlt einen API-Key mit „Sending access“, beschränkt auf die Domain. Die App prüft die Domain-Bestätigung nicht selbst (dafür bräuchte sie einen Key mit vollem Zugriff); die Testmail beim Speichern zeigt, ob der Versand klappt.
- Versand mit HTML, Nur-Text, Kopfzeilen (`List-Unsubscribe`, `List-Unsubscribe-Post`), Antwortadresse, Anhängen und einem **Idempotenz-Schlüssel** pro Postausgangs-Eintrag (Resend verwirft Doppelte mit demselben Schlüssel).
- **Blindkopie an ein Archivpostfach** optional pro Absender (Spec 6.6), weil Resend keinen Ordner „Gesendet“ hat. **[Claude]** Nie für Systemmails (siehe 6.1).
- **[Claude] Grenzen pro Konto:** Resend begrenzt Rate und Tageskontingent pro Konto, also pro Anbindung. Bei Resend liegen Drosselung und Tageslimit deshalb an der **Anbindung** und gelten für alle ihre Absender gemeinsam (bei Graph am Absender, weil Exchange pro Postfach zählt). Meldet Resend ein erschöpftes Tages- oder Monatskontingent, warten die Einträge bis zum nächsten Tag, ohne Versuche zu verbrauchen.
- **Webhook** für Rückläufer und Beschwerden: siehe 13 und 17.

### 6.3 Gemeinsame Schnittstelle

Eine Adapter-Schnittstelle (Spec 7): Mail senden, Rückläufer abholen (nur Graph; Resend liefert per Webhook), Verbindung prüfen. Fehler kommen klassifiziert zurück (Fehlercodes, keine Rohmeldungen der Anbieter):

| Klasse | Beispiele | Folge im Postausgang (8) |
|---|---|---|
| vorübergehend | 429, 5xx, Zeitüberschreitung, Netzfehler | neuer Versuch nach Wartezeit (`Retry-After` beachten) |
| Empfänger abgelehnt | ungültige Adresse, Mail zu groß | sofort „fehlgeschlagen“ |
| Zugang abgelehnt | 401/403 beim Token oder Senden, falsches Secret | Anbindung „gestört“ (8.6) |

### 6.4 Anhänge bei Graph (entschieden: ohne `Mail.ReadWrite`)

Die Spec nannte die Rechte `Mail.Send` und `Mail.Read` und zugleich „Anhänge über 3 MB laufen über eine Upload-Session“. Das passt nicht zusammen: Eine Upload-Session hängt eine Datei an einen **Entwurf**, und Entwürfe anlegen und Upload-Sessions brauchen `Mail.ReadWrite`.

| | **A) `Mail.Send` + `Mail.Read` (gewählt)** | B) zusätzlich `Mail.ReadWrite` |
|---|---|---|
| Versand | ein MIME-Aufruf pro Mail, höchstens 4 MB | Entwurf aus MIME, Upload-Session, Senden (drei Aufrufe) |
| Anhänge über Graph | rund 2 MB pro Mail (die Anfrage ist die Base64-kodierte MIME-Nachricht, Anhänge sind darin ein zweites Mal Base64-kodiert) | bis 20 MB pro Mail |
| Rechte im Postfach | die App kann dort nichts ändern | die App dürfte Mails in den Absenderpostfächern ändern oder löschen |

**Gewählt: A** (Entscheidung 9). Ein weitreichenderes Recht lässt sich später kaum wieder einschränken, und ein komprimierter Flyer passt meist unter 2 MB.

- **[Claude]** Die Grenze gilt für die ganze Anfrage (4 MB; sie ist die Base64-kodierte MIME-Nachricht samt Anhängen). Das Bestätigen einer Welle und die Testmail prüfen, ob die Mail mit ihren Anhängen bei einem Graph-Absender darunter bleibt, und nennen sonst die Grenze; das Hochladen warnt schon, wenn die Anhänge bei Graph zu groß werden. Bei Resend gilt die Grenze aus 10.2.

---

## 7. Absender

- **Felder:** Adresse (über `normalizeEmail`), Anzeigename, Antwortadresse (optional, Standard: Absenderadresse), Anbindung, Drosselung (Mails pro Minute), Tageslimit (optional), freigegebene Bereiche, bei Resend optional Archiv-Blindkopie.
- **Drosselung:** Standard bei Graph 30 Mails pro Minute (Spec 6.6), am Absender; bei Resend an der Anbindung (6.2), Standard aus der aktuellen Resend-Doku. Einstellbar. Das Tageslimit liegt entsprechend am Graph-Absender bzw. an der Resend-Anbindung.
- **Bereichsfreigabe** (Entscheidung 4): Ein Absender ohne freigegebenen Bereich ist nur als Systemabsender nutzbar. Das Entfernen einer Freigabe wird abgelehnt, solange ein Anlass des Bereichs den Absender nutzt (die Meldung nennt die Anlässe).
- **Absender für Systemmails:** höchstens einer, vom Admin markiert (14).
- **Löschen:** gesperrt, solange ein Anlass den Absender nutzt oder offene Postausgangs-Einträge an ihm hängen; eine Anbindung entsprechend, solange Absender sie nutzen.
- **Zugangsdaten** sind nach dem Speichern nie wieder sichtbar, nur ersetzbar (Feld leer = unverändert).

---

## 8. Postausgang

### 8.1 Einträge und Zustände

Ein Postausgangs-Eintrag ist eine Mail an einen Empfänger (Spec 5). Zustände:

| Zustand | Bedeutung |
|---|---|
| geplant | wartet auf seinen Zeitpunkt, die Drosselung oder das Tageslimit |
| in Versand | ein Lauf hat ihn übernommen und sendet gerade |
| gesendet | der Anbieter hat ihn angenommen |
| zurückgewiesen | harter Rückläufer (13) |
| fehlgeschlagen | Versuche erschöpft, Empfänger abgelehnt oder Pflichtwert fehlt |
| übersprungen | vor dem Versand nicht mehr anschreibbar (11.3) |
| abgebrochen | Welle gestoppt (11.4) |
| unklar | Lauf brach mitten im Senden ab; nicht automatisch erneut gesendet (8.5) |

Dazu: Zahl der Versuche, nächster Versuch, letzter Fehlercode, Message-ID, Sendezeit, die beim Senden genutzte Adresse.

### 8.2 Abarbeiten

- Ein neuer Schritt der Zeitsteuerung (`tickSteps`) arbeitet die fälligen Einträge ab, Absender für Absender, innerhalb des Zeitbudgets des Laufs. Zwei gleichzeitige Läufe können denselben Eintrag nicht übernehmen (Übernahme in einer Anweisung, z. B. `FOR UPDATE SKIP LOCKED`; die Tick-Sperre aus Teilplan 1 bleibt zusätzlich).
- **Drosselung pro Absender:** höchstens N Mails pro Minute; der Lauf wartet zwischen den Paketen.
- **Selbst-Anstoß** (Spec 6.6): Bleibt Arbeit übrig, meldet der Schritt `moreWork`; `runTickChain` startet den nächsten Lauf direkt.
- **[Claude]** Der Schritt hält sich an die Grenze der Unteranfragen pro Aufruf auf Cloudflare Workers (Graph braucht mehrere Aufrufe pro Mail); Paketgröße pro Lauf entsprechend.

### 8.3 Tageslimit und Vorrang

- Gezählt wird pro Graph-Absender bzw. Resend-Anbindung (7) und Kalendertag in Europe/Berlin; Systemmails und Testmails zählen mit.
- **Vorrang:** Einträge persönlicher Anlässe gehen vor Rundschreiben.
- **Reserve:** Für persönliche Einträge, die heute fällig werden und noch nicht gesendet sind, hält der Postausgang Kontingent frei; Rundschreiben nutzen nur den Rest (Spec 6.6). Eine Einladungswelle am Morgen verdrängt die Geburtstagsmails um 8 Uhr also nicht.
- **Systemmails** gehen auch bei erreichtem Limit (eine Anmeldung darf nie am Limit scheitern), zählen aber mit.
- Was heute nicht passt, geht am nächsten Tag weiter. Der Bestätigungsdialog nennt vorher die voraussichtliche Dauer in Tagen (10.5).

### 8.4 Wiederholung

**[Claude]** Bis zu 5 Versuche; Wartezeiten 5 Minuten, 30 Minuten, 2 Stunden, 8 Stunden (bzw. `Retry-After`, wenn länger). Danach „fehlgeschlagen“. Abgelehnte Empfänger sind sofort „fehlgeschlagen“ (6.3).

### 8.5 Lieber keine Mail als zwei

Bricht ein Lauf zwischen Senden und Speichern ab, weiß die App nicht, ob die Mail raus ist. **[Claude]** Ein Eintrag, der länger als 10 Minuten „in Versand“ steht, wird „unklar“ und nicht automatisch erneut gesendet. In der Versandübersicht kann jemand mit `send` ihn nach Prüfung ausdrücklich erneut senden. Bei Resend verhindert zusätzlich der Idempotenz-Schlüssel Doppelte.

### 8.6 Gestörte Anbindung

Lehnt ein Anbieter den Zugang ab (6.3), gilt die Anbindung als „gestört“: Ihre Einträge warten, ohne Versuche zu verbrauchen; die Admins bekommen eine Mail (einmal pro Störung, über den Systemabsender, falls der nicht selbst betroffen ist); die Oberfläche zeigt die Störung. **[Claude]** Jeder Lauf prüft eine gestörte Anbindung einmal (Token holen); gelingt das, ist die Störung vorbei. Speichert der Admin neue Zugangsdaten, wird sofort geprüft.

### 8.7 „Sofort“ und „geplant“

- **Sofort:** Das Bestätigen legt die Welle an und stößt im Hintergrund (`platform.waitUntil`) einen kurzen Lauf an, der das erste Paket verschickt (Spec 6.4). **[Claude]** Kurzes Budget, weil Workers die Arbeit nach der Antwort nur kurz erlauben; der Rest folgt über die Zeitsteuerung.
- **Geplant:** Datum und Uhrzeit in Europe/Berlin, nicht in der Vergangenheit, **[Claude]** höchstens ein Jahr im Voraus. Der Versand beginnt mit dem ersten Lauf ab diesem Zeitpunkt (bis zu einem Takt später).

---

## 9. Anlass

- **[Claude] Auf Dauer angelegt:** Ein Anlass steht für eine wiederkehrende Art von Mail („Einladungen“, „Rechnungen“, „Rundbrief“), nicht für ein einzelnes Ereignis; jede Veranstaltung ist eine neue Welle desselben Anlasses. So wirkt eine Abmeldung „nur von diesem Anlass“ auch für die nächste Einladung. Der Anlegen-Dialog sagt das in einem Satz.
- Gehört zu genau einem Bereich (Spec 5). Felder: Name, **Art** (persönlich / Rundschreiben), Vorlage (aus demselben Bereich), Absender (dem Bereich freigegeben), **Abmeldelink** ja/nein, Auslöser (in Teilplan 4 nur „manuell“; Teilplan 5 ergänzt die Datumsregel).
- **[Claude]** Abmeldelink vorbelegt: an bei Rundschreiben, aus bei persönlichen Anlässen; frei änderbar. Rechnungen (Teilplan 6) erzwingen „aus“ (Spec 6.6).
- **Rechte:** Ansehen ab `read`, Anlegen und Ändern ab `edit`, Versenden, Testmail und Stoppen ab `send` im Bereich (Spec 6.7).
- **Löschen:** **[Claude]** Ein Anlass ohne Wellen wird gelöscht; einer mit Wellen nur archiviert (nicht mehr wählbar, Verlauf und Widersprüche bleiben).
- **Vorlagen in Benutzung:** Eine Vorlage, die ein Anlass (auch ein archivierter) nutzt, lässt sich nicht löschen (Fahrplan, Teilplan 3); die Meldung nennt die Anlässe.
- Widersprüche „pro Anlass“ aus Teilplan 2 (`contact_opt_outs` mit `scope = 'occasion'`) zeigen ab jetzt auf echte Anlässe.

---

## 10. Manueller Versand

Ein Ablauf auf der Seite des Anlasses, Schritt für Schritt, mit `send` im Bereich (Spec 6.4).

### 10.1 Empfänger

- Einzeln wählen oder per Filter wie in der Kontaktliste (Kontaktart, Gruppen, Schlagworte, Feldwerte; geschützte Felder nur für Benutzer, die sie sehen, Teilplan 2). Suchbegriffe und Filter per POST, nie in der URL.
- Die App zählt **ausgeschlossene** Kontakte mit Grund: Sperre, Austritt erreicht, keine Adresse, Adresse als ungültig markiert (13), Widerspruch für Anlass oder Bereich.
- Bei Rundschreiben zeigt sie, wie viele Adressen zusammengelegt werden.

### 10.2 Anhänge

- **[Claude]** Erlaubt: PDF, JPEG, PNG (Signatur geprüft, nicht nur die Endung); höchstens 5 Dateien; **höchstens 4 MB pro Datei** und 20 MB pro Mail. Die Grenze pro Datei folgt aus dem Body-Limit von 4,5 MB pro Anfrage (Vercel; `formBodyLimit`); größere Dateien bräuchten direkte Uploads in den Speicher mit drei plattformeigenen Wegen. Für Graph gilt zusätzlich 6.4.
- Abgelegt im privaten Speicher unter eigenem Präfix (`attachments/<id>`, Teilplan 3: „Teilplan 4 und 6 legen Anhänge unter eigenem Präfix ab“), nie öffentlich ausgeliefert. Sie hängen an der Welle und werden mit dem Versandprotokoll gelöscht (Frist: Teilplan 7). **[Claude]** Anhänge eines abgebrochenen Ablaufs ohne Welle räumt die Zeitsteuerung nach einem Tag weg.

### 10.3 Vorschau

Pro Empfänger mit echten Daten, mit der Vorschau aus Teilplan 3 (Desktop, Mobil, Nur-Text); Werte über `previewValues`. Bei Rundschreiben zeigt sie zu einer Adresse die zusammengelegten Kontakte. Ein fehlender Pflichtwert erscheint als Fehler dieses Empfängers.

### 10.4 Testmail

- An die Adresse des angemeldeten Benutzers, über den Absender des Anlasses, mit den Werten des Kontakts, der gerade in der Vorschau steht, mit Anhängen. **[Claude]** Betreff mit Vorsatz „[Test]“, Abmeldelink zeigt auf eine Seite, die nichts bewirkt.
- Geht direkt raus (nicht über den Postausgang), zählt zum Tageslimit, steht im Aktivitätsprotokoll. **[Claude]** Höchstens 20 Testmails pro Benutzer und Stunde.

### 10.5 Bestätigen

- Dialog mit: Zahl der Mails, Ausgeschlossene nach Grund, zusammengelegte Adressen, Anhänge, voraussichtliche Dauer in Tagen (aus Tageslimit, Reserve und schon geplanten Einträgen), „sofort“ oder „geplant“.
- Das Bestätigen legt die Welle an (11). Scheitert dabei die Vorlage (fehlender CD-Pflichtwert, ungültige Vorlage, fehlender Abmelde-Platzhalter, 12), entsteht keine Welle und der Dialog nennt den Grund.
- Doppelte Absendung (Doppelklick, zweiter Tab) erzeugt keine zweite Welle (**[Claude]** Einmal-Schlüssel des Ablaufs).

---

## 11. Versandwelle

### 11.1 Anlegen

In einer Transaktion beim Bestätigen:

1. Vorlage mit `compileMail` kompilieren (Sprache `de`) und die **kompilierte Fassung an der Welle speichern** (Teilplan 3, Entscheidung 8). Spätere Änderungen an Vorlage, CD oder Layout ändern keine Welle mehr. Ein fehlender CD-Pflichtwert lässt die ganze Welle scheitern, bevor eine Mail entsteht.
2. Empfänger festhalten: ein Postausgangs-Eintrag pro Kontakt (persönlich) bzw. pro Adresse (Rundschreiben), jeweils mit Kontakt-ID, Kontaktschlüssel und Kontaktart; bei Rundschreiben zusätzlich die zusammengelegten Kontakte.
3. Aktivitätsprotokoll: Welle angelegt (Anlass, Zahl, Zeitpunkt; keine Namen oder Adressen).

### 11.2 Zusammenlegen (Rundschreiben)

Gruppiert nach normalisierter Adresse. **[Claude]** Erster Kontakt einer Adresse: Mitglieder vor Partnern, dann nach Mitglieds- bzw. Kundennummer (`compareCodePoints`), dann nach Kontakt-ID. Seine Werte füllen die Mail. Persönliche Anlässe legen nie zusammen.

### 11.3 Erneute Prüfung vor jedem Versand

Kurz vor dem Senden lädt der Postausgang den Kontakt neu und prüft: existiert noch, `isMailable` (Sperre, Adresse, Austritt), kein Widerspruch für Anlass oder Bereich, Adresse nicht als ungültig markiert. Sonst „übersprungen“ mit Grund. Bei einem zusammengelegten Eintrag rückt der nächste anschreibbare Kontakt der Adresse nach.

**[Claude] Geänderte Adresse** (ein Import zwischen Bestätigung und Versand): Ein persönlicher Eintrag geht an die aktuelle Adresse, denn die Mail gehört dem Kontakt. Ein Rundschreiben-Eintrag gehört seiner Adresse: Ein Kontakt, dessen Adresse sich geändert hat, fällt aus diesem Eintrag heraus (der nächste rückt nach, sonst „übersprungen“); er bekommt dieses Rundschreiben nicht an die neue Adresse. Lieber eine Mail zu wenig als zwei an eine Adresse oder eine an einen Haushalt, den er verlassen hat. Dann setzt `fillMail` die **aktuellen** Werte ein (Werte nach Bereich und Feldschutz, nicht nach Benutzer). Fehlt ein Pflichtwert: „fehlgeschlagen“ mit dem Schlüssel als Fehlercode, ohne Wert.

### 11.4 Stoppen

Wer `send` hat, stoppt eine Welle: alle „geplant“-Einträge werden „abgebrochen“; laufende Sendungen laufen zu Ende. Steht im Aktivitätsprotokoll.

---

## 12. Abmelden

- **Link** in jeder Mail eines Anlasses mit Abmeldelink: Das Standard-Layout zeigt ihn in der Fußzeile. Importiertes HTML (Vorlagen, eigene und globale Layouts) kann ihn mit **`{{unsubscribe.url}}`** selbst platzieren, als ganzen `href`-Wert. **[Claude]** Dafür bekommt die Typregel R25 des HTML-Imports eine Ausnahme: `unsubscribe.url` ist ein URL-Schlüssel wie die URL-Schlüssel des CD, ohne Ersatztext, nur als ganzer `href`.
- **[Claude] Platzhalter fehlt:** Verlangt der Anlass den Abmeldelink und enthält die Mail keinen `{{unsubscribe.url}}`, hängt die App eine kurze Zeile mit dem Link ans Ende der Mail (HTML vor `</body>` und Nur-Text). Eine Welle scheitert also nie an einem Layout, das nur ein Admin ändern könnte.
- **[Claude] Platzhalter da, Abmeldelink aus:** Enthält die Vorlage `{{unsubscribe.url}}`, der Anlass erlaubt aber keinen Abmeldelink (z. B. Rechnungen), lehnt das Bestätigen der Welle ab und nennt den Grund; ein toter Link geht nie raus.
- **Kopfzeilen:** `List-Unsubscribe` (die URL) und `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Die Ein-Klick-Abmeldung legt einen Widerspruch für den Anlass an, ohne Rückfrage.
- **Token:** **[Claude]** verschlüsselt und authentisiert (AES-GCM, Schlüssel per HKDF aus dem App-Secret, eigener Zweck), enthält nur Kontaktschlüssel und Kontaktart **aller Kontakte des Eintrags** (bei Rundschreiben die zusammengelegten), Anlass und Bereich, läuft nicht ab. Der Link verrät also keine Mitgliedsnummer, und ein erfundener Link wird abgelehnt. Er hängt nicht an der ID des Eintrags, damit er auch nach den Löschfristen (Teilplan 7) wirkt.
- **[Claude] Wer abgemeldet wird:** Bei einem zusammengelegten Rundschreiben gilt die Abmeldung für alle Kontakte dieser Mail – wer das gemeinsame Postfach liest, will diese Mails dort nicht mehr. Sonst bekäme der Haushalt das nächste Rundschreiben einfach an den nächsten Namen.
- **Seite** (öffentlich, ohne Anmeldung, zweisprachig nach Browser-Sprache **[Claude]**): zeigt Vereinsname, Anlass und Bereich, nie Namen oder Adressen. Zwei Wahlen (Entscheidung 6): „nur [Anlass]“ (vorausgewählt) oder „alle Mails aus [Bereich]“. Nach dem Absenden: Bestätigung und **[Claude]** „Rückgängig“ (30 Minuten gültig, nur auf dieser Seite). Ein Aufruf per GET verändert nie etwas.
- Der Widerspruch läuft über die Funktionen aus Teilplan 2 (Import-Sperre, `contact_key`), überlebt jeden Import und steht im Aktivitätsprotokoll (`auditTarget`, Akteur: Empfänger).

---

## 13. Rückläufer

- **Graph:** Ein Schritt der Zeitsteuerung liest in den Posteingängen der Graph-Absender neue Unzustellbarkeitsberichte (NDR) und ordnet sie über die Message-ID der Original-Mail einem Eintrag zu. Nur lesen, nichts verschieben oder löschen (Spec 6.6); verarbeitete Berichte merkt sich die App in der Datenbank, pro Lauf mit Grenze.
- **Resend:** Webhook (17) mit den Ereignissen für Rückläufer und Beschwerden; Zuordnung über die von Resend gelieferte ID des Eintrags.
- **[Claude] Nur harte Rückläufer** (Adresse existiert nicht, dauerhaft abgelehnt) setzen den Eintrag auf „zurückgewiesen“ und markieren den Kontakt mit **„E-Mail ungültig“** – bei Rundschreiben alle Kontakte des Eintrags, denn die Adresse ist für alle dieselbe. Weiche (Postfach voll, vorübergehend) landen nur im Versandprotokoll.
- **[Claude] Beschwerde** (Resend „als Spam markiert“): Widerspruch für den Bereich des Anlasses, für alle Kontakte des Eintrags.
- **Markierung „E-Mail ungültig“:** hängt an Kontaktschlüssel, Kontaktart und Adresse (wie Sperren getrennt gespeichert, Teilplan 2). Bringt ein Import eine andere Adresse, greift sie nicht mehr. Wer `edit` im Bereich der Welle bzw. im Mitglieder- oder Partner-Bereich hat, kann sie aufheben. Ein markierter Kontakt ist nicht anschreibbar (10.1, 11.3) und erscheint in Teilplan 5 in „bitte anders gratulieren“.
- **Hinweis an den Bereich:** Liste der Rückläufer in der Versandübersicht (16), Zahl in der Navigation.

---

## 14. Systemmails

- **Was:** Anmeldelink, Einladung, Warnung vor alten Daten (Teilplan 2), Warnung vor Secret-Ablauf, Störung einer Anbindung, Tageszusammenfassung fehlgeschlagener Mails (15).
- **Über den Absender für Systemmails** (7), direkt und nicht über den Postausgang, damit ein Anmeldelink nicht bis zum nächsten Lauf wartet; sie zählen zum Tageslimit (8.3).
- **Ohne Systemabsender** gehen keine Systemmails raus (außer lokal über `DEV_SMTP_URL`). Anmelden geht dann nur mit Einrichtungs-Token oder Microsoft-Konto. Die Admin-Startseite zeigt deutlich: „Noch kein Absender für Systemmails: Anmeldelinks und Einladungen gehen erst danach raus.“
- **CD-Layout mit Rückfall** (Entscheidung 5): Der Inhalt (Überschrift, Text, Button) ist im Code festgelegt und wird mit dem Standard-Layout des CD in der Sprache des Empfängers gerendert (`compileMail` mit `locale`). Scheitert das (fehlender CD-Pflichtwert, Fehler beim Rendern), geht automatisch die schlichte Fassung (Text und einfaches HTML ohne CD). **[Claude]** Globale Layouts gelten nicht für Systemmails. Die festen Texte des Standard-Layouts brauchen dafür eine englische Fassung.
- **Anmeldelinks** (Fahrplan, Teilplan 1):
  - **[Claude]** Höchstens 10 Anmeldelinks pro Adresse und Kalendertag (zusätzlich zum bestehenden Fenster von einer Minute); gezählt über einen HMAC der Adresse, wie das bestehende Fenster.
  - **Bestätigungsschritt:** Der Link in der Mail öffnet eine Seite der App mit dem Knopf „Anmelden“; erst das Absenden (POST) prüft und verbraucht das Token. Mail-Scanner, die Links per GET öffnen, entwerten ihn so nicht.
- **Einladung erneut senden:** Aktion in der Benutzerverwaltung für Benutzer mit Status „eingeladen“; **[Claude]** höchstens einmal pro Minute und Benutzer; steht im Aktivitätsprotokoll. Schlug der Versand einer Einladung fehl, zeigt die Liste das an.

---

## 15. Warnungen an die Admins

- **Ablauf des Graph-Secrets:** Hinweis in der Oberfläche für Admins ab 30 Tagen vorher (Spec 6.6); **[Claude]** Mails an die Admins 30, 14, 7 und 1 Tag vorher, jede Stufe einmal (idempotent über einen Merker).
- **Gestörte Anbindung:** 8.6.
- **[Claude] Fehlgeschlagene Mails:** höchstens eine Mail pro Tag an die Admins, wenn seit der letzten neue Einträge „fehlgeschlagen“ oder „unklar“ wurden, mit Zahlen pro Bereich und Absender, ohne Empfänger.
- Alle Warnungen laufen als Schritt der Zeitsteuerung. Das Dashboard (Spec 6.10) bleibt Teilplan 5.

---

## 16. Versandübersicht

- **[Claude] Seite „Versand“ pro Bereich** (ab `read`): Wellen mit Anlass, Zeitpunkt, Stand (geplant, läuft, fertig, gestoppt) und Zahlen pro Zustand; pro Welle die Einträge mit Empfänger (Basisfelder), Zustand und Fehlercode, ohne Mailinhalt; Liste der Rückläufer mit „Markierung aufheben“ (13); Aktionen „Welle stoppen“ und „unklaren Eintrag erneut senden“ ab `send`.
- **Admin-Seite „Absender“:** Anbindungen und Absender mit Zustand (in Ordnung, gestört, Secret läuft ab), heutigem Kontingent und Zahlen offener, unklarer und fehlgeschlagener Einträge – ohne Empfänger, denn die Admin-Rolle allein gibt keinen Zugriff auf Bereiche (Spec 6.7).

---

## 17. Sicherheit

- **Zugangsdaten** (Graph-Secret, Resend-Key, Webhook-Secret) verschlüsselt mit AES-GCM und **zugeordneten Daten (AAD)** pro gespeichertem Wert (Fahrplan, Teilplan 1): **[Claude]** AAD = Tabelle, Zeilen-ID und Feld, sodass ein kopierter Geheimtext in einer anderen Zeile oder einem anderen Feld nicht entschlüsselt. Bisher speichert die App keine verschlüsselten Werte; das neue Format gilt daher von Anfang an und ohne Migration (neue Token-Version).
- **Webhook von Resend:** eigener Endpunkt pro Anbindung; Signatur (Svix-Schema, HMAC-SHA256) mit WebCrypto geprüft, Zeitstempel höchstens 5 Minuten alt, jede Ereignis-ID nur einmal verarbeitet, nur POST, **[Claude]** Body höchstens 64 KB. Antwort ohne Details.
- **Öffentliche Endpunkte** (Abmeldeseite, Ein-Klick-Abmeldung, Webhook) liegen außerhalb der CSRF-Middleware der Server-Funktionen; sie prüfen stattdessen ihr Token bzw. ihre Signatur. Abmelde-Formulare der eigenen Seite tragen trotzdem einen Schutz gegen fremde Formulare (**[Claude]** Origin-Prüfung).
- **CSP:** neue Seiten bekommen die volle Richtlinie; keine Ausnahme nötig.
- **Logs und Fehlercodes:** nie Adressen, Tokens, Zugangsdaten oder Mailinhalte; Antworten der Anbieter nur als klassifizierter Code (`errorLabel`).
- **`DEV_PROVIDERS_URL`:** siehe 5.3; abgelehnt außerhalb lokaler Entwicklung.
- **Message-ID** enthält keine personenbezogenen Daten (zufällig, Domain des Absenders).

---

## 18. Rechte und Protokoll

| Aktion | Wer |
|---|---|
| Anbindungen, Absender, Systemabsender, Bereichsfreigaben | Admin |
| Anlass ansehen, Versandübersicht | `read` im Bereich |
| Anlass anlegen, ändern, archivieren; Markierung „E-Mail ungültig“ aufheben | `edit` im Bereich |
| Versenden, Testmail, Welle stoppen, unklaren Eintrag erneut senden | `send` im Bereich |
| Abmelden | Empfänger mit gültigem Token |

Aktivitätsprotokoll: Anbindung und Absender angelegt/geändert/gelöscht, Systemabsender gesetzt, Selbsttest (Ergebnis), Anlass angelegt/geändert/archiviert/gelöscht, Welle angelegt/gestoppt, Testmail, unklarer Eintrag erneut gesendet, Widerspruch per Abmeldeseite, Markierung aufgehoben, Einladung erneut gesendet. Immer mit `auditTarget` statt Namen oder Adressen.

---

## 19. Lieferung

Ein Design, zwei Pull Requests, jeder mit lauffähiger, getesteter Software und eigenem Changeset (`minor`):

- **4a – Anbindungen, Postausgang, Systemmails:**
  - Nachbau-Server und `DEV_PROVIDERS_URL`; Adapter für Graph und Resend; MIME-Aufbau.
  - AES-GCM mit AAD; Anbindungen und Absender (Admin) mit Bereichsfreigabe, Systemabsender, Selbsttest.
  - Postausgang mit Drosselung, Tageslimit, Vorrang, Reserve, Wiederholung, „unklar“, gestörter Anbindung, Selbst-Anstoß (getestet über Einträge, die Tests anlegen).
  - Systemmails über den echten Absender im CD-Layout mit Rückfall; Anmeldelink-Tageslimit und Bestätigungsseite; „Einladung erneut senden“; Warnungen (Secret-Ablauf, Störung, Tageszusammenfassung).
- **4b – Anlass und manueller Versand:**
  - Anlass mit Art und Abmeldelink; Sperre für Vorlagen in Benutzung.
  - Manueller Versand mit Empfängern, Anhängen, Vorschau, Testmail, Bestätigen (sofort/geplant); Welle mit kompilierter Fassung, Zusammenlegen, erneuter Prüfung, Stoppen.
  - Abmelden (Seite, Kopfzeilen, Token, `{{unsubscribe.url}}`); Rückläufer (Graph-Abruf, Resend-Webhook, Markierung); Versandübersicht.

README, AGENTS und CONTRIBUTING werden in jedem PR mitgezogen (neue Variablen, Nachbau-Server, öffentliche Endpunkte, Regeln für Postausgang und Zugangsdaten). E2E bekommt ein neues Playwright-Projekt **`sending`** (abhängig von `templates`).

---

## 20. Nacharbeit, die Teilplan 4 aufgreift

- **Aus Teilplan 1:** Tageslimit pro Adresse für Anmeldelinks; Bestätigungsschritt für Anmeldelinks; AES-GCM mit AAD; fehlgeschlagene Einladungen erneut senden (14, 17).
- **Aus Teilplan 3:** kompilierte Fassung pro Welle (11.1); fehlender CD-Pflichtwert lässt die Welle scheitern, fehlender Kontakt-Pflichtwert nur die Mail (11); Löschen von Vorlagen in Benutzung gesperrt (9); Systemmails im CD-Layout entschieden (14); Testmail an sich selbst (10.4); Abmeldelink als Platzhalter (12).
- **Aus Teilplan 2:** Die Warn-Mail bei alten Daten geht über den Systemabsender. **[Claude]** Teilplan 4 greift dabei die Nacharbeit „schlägt das Protokoll nach dem Versand fehl, bleibt die Woche beansprucht“ auf und ergänzt den PostgreSQL-Test „Teilfehler beim Versand (eine von zwei Mails)“.

---

## 21. Änderungen an Spec und Fahrplan

Im selben Schritt wie dieses Design:

- **Spec 5:** Anlass mit Art (persönlich/Rundschreiben) und Abmeldelink; Anbindung als eigenes Objekt; Absender mit Bereichsfreigabe und Systemabsender; Zustände des Postausgangs um „übersprungen“, „abgebrochen“ und „unklar“ ergänzt; Markierung „E-Mail ungültig“.
- **Spec 6.4:** Zusammenlegen über die Art des Anlasses; Testmail mit den Werten des Vorschau-Kontakts; Anhänge (Typen, Grenzen).
- **Spec 6.6:** Graph-Versand über MIME mit nur `Mail.Send` und `Mail.Read`; „Anhänge über 3 MB über eine Upload-Session“ entfällt, über Graph sind Anhänge auf rund 2 MB pro Mail begrenzt (6.4); Systemmails ohne Ablage in „Gesendete Elemente“; Abmeldeseite mit Wahl Anlass/Bereich; nur harte Rückläufer markieren; Systemmails über den Systemabsender im CD-Layout; Wiederholung und „unklar“.
- **Spec 6.7:** Absender pro Bereich freigegeben.
- **Fahrplan:** Teilplan 4 in zwei PRs (4a, 4b); die Pflichtpunkte aus Teilplan 1 und 3 als erledigt markieren, sobald gemergt; für Teilplan 5: Datumsregel als zweiter Auslöser des Anlasses, persönliche Art, Dashboard zeigt „unklar“, „fehlgeschlagen“ und Rückläufer; für Teilplan 6: Rechnung erzwingt Abmeldelink „aus“ und nutzt die Anhänge; für Teilplan 7: Löschfristen für Postausgang, Anhänge, verarbeitete Rückläufer- und Webhook-IDs; für Teilplan 8: Anleitung zu RBAC for Applications, Secret-Ablauf, Resend-Key und Webhook.

---

## 22. Tests (Pflicht)

- **Unit:**
  - Adapter Graph und Resend gegen eingespeistes `fetch`: Anfrageform, Token, Fehlerklassen (6.3), `Retry-After`, Idempotenz-Schlüssel.
  - MIME-Aufbau: Kopfzeilen (`List-Unsubscribe`, `Message-ID`, Antwortadresse), Kodierung von Umlauten in Betreff und Anzeigename, Nur-Text und HTML, Anhänge.
  - Postausgang: Zustandsfolge, Drosselung, Tageslimit mit Vorrang und Reserve (Grenzfälle um Mitternacht in Europe/Berlin, Sommerzeit), Wiederholung, „unklar“, gestörte Anbindung.
  - Zusammenlegen (Reihenfolge, Mitglied und Partner an einer Adresse), erneute Prüfung vor dem Versand (jeder Ausschlussgrund, Nachrücken).
  - AES-GCM mit AAD (vertauschte Zeile/Feld schlägt fehl), Abmelde-Token (manipuliert, fremder Schlüssel), Webhook-Signatur (falsch, zu alt, doppelt).
  - Systemmail im CD-Layout und Rückfall; Anmeldelink-Tageslimit.
  - NDR-Auswertung (hart/weich) mit erfundenen Beispielen.
- **Datenbank (PGlite):** Rechte pro Aktion (Tabelle in 18, Admin ohne Bereichsrecht sieht keine Empfänger); Bereichsfreigabe; Löschsperren (Vorlage, Absender, Anbindung); Welle mit kompilierter Fassung bleibt bei späterer Vorlagenänderung gleich; Widerspruch per Abmeldung überlebt Import; Markierung „E-Mail ungültig“ fällt bei neuer Adresse weg.
- **PostgreSQL (`*.postgres.test.ts`):** zwei gleichzeitige Läufe senden keinen Eintrag doppelt; Bestätigen zweimal gleichzeitig legt eine Welle an; Teilfehler beim Versand der Warn-Mail (20).
- **E2E (Projekt `sending`, gegen Nachbau-Server und Mailpit):**
  - Admin legt Graph-Anbindung an (Selbsttest mit Beschränkungstest), Absender mit Bereichsfreigabe, setzt den Systemabsender; ein Anmeldelink kommt über Graph in Mailpit an; die Bestätigungsseite meldet an, ein bloßer GET nicht.
  - Einladung erneut senden.
  - Rundschreiben: Anlass anlegen, Empfänger filtern, Anhang hochladen, Vorschau, Testmail in Mailpit, Bestätigen; eine Mail pro Adresse in Mailpit, mit `List-Unsubscribe`.
  - Abmelden über den Link: Bereich wählen, Rückgängig, erneut abmelden; die nächste Welle schließt den Kontakt aus.
  - Tageslimit mit Vorrang: kleines Limit, Rundschreiben und persönliche Mails; persönliche gehen zuerst (Läufe der Zeitsteuerung im Test angestoßen).
  - Rückläufer: Nachbau legt einen NDR ab bzw. schickt einen Resend-Webhook; Eintrag „zurückgewiesen“, Kontakt markiert, Markierung aufheben.
  - Welle stoppen.
  - axe auf allen neuen Seiten und Dialogen; die CSP-Fixture sieht keine Verletzung, auch nicht auf der öffentlichen Abmeldeseite.

---

## 23. Dem Builder überlassen

- Datenbankschema im Detail (Tabellen für Anbindungen, Absender, Freigaben, Anlässe, Wellen, Anhänge, Einträge, Tageszähler, verarbeitete Berichte und Webhook-IDs, Markierungen).
- MIME-Bibliothek oder eigener Baustein (Workers-tauglich, ohne `eval`, Catalog, neueste Version).
- Paketgrößen und Wartezeiten innerhalb der Plattformgrenzen (Unteranfragen auf Workers, Funktionsdauer auf Vercel); Budget des „Sofort“-Laufs.
- Form der Message-ID; ob Exchange sie bei MIME-Versand behält, prüft die Abnahme mit echtem Tenant – sonst Zuordnung der NDRs über eine eigene `X-`-Kopfzeile, die Exchange im NDR mitliefert.
- Wie NDRs im Graph-Posteingang gefunden werden (z. B. Nachrichtenklasse über eine erweiterte Eigenschaft) und wie die Original-Message-ID aus dem Bericht gelesen wird.
- Endpunkte und Port des Nachbau-Servers, wie Playwright ihn startet, und wie Tests ihn steuern.
- Routen und Seitenaufbau (Ablauf des manuellen Versands als Schritte auf einer Seite oder als Unterseiten), Seitengrößen, Sortierung.
- Standard-Drosselung für Resend nach aktueller Doku.
- Texte der Systemmails (de/en).

---

## 24. [Claude]-Entscheidungen zur Prüfung

1. Anbindungen und Absender verwaltet nur der Admin; Ablaufdatum des Secrets von Hand.
2. Beschränkungstest mit einer vom Admin genannten Adresse; Ergebnis „verboten“, „lesbar“ (Warnung) oder „nicht prüfbar“.
3. Resend: Key mit „Sending access“ empfohlen; keine eigene Domain-Prüfung.
4. Drosselung über die Grenze der Unteranfragen auf Workers bemessen.
5. Wiederholung: 5 Versuche, Wartezeiten 5 min / 30 min / 2 h / 8 h.
6. „Unklar“ nach 10 Minuten „in Versand“, erneutes Senden nur von Hand.
7. Gestörte Anbindung: Einträge warten ohne Versuche, eine Prüfung pro Lauf.
8. „Sofort“ mit kurzem Hintergrund-Lauf; „geplant“ höchstens ein Jahr voraus.
9. Abmeldelink vorbelegt: an bei Rundschreiben, aus bei persönlich.
10. Anlass mit Wellen wird archiviert statt gelöscht.
11. Anhänge: PDF, JPEG, PNG; höchstens 5 Dateien, 4 MB pro Datei, 20 MB pro Mail; verwaiste Anhänge nach einem Tag weg.
12. Testmail: Vorsatz „[Test]“, wirkungsloser Abmeldelink, höchstens 20 pro Stunde.
13. Einmal-Schlüssel gegen doppeltes Bestätigen.
14. Reihenfolge beim Zusammenlegen: Mitglieder vor Partnern, dann Nummer, dann ID.
15. R25-Ausnahme für `{{unsubscribe.url}}`.
16. Abmelde-Token verschlüsselt, ohne Ablauf; Seite in Browser-Sprache; „Rückgängig“ 30 Minuten.
17. Nur harte Rückläufer markieren; Beschwerde = Widerspruch für den Bereich.
18. Globale Layouts gelten nicht für Systemmails; Standard-Layout bekommt englische Festtexte.
19. Höchstens 10 Anmeldelinks pro Adresse und Tag; „Einladung erneut senden“ höchstens einmal pro Minute.
20. Secret-Warnmails 30/14/7/1 Tage vorher; Tageszusammenfassung fehlgeschlagener Mails.
21. Versandübersicht pro Bereich; Admin-Seite ohne Empfänger.
22. AAD = Tabelle, Zeilen-ID, Feld; neue Token-Version ohne Migration.
23. Webhook-Body höchstens 64 KB; Origin-Prüfung für die Formulare der Abmeldeseite.
24. Warn-Mail bei alten Daten: Nacharbeit aus Teilplan 2 mit aufgegriffen.
25. Systemmails über Graph als JSON mit `saveToSentItems: false`, bei Resend ohne Archiv-Kopie (Anmeldelinks nicht im Postfach).
26. Resend: Drosselung und Tageslimit an der Anbindung; erschöpftes Kontingent wartet bis zum nächsten Tag.
27. Anlässe sind auf Dauer angelegt, jede Veranstaltung ist eine Welle.
28. Geänderte Adresse: persönliche Mail folgt der neuen Adresse, Rundschreiben-Eintrag bleibt bei seiner Adresse.
29. Abmeldung, harter Rückläufer und Beschwerde gelten für alle Kontakte eines zusammengelegten Eintrags.
30. Fehlt `{{unsubscribe.url}}`, hängt die App eine Zeile an; ist er da, aber der Abmeldelink aus, lehnt das Bestätigen ab.
