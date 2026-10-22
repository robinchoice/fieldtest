import { defineConfig, devices } from '@playwright/test';

// packages/db/test.ts supplies a temporary DATABASE_URL. Nothing else comes from
// .env, so SMTP and the Claude key stay out of the test servers.

// Own ports and fresh servers, so the tests never run against the dev server of another
// worktree or project. Worktrees testing at the same time pick other ports via
// TEST_API_PORT and TEST_WEB_PORT. Keep them below Linux's ephemeral range (32768–60999).
const API_PORT = Number(process.env.TEST_API_PORT ?? 31100);
const WEB_PORT = Number(process.env.TEST_WEB_PORT ?? 31101);
const API = `http://localhost:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: 'tests',
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: WEB,
    // German is the default language, the texts in the tests are German
    locale: 'de-DE',
    // Rate limits live in the database, so each run counts against its own address
    extraHTTPHeaders: { 'x-forwarded-for': crypto.randomUUID() },
  },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: [
    {
      command: 'bun src/index.ts',
      cwd: '../api',
      env: {
        PORT: String(API_PORT),
        APP_URL: WEB,
        ADMIN_EMAILS: 'e2e-admin@example.com',
        SIGNUP_OPEN: '',
        SIGNUP_ALLOWLIST: '',
      },
      url: `${API}/api/health`,
      reuseExistingServer: false,
    },
    // The production build, not vite dev: only it enforces the CSP without inline styles
    {
      command: 'bunx vite build --logLevel error && bun build/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: String(WEB_PORT),
        ORIGIN: WEB,
        API_INTERNAL_URL: API,
      },
      url: `${WEB}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
