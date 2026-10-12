# Fieldtest

## Zweck & Links

- Tester-Service für Prototypen: Overlay im Prototyp, Belohnung in Sats, Feedback mit Ort in der App. Ausgezahlt wird über den Runner des Owners (`apps/runner`).
- Noch nicht deployt: keine Domain, keine Coolify-Ressource.

## Checks

`bun run check && bun run test && bun run build`. Die Browser-Tests starten API und Web auf eigenen Ports (53100, 54100). Testet ein anderer Worktree gleichzeitig, mit anderen Ports aufrufen: `TEST_API_PORT=53101 TEST_WEB_PORT=54101 bun run test`.

## Deploy

- Ein Push auf `main` baut nach grüner CI die Images. Den Deploy überspringt die CI, solange die Secrets `COOLIFY_TOKEN` und `COOLIFY_UUID` fehlen. Einrichten wie in der README unter „Deploy auf Coolify“, danach diesen Abschnitt um Live-URL und Prüfung ergänzen.
- Prüfen: `gh run watch`. Mit Deploy ist der Job erst grün, wenn `https://fieldtest.pleasance.org/api/health` (bzw. die Repo-Variable `API_URL`) den Commit als `revision` meldet.

## Fallen

- Fieldtest verwahrt nie Geld: keine Guthaben, keine Wallet-Secrets der Owner auf dem Server, keine eigene Cashu-Mint, kein Tausch. Ausgezahlt wird nur über den Runner des Owners. Sonst wäre eine MiCA-Erlaubnis nötig.
- Live-Belohnungen berechnet die API (`lib/sessions.ts`), dem Overlay wird nichts geglaubt außer „aktiv in diesem 10-Sekunden-Fenster“, und auch das nur bis zur verstrichenen Zeit.
- Geldbeträge in Sats als ganze Zahlen, Reputation und Skalierung in Prozent.
- Das Overlay (`packages/sdk`) läuft in fremden Prototypen: Shadow DOM, keine Abhängigkeiten, jede eingesetzte Zeichenkette über `esc()`.

## Konventionen

Stack und Aufbau: siehe README.md. Gestaltung: siehe DESIGN.md.

- Neue Tabelle: `packages/db/src/schema.ts` ändern, `bun run db:generate`. Die Migration läuft beim nächsten API-Start, `migrateDb` lässt mehrere Instanzen nacheinander migrieren. Jede Migration muss mit dem noch laufenden alten Code funktionieren: Spalten nullable oder mit Default hinzufügen, Umbenennen und Löschen erst im Deploy danach. Nichts von Hand in der Datenbank ändern.
- Neue Route: Datei in `apps/api/src/routes`, in `app.ts` einhängen. `requireAuth` für eingeloggte Nutzer (danach `c.get('user')`), `validJson(schema)` mit dem Schema aus `packages/shared`.
- Fehler antworten immer als `{ error: string }` in der Sprache aus `Accept-Language`: `t(c).<key>` aus `lib/i18n.ts`, eigene zod-Meldungen sind Keys aus `messages.ts`. Das Web zeigt ihn als Toast.
- Jeder neue Text kommt auf Deutsch und Englisch in `packages/shared/src/messages.ts`, im Web über `t()` aus `$lib/i18n`. Das Tester-Overlay hat eigene Texte in `packages/sdk/src/messages.ts`.
- Alles, was Mails verschickt oder Geheimnisse prüft, bekommt ein `rateLimit` aus `lib/rate-limit.ts`. Die Zähler liegen in Postgres und gelten für alle API-Instanzen.
- Mails über `sendMail` aus `lib/mail.ts`.
- Zustandslos, damit die App ohne Umbau auf einen anderen Server umzieht oder repliziert hinter einem Load Balancer läuft (`infra.md`, „Skalierung“): Platte und Prozessspeicher halten keinen Zustand, der eine Instanz überlebt oder für alle gelten muss. Login-Sessions, Rate-Limits, Testsessions und Claims liegen in Postgres. Uploads und Medien gehen nach S3 (Hetzner Object Storage, Bucket nach Namensregel) über `Bun.s3`, das `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` und `S3_BUCKET` selbst aus der Env liest. Kein Volume außer `pgdata`. Locks per `pg_advisory_xact_lock`. Caches im Speicher nur, wenn jede Instanz sie verlieren darf (wie das gebaute Overlay in `routes/sdk.ts`), ein geteilter Cache läuft als Valkey-Container in `docker-compose.prod.yml`.
- Hintergrundjobs und Zeitpläne laufen nie im API-Prozess, sondern als eigene Rolle: Service `worker` in `docker-compose.prod.yml` aus dem API-Image mit eigenem Einstieg `apps/api/src/worker.ts`. Aufträge sind Zeilen in Postgres, der Worker holt sie mit `FOR UPDATE SKIP LOCKED`. Fällige Zeitpläne beansprucht er atomar (`update … set next_run = … where name = … and next_run <= now() returning`). Nichts in `setTimeout`, `setInterval` oder Listen im Speicher. Kurze Nacharbeit einer Anfrage wie eine Mail bleibt in der Anfrage. Noch offen: Die KI-Bewertung (`evaluateLater` in `lib/evaluate.ts`) läuft nach der Antwort im API-Prozess und geht bei einem Neustart verloren.
- Jede Rolle hat einen Healthcheck im Image: API `/api/health` (mit Datenbank), Web `/health` (nur der Prozess), ein Worker ein `/health` auf einem eigenen Port. Uptime Kuma und ein Load Balancer prüfen `/api/health` über die öffentliche Adresse.
- Konfiguration nur über die Env: Jede neue Variable steht in `.env.example`, `.env.production.example` und `docker-compose.prod.yml`. Im Code keine Domains, IPs, Hostnamen oder Pfade des Servers. Service-Namen aus der Compose-Datei (`api`, `postgres`) sind erlaubt.
- Postgres hat im Compose eine Speichergrenze (`POSTGRES_MEMORY`, Standard `512m`). Wird sie eng, in Coolify erhöhen, nicht entfernen.
- Web: API-Aufrufe über `api` aus `$lib/api`, Login-Zustand aus `$lib/auth.svelte`. Seiten hinter dem Login unter `routes/(app)`.
- Externe Quellen im Browser (Skripte, Fonts, Bilder, APIs) in die CSP in `apps/web/svelte.config.js` eintragen, sonst blockt der Browser sie. Der Browser-Test in `apps/web/tests` scheitert an jedem Konsolenfehler, also auch an CSP-Verstößen. Inline-`<style>` erlaubt die CSP nur im Dev-Modus.
- Link-Vorschau: Das Layout setzt die `og:`-Tags, das Bild rendert `bun run og-image` in `apps/web` (DESIGN.md, „Vorschaubild“). Danach neu rendern und committen, wenn sich `APP_NAME`, `APP_BAND`, `tagline` oder die Kachel ändern. Die Kachel liegt als `static/favicon.svg`, dieselbe wie `img/werkzeuge/fieldtest.svg` im pleasance-Repo. Öffentliche Seiten mit eigenem Inhalt geben im Server-Load `meta` mit Titel, Beschreibung und optional einem absoluten Bild-URL zurück, so wie der geteilte Bericht unter `/r/[token]`. Ungültige Links bekommen die allgemeine Vorschau. Link-Crawler führen kein JavaScript aus, also wirkt `meta` nur in `+page.server.ts` bzw. `+page.ts` auf Seiten mit SSR, nicht unter `routes/(app)` (`ssr = false`). WhatsApp speichert Vorschauen lange zwischen.
- Formatierung und Lint: Biome, Regeln in `biome.json`. `bun run format` behebt das meiste selbst.
