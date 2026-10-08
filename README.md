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

Web läuft auf http://localhost:5173, die API auf Port 3000. Ohne `SMTP_HOST` stehen die Login-Links im API-Log.

**Ausprobieren:** Nach dem Login „Mit dem Demo-Prototyp ausprobieren“ wählen. Das legt eine Runde für den Pebble-Demo-Prototyp unter `/demo/pebble.html` an. Den Einladungslink aus der Einrichtung in einem zweiten Fenster öffnen, testen, auf dem Backup-Screen dreimal auf „Continue“ tippen (der eingebaute Fehler) und das Finding im Dashboard bewerten.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `apps/api` | Hono-API unter `/api/v1`: Runden (`routes/rounds.ts`), Overlay (`routes/sdk.ts`), Runner (`routes/runner.ts`), geteilte Berichte (`routes/reports.ts`) |
| `apps/api/src/lib` | Live-Belohnungen (`sessions.ts`), Claims und Reputation (`claims.ts`), Zahlungsbelege (`payments.ts`), KI-Bewertung (`evaluate.ts`) |
| `apps/web` | Dashboard für Owner, geteilte Berichte unter `/r/<token>`, Demo-Prototyp unter `static/demo` |
| `apps/runner` | Auszahlungs-Runner für den Rechner des Owners |
| `packages/sdk` | Tester-Overlay, die API liefert es gebündelt unter `/api/v1/sdk/overlay.js` aus |
| `packages/db` | Drizzle-Schema und Migrationen |
| `packages/shared` | Name, Farbband, zod-Schemas, Texte auf Deutsch und Englisch (`messages.ts`) |

Befehle: `bun run dev`, `check` (Biome und Typen), `format`, `test`, `build`, `db:generate`, in `apps/web` außerdem `og-image` (Vorschaubild für geteilte Links, DESIGN.md).

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

## Deploy auf Coolify

Wie im Starter: Ressource aus dem Repo, Build Pack „Docker Compose“ mit `docker-compose.prod.yml`, Domain nur beim Service `web`, Variablen aus `.env.production.example`. `ANTHROPIC_API_KEY` ist optional. Die CI baut die Images bei grünem Push auf `main`, für den Deploy braucht sie die Secrets `COOLIFY_TOKEN` und `COOLIFY_UUID`.

## Bewusst offen

- Das Overlay bringt seine Styles als `<style>` im Shadow DOM mit. Prototypen mit strenger CSP müssen `style-src 'unsafe-inline'` erlauben, sonst bleibt das Overlay ungestylt.
- Der Runner läuft aus dem Repo, ein eigenes Image dafür baut die CI noch nicht.
- Rechtlich: Fieldtest verwahrt nichts und überweist nicht selbst. Ob das Runner-Modell ohne MiCA-Erlaubnis auskommt, sollte die BaFin bestätigen (Fintech-Kontaktformular, Frage nach Erlaubnispflicht).
