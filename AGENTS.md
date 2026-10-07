# Fieldtest

## Zweck & Links

- Tester-Service für Prototypen: Overlay im Prototyp, Belohnung in Sats, Feedback mit Ort in der App. Ausgezahlt wird über den Runner des Owners (`apps/runner`).
- Noch nicht deployt: keine Domain, keine Coolify-Ressource.

## Checks

`bun run check && bun run test && bun run build`

## Deploy

- Ein Push auf `main` baut nach grüner CI die Images. Den Deploy überspringt die CI, solange die Secrets `COOLIFY_TOKEN` und `COOLIFY_UUID` fehlen. Einrichten wie in der README unter „Deploy auf Coolify“, danach diesen Abschnitt um Live-URL und Prüfung ergänzen.
- Prüfen: `gh run watch`.

## Fallen

- Fieldtest verwahrt nie Geld: keine Guthaben, keine Wallet-Secrets der Owner auf dem Server, keine eigene Cashu-Mint, kein Tausch. Ausgezahlt wird nur über den Runner des Owners. Sonst wäre eine MiCA-Erlaubnis nötig.
- Live-Belohnungen berechnet die API (`lib/sessions.ts`), dem Overlay wird nichts geglaubt außer „aktiv in diesem 10-Sekunden-Fenster“, und auch das nur bis zur verstrichenen Zeit.
- Geldbeträge in Sats als ganze Zahlen, Reputation und Skalierung in Prozent.
- Das Overlay (`packages/sdk`) läuft in fremden Prototypen: Shadow DOM, keine Abhängigkeiten, jede eingesetzte Zeichenkette über `esc()`.

## Konventionen

Stack und Aufbau: siehe README.md. Gestaltung: siehe DESIGN.md.

- Neue Tabelle: `packages/db/src/schema.ts` ändern, `bun run db:generate`. Die Migration läuft beim nächsten API-Start.
- Neue Route: Datei in `apps/api/src/routes`, in `app.ts` einhängen. `requireAuth` für eingeloggte Nutzer (danach `c.get('user')`), `validJson(schema)` mit dem Schema aus `packages/shared`.
- Fehler antworten immer als `{ error: string }` in der Sprache aus `Accept-Language`: `t(c).<key>` aus `lib/i18n.ts`, eigene zod-Meldungen sind Keys aus `messages.ts`. Das Web zeigt ihn als Toast.
- Jeder neue Text kommt auf Deutsch und Englisch in `packages/shared/src/messages.ts`, im Web über `t()` aus `$lib/i18n`. Das Tester-Overlay hat eigene Texte in `packages/sdk/src/messages.ts`.
- Alles, was Mails verschickt oder Geheimnisse prüft, bekommt ein `rateLimit` aus `lib/rate-limit.ts`. Die Zähler liegen in Postgres und gelten für alle API-Instanzen.
- Mails über `sendMail` aus `lib/mail.ts`.
- Web: API-Aufrufe über `api` aus `$lib/api`, Login-Zustand aus `$lib/auth.svelte`. Seiten hinter dem Login unter `routes/(app)`.
- Externe Quellen im Browser (Skripte, Fonts, Bilder, APIs) in die CSP in `apps/web/svelte.config.js` eintragen, sonst blockt der Browser sie. Der Browser-Test in `apps/web/tests` scheitert an jedem Konsolenfehler, also auch an CSP-Verstößen. Inline-`<style>` erlaubt die CSP nur im Dev-Modus.
- Formatierung und Lint: Biome, Regeln in `biome.json`. `bun run format` behebt das meiste selbst.
