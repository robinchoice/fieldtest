import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The tests write to DATABASE_URL like the API tests. The CI sets it directly.
const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Own ports and fresh servers, so the tests never run against the dev server of another
// worktree or project. Worktrees testing at the same time pick other ports via
// TEST_API_PORT and TEST_WEB_PORT.
const API_PORT = Number(process.env.TEST_API_PORT ?? 53100);
const WEB_PORT = Number(process.env.TEST_WEB_PORT ?? 54100);
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
      env: { PORT: String(API_PORT), APP_URL: WEB },
      url: `${API}/api/health`,
      reuseExistingServer: false,
    },
    {
      command: `bunx vite dev --port ${WEB_PORT} --strictPort`,
      env: { API_INTERNAL_URL: API },
      url: WEB,
      reuseExistingServer: false,
    },
  ],
});
