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
| `packages/sdk` | Tester-Overlay, die API liefert es gebündelt unter `/api/v1/sdk/overlay.js` aus |
| `packages/db` | Drizzle-Schema und Migrationen |
| `packages/shared` | Name, Farbband, zod-Schemas, Texte auf Deutsch und Englisch (`messages.ts`) |

Befehle: `bun run dev`, `check` (Biome und Typen), `format`, `test`, `build`, `db:generate`, in `apps/web` außerdem `og-image` (Vorschaubild für geteilte Links, DESIGN.md). Die Browser-Tests in `test` bauen das Web und starten API und Web-Build selbst auf eigenen Ports 53100 und 54100, nie die laufenden Dev-Server, so greift die CSP wie in Produktion; testen zwei Worktrees gleichzeitig, bekommt einer andere per `TEST_API_PORT` und `TEST_WEB_PORT`.

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
5. **Claims:** Die Erstmeldung bekommt den Betrag ihrer Schwere mal Reputation (neu 0,5×, ab 3 freigegebenen Sessions 1×, ab 10 1,25×), die nächsten fünf Tester eine Bestätigung. Bis zur Grenze `autoApprove` sind Claims sofort freigegeben, darüber entscheidet der Owner. Nach 48 Stunden geben sie sich selbst frei.
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

- Opt-in: Standard ist aus. Unter dem Login-Formular steht eine nicht vorausgewählte Checkbox, sie gilt erst, wenn der Login-Link eingelöst wird. Das ist zugleich das Double-Opt-in. Geschaltet wird jederzeit unter `/settings`. `users.updates_consent_at` hält den Zeitpunkt der Einwilligung als Nachweis, `users.locale` die Sprache der Mails.
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

## Registrierung öffnen

Fieldtest ist von außen erreichbar, aber geschlossen, bis Robin ausdrücklich das Go gibt, externe Nutzer aufzunehmen. Bis dahin legen Magic Link und App-Code neue Konten nur für die Adressen in `SIGNUP_ALLOWLIST` an (kommagetrennt, dauerhafte Adressen wie Robins). Bestehende Konten melden sich immer an. Fremde bekommen bei `/auth/magic-link` und `/auth/code` die Meldung „Die Registrierung ist noch geschlossen“, es geht keine Mail raus. Seiten ohne Login bleiben offen: geteilte Berichte, der Demo-Prototyp und alles, was Testpersonen einer Runde über deren Einladungslink und das Overlay tun. Testpersonen haben kein Konto, sie hängen an ihrer Lightning-Adresse.

- Tester aufnehmen: Ein Admin klickt in der App oben auf „Tester einladen“ (`/invite`) und gibt die Adresse ein. Das legt das Konto an und schickt einen Login-Link, ohne Coolify und Redeploy. Danach meldet sich der Tester wie jedes bestehende Konto an, auch wenn der Link abläuft. Admins sind die Adressen in `ADMIN_EMAILS` (kommagetrennt, Standard robin@pleasance.org, der menschliche Admin), die API prüft das. Einladen öffnet nichts, `SIGNUP_OPEN` bleibt, wie es ist.
- admin@pleasance.org, der agentische Admin, kommt nie in `ADMIN_EMAILS`: Agenten melden sich damit in der Vorschau an und dürfen weder Konten an der Registrierung vorbei anlegen noch Dritte anmailen.
- Öffnen, erst nach Robins Go: `SIGNUP_OPEN=true` in Coolify setzen und neu deployen. Prüfen: Login-Link an eine neue Adresse anfordern.
- `login-link` legt Konten selbst an, das Testkonto der Savor-Vorschau braucht keinen Eintrag.

## Login in der Savor-Vorschau

Agenten zeigen Änderungen hinter dem Login in der Savor-Vorschau mit dem Testkonto admin@pleasance.org, dem agentischen Admin. Admin-Rechte in der App hat es nicht (siehe „Registrierung öffnen“). `login-link <slug>` aus dem Kontor ruft dafür im API-Container `bun apps/api/src/login-link.ts <email>` auf. Das gibt einen einmaligen Login-Link aus, 15 Minuten gültig wie ein gemailter, den der Agent per `browser_navigate` öffnet. Die Vorschau hat pro Projekt ein festes Profil, und Sessions in Benutzung verlängern sich bei jedem Besuch auf 30 Tage. Also bleibt sie angemeldet.

## Bewusst offen

- Das Overlay bringt seine Styles als `<style>` im Shadow DOM mit. Prototypen mit strenger CSP müssen `style-src 'unsafe-inline'` erlauben, sonst bleibt das Overlay ungestylt.
- Der Runner läuft aus dem Repo, ein eigenes Image dafür baut die CI noch nicht.
- Rechtlich: Fieldtest verwahrt nichts und überweist nicht selbst. Ob das Runner-Modell ohne MiCA-Erlaubnis auskommt, sollte die BaFin bestätigen (Fintech-Kontaktformular, Frage nach Erlaubnispflicht).
