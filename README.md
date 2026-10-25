# Fieldtest

Tester-Service für Prototypen: Ein Script im Prototyp zeigt eingeladenen Testern ein Overlay, belohnt aktive Zeit, neue Screens und erreichte Ziele sofort mit Sats und nimmt Feedback auf, das an der Stelle in der App hängt. Fieldtest bündelt die Meldungen zu Findings, bewertet sie (optional mit Claude) und schlägt Lösungen vor. Ausgezahlt wird aus der Wallet des Owners: Ein Runner auf dessen Rechner zahlt per Nostr Wallet Connect und meldet den Beleg zurück. Fieldtest verwahrt kein Geld und keine Wallet-Zugänge.

Gebaut aus `robinchoice/starter`: Bun, Hono, SvelteKit, Drizzle, Postgres. Gestaltung nach DESIGN.md, Farbband-Ausschnitt 3,20–3,85.

## Lokal starten

```sh
cp .env.example .env
docker compose up -d          # Postgres auf Port 5437
bun install
bunx playwright install chromium   # einmalig, für den Browser-Test
bun run dev
```

Web läuft auf http://localhost:5173, die API auf Port 3000. Ohne `SMTP_HOST` stehen die Login-Links im API-Log. In Produktion startet die API ohne `SMTP_HOST` nicht, sonst könnte jeder mit Zugriff auf die Logs sich als beliebiger Nutzer anmelden.

**Ausprobieren:** Nach dem Login „Mit dem Demo-Prototyp ausprobieren“ wählen. Das legt eine Runde für den Pebble-Demo-Prototyp unter `/demo/pebble.html` an. Den Einladungslink aus der Einrichtung in einem zweiten Fenster öffnen, testen, auf dem Backup-Screen dreimal auf „Continue“ tippen (der eingebaute Fehler) und das Finding im Dashboard bewerten.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `apps/api` | Hono-API unter `/api/v1`: Runden (`routes/rounds.ts`), Overlay (`routes/sdk.ts`), Runner (`routes/runner.ts`), geteilte Berichte (`routes/reports.ts`) |
| `apps/api/src/lib` | Live-Belohnungen (`sessions.ts`), Claims und Reputation (`claims.ts`), Zahlungsbelege (`payments.ts`), KI-Bewertung (`evaluate.ts`, läuft im Worker `apps/api/src/worker.ts`) |
| `apps/web` | Dashboard für Owner, geteilte Berichte unter `/r/<token>`, Demo-Prototyp unter `static/demo`, `/health` ist der Healthcheck des Web-Servers |
| `apps/runner` | Auszahlungs-Runner für den Rechner des Owners |
| `apps/cli` | Befehlszeile gegen dieselbe API, siehe „CLI“ |
| `packages/sdk` | Tester-Overlay, die API liefert es gebündelt unter `/api/v1/sdk/overlay.js` aus |
| `packages/db` | Drizzle-Schema und Migrationen |
| `packages/shared` | Name, Farbband, zod-Schemas, Texte auf Deutsch und Englisch (`messages.ts`) für API, Web und CLI |

Befehle: `bun run dev`, `check` (Biome und Typen), `format`, `test`, `build`, `db:generate`, in `apps/web` außerdem `og-image` (Vorschaubild für geteilte Links, DESIGN.md). `build` baut Web und CLI, `test` umfasst auch die CLI-Tests. Die Browser-Tests in `test` bauen das Web und starten API und Web-Build selbst auf eigenen Ports 31100 und 31101, nie die laufenden Dev-Server, so greift die CSP wie in Produktion; testen zwei Worktrees gleichzeitig, bekommt einer andere per `TEST_API_PORT` und `TEST_WEB_PORT`, etwa 31102 und 31103. Testports bleiben unter dem ephemeren Linux-Portbereich (32768–60999), damit ausgehende Verbindungen sie nicht kurzzeitig belegen. API- und Browser-Tests bekommen über `bun run test` jeweils eine eigene leere Datenbank auf dem Server aus `DATABASE_URL`. Die Browser-Tests übernehmen aus `.env` nur `DATABASE_URL`, SMTP und der Claude-Schlüssel bleiben aus den Testservern. Der Datenbanknutzer braucht dafür `CREATEDB` (der lokale Compose- und der CI-Nutzer haben es bereits). Nach Erfolg, Fehler oder Abbruch per SIGINT/SIGTERM wird nur diese temporäre Datenbank gelöscht; die vorhandene Datenbank bleibt unverändert. Auch `bun run test` in `apps/api` bzw. `apps/web` nutzt diese Isolation; direkte Aufrufe von `bun test` oder `playwright test` umgehen sie.

## Secret-Scan

Das Repo ist öffentlich, Code, Historie und CI-Logs. Der Workflow `.github/workflows/secrets.yml` läuft bei jedem Push auf jedem Branch und bei PRs aus Forks, ohne `paths-ignore`, und scannt mit gitleaks (Docker-Image, Version per Digest fest) die neuen Commits. Ein Fund macht den Lauf rot, der Wert steht dank `--redact` nicht im Log.

- Regeln: die Standardregeln von gitleaks, dazu `.gitleaks.toml`. Die nimmt nur `generic-api-key` in `bun.lock` aus, dort schlagen Hashes von Fremdcode an. Echte Token-Formate (`ghp_…`, `sk_live_…`) fallen dort weiter auf.
- Fehlalarm: den `Fingerprint` aus dem Log als Zeile in `.gitleaksignore` eintragen.
- Echter Fund: Der Scan läuft erst nach dem Push, das Secret ist also schon öffentlich. Sofort rotieren, Entfernen aus dem Code oder der Historie reicht nicht.

## So läuft eine Runde

1. Der Owner legt eine Runde an und bindet das Overlay einmal in den Prototyp ein: `<script src="https://<fieldtest>/api/v1/sdk/overlay.js" async></script>`. Ohne Einladungslink bleibt es unsichtbar. Prototypen ohne eigene URL pro Screen melden Screens und Ziele mit `Fieldtest.screen('Backup')` und `Fieldtest.goal('Back up your wallet')`.
2. Tester öffnen den Einladungslink (`<prototyp>?fieldtest=<token>`), geben ihre Lightning-Adresse an und testen. Konten gibt es für Tester nicht.
3. **Live-Belohnungen** vergibt die API, nicht das Overlay: aktive Minuten (höchstens so viele, wie seit dem Start vergangen sind), erste Besuche von Screens und die Ziele der Runde, alles bis zum Deckel pro Session. Sie sammeln sich in einem freigegebenen Claim, bis der Runner ihn abholt.
4. **Meldungen** werden zu Findings. Mit `ANTHROPIC_API_KEY` bewertet Claude jede Meldung: Duplikat eines bekannten Findings, Schwere, und ob die aufgezeichnete Session sie stützt. Gestützte Probleme gelten als angenommen und zahlen aus. Ideen und nicht gestützte Meldungen warten auf den Owner. Ohne Key bewertet und führt der Owner von Hand zusammen.
5. **Claims:** Die Erstmeldung bekommt den Betrag ihrer Schwere mal Reputation (neu 0,5×, ab 3 freigegebenen Sessions 1×, ab 10 1,25×), die nächsten fünf Tester eine Bestätigung. Bis zur Grenze `autoApprove` sind Claims sofort freigegeben, solange die Funde eines Testers in der Runde zusammen unter `autoApproveTester` bleiben. Darüber entscheidet der Owner, so hängt Geld nie allein am Urteil der KI. Nach 48 Stunden geben sie sich selbst frei.
6. **Runner:** holt freigegebene Claims, holt per LNURL-pay eine Rechnung von der Lightning-Adresse, zahlt sie über die Wallet des Owners und schickt Rechnung und Preimage zurück. Die API prüft, dass das Preimage zur Rechnung passt und die Rechnung auf den Betrag lautet.

## Runner

Der Owner erzeugt in der Einrichtung einen Runner-Schlüssel und startet den Runner dort, wo seine Wallet erreichbar ist:

```sh
FIELDTEST_URL=https://<fieldtest> \
FIELDTEST_KEY=ft_… \
NWC_URL="nostr+walletconnect://…" \
bun run --filter @app/runner start
```

Optional: `MAX_PER_CLAIM` (Standard 10.000 Sats), `MAX_PER_TESTER_DAY` (50.000), `POLL_SECONDS` (10). Die harte Grenze ist das Budget der Wallet-Verbindung, das der Owner in seiner Wallet setzt (z. B. Alby Hub). Testmodus ohne Wallet: `DRY_RUN=1`, die API nimmt die erfundenen Belege nur mit `ALLOW_FAKE_PAYMENTS=1` an (steht in `.env.example`, nie in Produktion).

Der Runner ruft nur öffentliche Hostnamen auf, damit eine präparierte Lightning-Adresse ihn nicht ins Netz des Owners lenken kann.

## Update-Mails

Nutzer mit Konto (Owner, nicht die Testpersonen einer Runde) bekommen neue Funktionen per Mail, wenn sie es wollen. Gespeichert wird alles in der Datenbank der App, verschickt über das SMTP aus `lib/mail.ts`.

- Opt-in: Standard ist aus. Unter dem Login-Formular steht eine nicht vorausgewählte Checkbox, sie gilt erst, wenn der Login-Link oder Code eingelöst wird. Das ist zugleich das Double-Opt-in. Geschaltet wird jederzeit unter `/settings`. `users.updates_consent_at` hält den Zeitpunkt der Einwilligung als Nachweis, `users.locale` die Sprache der Mails.
- Abmelden: Jede Update-Mail hat einen Link auf `/unsubscribe?token=…`, der ohne Login abbestellt, dazu `List-Unsubscribe` und `List-Unsubscribe-Post` für One-Click im Mail-Programm. Der Token steht pro Konto in `users.unsubscribe_token`.
- Entwürfe schreiben Agenten als `updates/<datum>-<thema>.md`, etwa aus den Commits seit der letzten Datei dort. Je Sprache eine Überschrift `# de: Titel` bzw. `# en: Titel`, darunter die Features als Liste `- …`, optional ein Bild `![](bild.png)` neben der Datei (PNG oder JPEG). Die API legt jede Datei beim Start einmal als Entwurf an und überschreibt ihn danach nie. `bun run test` prüft alle Dateien.
- Senden: `/admin/updates`, nur für `ADMIN_EMAILS`, also nie für admin@pleasance.org. Dort Entwürfe bearbeiten oder neu anlegen, Vorschau je Sprache, „Testmail an mich“ in beiden Sprachen, dann „An … Abonnenten senden“. Den Versand löst nur Robin aus, denn das ist eine Mail in seinem Namen an Dritte. Versendete Updates bleiben mit Datum und Zahlen stehen und lassen sich nicht mehr ändern.
- Versand: Pro Empfänger entsteht eine Zeile in `update_deliveries`. Der Service `worker` (`apps/api/src/worker.ts`) schickt sie gedrosselt, alle `UPDATE_MAIL_INTERVAL_MS` (Standard 6 s) eine Mail, mit drei Versuchen und einer Minute Pause nach einem Fehler. Wer zwischendurch abbestellt, wird übersprungen. Fehler stehen mit Update- und Zustell-ID im Log, ohne Adresse. Lokal: `bun run worker` in `apps/api`.
- Design: Die Vorlage in `lib/mail.ts` gilt für alle Mails der App, auch den Login-Link (DESIGN.md, „Mails“).

## Für Agenten

Fremde Agenten lesen die öffentlichen Inhalte ohne HTML, nach [llms.txt](https://llmstxt.org). Quelle ist `publicPages` in `apps/api/src/lib/public-pages.ts`, die Routen stehen in `apps/api/src/routes/agents.ts`. Der Web-Server leitet die Pfade an die API weiter.

- `/llms.txt`: Einstieg mit Name, Tagline und allen öffentlichen Seiten als Links auf ihr Markdown.
- `/llms-full.txt`: alle Seiten in einer Datei.
- `<seite>.md`: jede Seite als Markdown, die Startseite als `/index.md`. Fragt ein Agent mit `Accept: text/markdown` nach einer Seite, die es als Markdown gibt, bekommt er unter derselben URL gleich das Markdown, alle anderen das HTML.
- Sprache: `?lang=de|en`, sonst `Accept-Language`, sonst Deutsch. Links behalten ein `?lang=`.
- Nur öffentliche Inhalte. Geteilte Berichte unter `/r/<token>` gehören nicht dazu, sie sind nur mit dem Link erreichbar.
- Ausprobieren: `curl localhost:5173/llms.txt` bei laufendem `bun run dev`.

## Deploy auf Coolify

Wie im Starter: Ressource aus dem Repo, Build Pack „Docker Compose“ mit `docker-compose.prod.yml`, Domain nur beim Service `web`, Variablen aus `.env.production.example`. `ANTHROPIC_API_KEY` ist optional und geht nur an den Service `worker`. Die CI baut die Images bei grünem Push auf `main`, für den Deploy braucht sie die Secrets `COOLIFY_TOKEN` und `COOLIFY_UUID`. Der Deploy gilt erst als fertig, wenn `/api/health` unter der öffentlichen URL den neuen Commit als `revision` meldet. Die URL ist `https://fieldtest.pleasance.org`, eine eigene Domain kommt als Repo-Variable `API_URL`.

### Stoppen und weitere Instanzen

API und Worker behandeln `SIGTERM` und `SIGINT`: Die API nimmt keine neuen Verbindungen an und wartet auf laufende Antworten, der Worker holt keine weiteren Aufträge und beendet die laufende Zustellung samt Transaktion. Laufende Claude-Aufrufe bricht er ab und gibt deren Auftrag sofort wieder frei, ohne einen Versuch zu zählen. Danach schließen sie den Postgres-Pool. Auch während des API-Starts wartet der Shutdown auf Migration und Import. Compose lässt dafür 30 Sekunden Zeit (`stop_grace_period`), erst danach erzwingt Docker den Abbruch. SMTP hat dafür begrenzte DNS-, Verbindungs- und Begrüßungswartezeiten (je 5 s) sowie 10 s für einen inaktiven Socket. Das ist keine Obergrenze für die gesamte Zustellung; ein langsamer, weiter antwortender Server oder eine lange Datenbankabfrage kann das Shutdown-Budget weiterhin überschreiten.

Zuerst Apps auf mehrere Server verteilen, erst bei Bedarf eine einzelne App replizieren (`infra.md`, „Skalierung“). Der Compose-Standard bleibt eine App mit lokalem Postgres. Eine weitere Instanz verwendet dieselbe Datenbank über das private Netz. Dafür neben `docker-compose.prod.yml` eine lokale, nicht eingecheckte Datei `compose.replica.yml` anlegen (Compose mit Unterstützung für `!reset`):

```yaml
services:
  api:
    environment:
      - DATABASE_URL=${DATABASE_URL:?Shared database URL is required}
    depends_on: !reset {}
  worker:
    environment:
      - DATABASE_URL=${DATABASE_URL:?Shared database URL is required}
```

`DATABASE_URL` in der Env dieser Instanz auf die gemeinsame Datenbank setzen und mit `docker compose -f docker-compose.prod.yml -f compose.replica.yml up -d web api worker` starten. Damit startet dort kein Postgres; der Worker wartet weiterhin auf die gesunde API. Alle Instanzen brauchen dieselbe App-Konfiguration und denselben Stand. Datenbankzugriff nur aus dem privaten Netz der App-Server erlauben, nicht öffentlich freigeben. Den Override auch bei späteren Deploys verwenden; die Standard-CI richtet diese Topologie nicht automatisch ein.

Die Client-IP für Rate-Limits ist der letzte Eintrag in `X-Forwarded-For`. Hinter einem einzelnen Proxy ist das dessen Gegenstelle. Bei Hetzner-LB → Traefik → Web reicht `forwardedHeaders.trustedIPs` allein nicht: Ohne Vertrauen verwirft Traefik den vom LB gesetzten Header; mit Vertrauen bleibt er erhalten, aber Traefik hängt standardmäßig die LB-IP an. Dann teilen sich alle Clients die IP-Limits. Vor dieser Topologie die ganze Header-Kette mit zwei verschiedenen Client-IPs und einem gefälschten Header prüfen. Am API-Eingang muss der letzte Eintrag die echte Client-IP sein. Bei Traefik-Versionen mit `forwardedHeaders.notAppendXForwardedFor` kann ein eigener, nur vom LB erreichbarer EntryPoint den Header unverändert weitergeben; `trustedIPs` dabei auf die tatsächlichen LB-Adressen begrenzen. Niemals pauschal dem ersten Header-Eintrag oder allen Absendern vertrauen.

## Registrierung öffnen

Fieldtest ist von außen erreichbar, aber geschlossen, bis Robin ausdrücklich das Go gibt, externe Nutzer aufzunehmen. Bis dahin legen Magic Link und App-Code neue Konten nur für die Adressen in `SIGNUP_ALLOWLIST` an (kommagetrennt, dauerhafte Adressen wie Robins). Bestehende Konten melden sich immer an, Passkeys gibt es nur für sie. Fremde bekommen bei `/auth/magic-link` und `/auth/code` die Meldung „Die Registrierung ist noch geschlossen“, es geht keine Mail raus. Auch beim Einlösen von Links und Codes wird die aktuelle Freigabe geprüft: Eine inzwischen entfernte Adresse ohne Konto bekommt 403, selbst wenn der Link oder Code vorher verschickt wurde. Dieselbe Prüfung gilt zentral vor jeder Session-Erstellung, auch für Passkeys. Seiten ohne Login bleiben offen: geteilte Berichte, der Demo-Prototyp und alles, was Testpersonen einer Runde über deren Einladungslink und das Overlay tun. Testpersonen haben kein Konto, sie hängen an ihrer Lightning-Adresse.

- Tester aufnehmen: Ein Admin klickt in der App oben auf „Tester einladen“ (`/invite`) und gibt die Adresse ein. Das legt das Konto an und schickt einen Login-Link, ohne Coolify und Redeploy. Danach meldet sich der Tester wie jedes bestehende Konto an, auch wenn der Link abläuft. Admins sind die Adressen in `ADMIN_EMAILS` (kommagetrennt, Standard robin@pleasance.org, der menschliche Admin), die API prüft das. Einladen öffnet nichts, `SIGNUP_OPEN` bleibt, wie es ist.
- admin@pleasance.org, der agentische Admin, kommt nie in `ADMIN_EMAILS`: Agenten melden sich damit in der Vorschau an und dürfen weder Konten an der Registrierung vorbei anlegen noch Dritte anmailen.
- Öffnen, erst nach Robins Go: `SIGNUP_OPEN=true` in Coolify setzen und neu deployen. Prüfen: Login-Link an eine neue Adresse anfordern.
- `login-link` legt Konten selbst an, das Testkonto der Savor-Vorschau braucht keinen Eintrag.

## Login in der Savor-Vorschau

Agenten zeigen Änderungen hinter dem Login in der Savor-Vorschau mit dem Testkonto admin@pleasance.org, dem agentischen Admin. Admin-Rechte in der App hat es nicht (siehe „Registrierung öffnen“). `login-link <slug>` aus dem Kontor ruft dafür im API-Container `bun apps/api/src/login-link.ts <email>` auf. Das gibt einen einmaligen Login-Link aus, 15 Minuten gültig wie ein gemailter, den der Agent per `browser_navigate` öffnet. Die Vorschau hat pro Projekt ein festes Profil, und Sessions in Benutzung verlängern sich höchstens einmal am Tag auf 365 Tage. Also bleibt sie angemeldet. Für die CLI nimmt der Agent denselben Link per Pipe, siehe „CLI“.

## CLI

Fieldtest hat eine eigene Befehlszeile in `apps/cli`, damit Agenten, Skripte und Tests die App über Befehle bedienen statt über die UI. Sie spricht nur mit der HTTP-API wie das Web, nie mit der Datenbank. So gelten dieselben Rechte, Rate-Limits und die geschlossene Registrierung. Die Argumente liest `parseArgs` aus `node:util`, ohne weitere Abhängigkeit. Mit dem Auszahlungs-Runner (`apps/runner`) hat sie nichts zu tun.

- Bauen: `bun run build` kompiliert `apps/cli/build/fieldtest`, eine einzelne Datei mit Bun darin (gut 100 MB). Der Name kommt aus `APP_ID` in `packages/shared`. Die Adresse der App ist eingebacken: `APP_URL` aus der Umgebung beim Bauen, sonst die Live-URL `https://fieldtest.pleasance.org`. `--url` wählt eine andere, etwa `http://localhost:5173` gegen `bun run dev`, danach gilt die Adresse des letzten Logins. Ohne Bauen: `bun apps/cli/src/main.ts <befehl>`.
- Anmelden: `fieldtest login` fragt nach der Adresse, löst die ALTCHA-Aufgabe selbst und fragt nach dem Code aus der Mail. `fieldtest login --link <link>` löst einen Login-Link ein, `--link -` liest ihn von stdin. Danach liegt der Token dieses Geräts mit `0600` in `$XDG_CONFIG_HOME/fieldtest/session.json` (sonst `~/.config`, unter macOS `~/Library/Application Support`, unter Windows `%APPDATA%`), zusammen mit der Adresse, an andere Adressen geht er nie. Er ist eine gewöhnliche Session als Bearer: gehasht in `sessions`, 365 Tage, jedes Gerät hat seine eigene. `whoami` zeigt das Konto, `logout` widerruft den Token auf dem Server und löscht die Datei, ein neuer Login widerruft den alten.
- Befehle für die Sache selbst: `rounds` zeigt die Testrunden des angemeldeten Owners mit Sessions und Findings.
- Ausgabe: Text für Menschen, mit `--json` genau ein JSON-Wert auf stdout, auch Fehler als `{ "error": "…" }` und die Hilfe als Liste der Befehle. Exit-Codes: 0 erledigt, 1 Fehler (auch Absagen der API wie die geschlossene Registrierung), 2 falscher Aufruf, 3 nicht angemeldet. Hilfe und Meldungen stehen als `cli…` in `packages/shared/src/messages.ts`, die Sprache kommt aus `LANG` oder `--lang`, die API antwortet per `Accept-Language` in derselben.
- Eigene Befehle: Datei in `apps/cli/src/commands` nach dem Beispiel `rounds.ts` und in `commands` in `src/cli.ts` eintragen. Ein Befehl nennt Hilfezeilen, Optionen und `run`. Das ruft über `ctx.api` die API auf, liest die Antwort mit zod und gibt `{ data, text }` zurück, `data` für `--json`. Fehler enden als `Failure` mit einem Code aus `EXIT`. Die Tests in `src/cli.test.ts` rufen die CLI im Prozess gegen die echte API mit der Testdatenbank auf.
- Agenten: nur mit dem Testkonto admin@pleasance.org, nie mit Kundenkonten. Den Token holen sie ohne Container über den Login-Link aus dem Kontor, per Pipe, so steht der Link nicht in ihrem Kontext: `login-link fieldtest | apps/cli/build/fieldtest login --link -`. Danach bleibt die CLI auf diesem Rechner angemeldet.
- Verteilen: Für andere Plattformen `bun run build --target=bun-darwin-arm64` in `apps/cli` (ebenso `bun-linux-x64`, `bun-linux-arm64`, `bun-windows-x64`), das überschreibt `build/fieldtest`. Die CI baut die Datei bei jedem Lauf zur Probe, veröffentlicht sie aber nicht. Release-Artefakte erst, wenn die CLI an Menschen außerhalb des Repos geht.

## Bewusst offen

- Das Overlay bringt seine Styles als `<style>` im Shadow DOM mit. Prototypen mit strenger CSP müssen `style-src 'unsafe-inline'` erlauben, sonst bleibt das Overlay ungestylt.
- Der Runner läuft aus dem Repo, ein eigenes Image dafür baut die CI noch nicht.
- Rechtlich: Fieldtest verwahrt nichts und überweist nicht selbst. Ob das Runner-Modell ohne MiCA-Erlaubnis auskommt, sollte die BaFin bestätigen (Fintech-Kontaktformular, Frage nach Erlaubnispflicht).

## ALTCHA

Die Login-Mails (`/auth/magic-link`, `/auth/code`) schützt [ALTCHA](https://altcha.org) (MIT, Proof of Work, ohne Cookies und ohne Drittanbieter): Vor dem Absenden rechnet der Browser eine kleine Aufgabe, die API prüft die Lösung. Es ergänzt die Rate-Limits: Jede Anfrage kostet Rechenzeit, und ohne Lösung kann niemand die Limits einer fremden Adresse aufbrauchen.

- API: `GET /api/v1/altcha` gibt eine Challenge aus (`altcha-lib`, PBKDF2/SHA-256, 10 Minuten gültig). `requireAltcha` aus `lib/altcha.ts` steht vor `validJson`, liest das Feld `altcha` im JSON-Body und antwortet sonst mit 403 und `altchaFailed`. Jede Lösung gilt einmal, das merkt sich ein Zähler in `rate_limits`. Den HMAC-Schlüssel erzeugt die API beim ersten Aufruf und legt ihn in `server_secrets` ab, alle Instanzen teilen ihn, eine Env-Variable braucht es nicht.
- Web: `Altcha.svelte` ins Formular, mit `bind:payload` und `bind:this`. Das erste Absenden startet die Rechnung, danach schickt das Widget das Formular selbst noch einmal ab. Der Handler übergeht deshalb Absenden ohne Payload und ruft im `finally` nach jeder Anfrage `reset()` auf, Vorbild `routes/login/+page.svelte`. Das Widget kommt aus `altcha/external` mit eigener CSS- und Worker-Datei, so bleibt die CSP ohne Ausnahme. Seine Texte bringt es auf Deutsch und Englisch mit, die Sprache folgt dem Umschalter. Das Sammeln von Zeiger- und Scrolldaten (`humanInteractionSignature`) ist aus.
- Schwierigkeit: `COST` und Zählerbereich in `apps/api/src/lib/altcha.ts`. Auf einem Laptop rechnet der Browser 0,1–0,5 s, das Widget zeigt mindestens 0,5 s. Nur erhöhen, wenn Bots durchkommen.
- Tests: `apps/api/src/testing.ts` löst Challenges für die API-Tests, der Browser-Test rechnet mit dem echten Widget.

## Passkeys

Die Login-Mail enthält einen Link und einen sechsstelligen Code, auch im Betreff. Beide gelten 15 Minuten. Die Login-Seite löst den Code mit einer httpOnly-Sitzung ein. Sitzungen gelten 365 Tage und verlängern sich bei Benutzung höchstens einmal am Tag; Abmelden löscht sie sofort.

Eingeloggte Nutzer können unter `/settings` Web-Passkeys anlegen und entfernen. Die Login-Seite bietet sie als Autofill im Adressfeld und per Knopf an. SimpleWebAuthn prüft sie gegen Hostname und Origin aus `APP_URL`; Challenges liegen fünf Minuten und einmalig nutzbar in Postgres. Die Registrierung bleibt geschlossen. Ein neues Gerät ohne synchronisierten Passkey nutzt die Login-Mail.

Passkeys sind an die Domain gebunden: Nach einem Domainwechsel einmal per Mail anmelden und einen neuen Passkey anlegen. Lokal funktioniert `localhost` ohne HTTPS, eine LAN-Adresse braucht HTTPS. Entfernte Passkeys können auf dem Gerät verbleiben; beim nächsten Login bittet das Web den Browser, sie zu vergessen. Fieldtest hat keine Mobile-App und keine App-Passkey-Verknüpfungen.
