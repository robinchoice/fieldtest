# starter

Vorlage für Web- und Mobile-Prototypen: Bun, Hono, SvelteKit, Drizzle und Postgres, dazu optional eine Flutter-App gegen dieselbe API. Login per Magic Link (Web) oder Code (App), Mail über SMTP, Rate-Limit, Security-Header mit CSP, GlitchTip, Healthcheck, CI mit Browser-Test, Dependabot und Coolify-Deploy sind fertig eingebaut.

## Neues Projekt

1. Repo aus der Vorlage anlegen: `gh repo create robinchoice/<name> --template robinchoice/starter --private --clone`
2. `APP_NAME` und `APP_BAND` in `packages/shared/src/index.ts` setzen. Welcher Ausschnitt aus dem Farbband passt, steht in DESIGN.md.
3. Lokal starten:
   ```sh
   cp .env.example .env
   docker compose up -d
   bun install
   bunx playwright install chromium   # einmalig, für den Browser-Test
   bun run dev
   ```
   Web läuft auf http://localhost:5173, die API auf Port 3000. Ohne `SMTP_HOST` stehen die Login-Links im API-Log.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `apps/api` | Hono-API unter `/api/v1`, Migrationen beim Start, `/api/health` prüft auch die DB |
| `apps/web` | SvelteKit. Leitet `/api` an die API weiter, im Dev macht das der Vite-Proxy. Seiten hinter dem Login liegen unter `routes/(app)` |
| `packages/db` | Drizzle-Schema und Migrationen |
| `packages/shared` | App-Name, zod-Schemas und Typen für API und Web |
| `apps/mobile` | Flutter-App, siehe unten. Reine Web-Projekte löschen den Ordner und `.github/workflows/mobile.yml` |

Befehle: `bun run dev`, `check` (Biome und Typen), `format`, `test`, `build`, `db:generate`. `test` umfasst die API-Tests und einen Browser-Test des Logins (Playwright, startet API und Web selbst oder nutzt die laufenden). Beide laufen gegen `DATABASE_URL` und legen nur Testkonten mit frischen Adressen an.

## Deploy auf Coolify

VPS 1 baut nichts. Die CI baut bei jedem grünen Push auf `main` die Images `ghcr.io/<owner>/<repo>-web` und `-api` für arm64 (Tags `:<sha>` und `:latest`), Coolify zieht sie nur. Die GHCR-Packages bleiben privat. VPS 1 zieht sie mit dem vorhandenen Pull-Token `vps1-ghcr-pull`, pro Projekt ist dafür nichts einzurichten.

1. Ressource aus dem GitHub-Repo im Projekt `pleasance-<name>` oder `privat-<name>`, Build Pack „Docker Compose“, Datei `docker-compose.prod.yml`.
2. Domain nur beim Service `web` eintragen, mit Port: `https://<domain>:3000`.
3. Variablen aus `.env.production.example` setzen. `IMAGE_PREFIX` und `IMAGE_TAG` setzt die CI.
4. In GitHub die Secrets `COOLIFY_TOKEN` (Coolify-API-Token mit den Rechten `read`, `write` und `deploy`) und `COOLIFY_UUID` (UUID der Ressource) setzen. Ohne `COOLIFY_TOKEN` überspringt die CI den Deploy. Mit Token setzt sie `IMAGE_PREFIX` und `IMAGE_TAG`, schaltet das Auto-Deploy der Ressource aus, ersetzt den Build durch `docker compose pull`, startet mit `up -d --no-build --remove-orphans` und wartet, bis Coolify den Deploy abgeschlossen hat.
5. GlitchTip: Projekt anlegen, DSN in `SENTRY_DSN` und `PUBLIC_SENTRY_DSN`.
6. Uptime Kuma: HTTP-Monitor auf `https://<domain>/api/health`.
7. Neue Software in `vps1/advisory-alarm` aufnehmen, siehe `infra.md`.

## Mobile-App

Flutter mit Riverpod und go_router, Karte mit flutter_map und OSM, Token in `flutter_secure_storage`, GlitchTip über `sentry_flutter`. Die App spricht dieselbe API wie das Web: Code per Mail anfordern (`POST /api/v1/auth/code`), Code gegen Session-Token tauschen (`/auth/code/verify`), danach Bearer-Token. Einen eigenen Server braucht sie nicht.

### Neues Projekt

1. Umbenennen, `<name>` ohne Bindestrich:
   ```sh
   cd apps/mobile
   grep -rl org.pleasance.starter lib android ios | xargs sed -i 's/org\.pleasance\.starter/org.pleasance.<name>/g'
   mv android/app/src/main/kotlin/org/pleasance/starter android/app/src/main/kotlin/org/pleasance/<name>
   ```
   Anzeigename in `lib/config.dart` (`appName`), `android/app/src/main/AndroidManifest.xml` (`android:label`) und `ios/Runner/Info.plist` (`CFBundleDisplayName`). Den Farbband-Ausschnitt wie im Web in `lib/config.dart` (`appBand`).
2. Lokal starten, die API läuft dabei über `bun run dev`:
   ```sh
   cd apps/mobile
   flutter run                                              # iOS-Simulator
   flutter run --dart-define=API_URL=http://10.0.2.2:3000   # Android-Emulator
   ```
   Auf einem echten Gerät die LAN-IP des Laptops nehmen. Ohne `SMTP_HOST` steht der Code im API-Log.

### Release

`.github/workflows/mobile.yml` prüft jede Änderung an der App mit `flutter analyze` und `flutter test`. Auf `main` lädt die CI iOS zu TestFlight hoch und baut für Android ein signiertes AAB als Artefakt.

- **GitHub-Variablen:** `API_URL` (`https://<domain>`, ohne werden beide Release-Jobs übersprungen), `SENTRY_DSN` (eigenes GlitchTip-Projekt für die App), `ASC_KEY_ID` und `ASC_ISSUER_ID`.
- **GitHub-Secrets:** `ASC_KEY_P8` (App-Store-Connect-API-Key, base64), `IOS_DEV_CERTIFICATE` (festes „Apple Development“-Zertifikat als base64-PKCS12, läuft am 04.10.2027 ab), `IOS_DEV_CERTIFICATE_PASSWORD`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- Ohne `ASC_KEY_ID` wird der iOS-Job übersprungen, ohne `IOS_DEV_CERTIFICATE` bricht er ab. Ohne festes Zertifikat legt Xcode pro Lauf ein neues an, bis die Zertifikatsgrenze des Teams erreicht ist. Ohne Keystore signiert Android mit Debug-Keys (nur zum Testen).
- Die App vorher in App Store Connect mit der Bundle-ID anlegen. Team-ID steht in `ios/ExportOptions.plist` und im Xcode-Projekt.
- macOS-Minuten sind nur bei öffentlichen Repos kostenlos.
