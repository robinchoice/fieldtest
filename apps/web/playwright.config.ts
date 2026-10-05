import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The tests write to DATABASE_URL like the API tests. The CI sets it directly.
const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Starts API and web like `bun run dev`, or reuses them when they already run
export default defineConfig({
  testDir: 'tests',
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: 'http://localhost:5173',
    // German is the default language, the texts in the tests are German
    locale: 'de-DE',
    // Rate limits live in the database, so each run counts against its own address
    extraHTTPHeaders: { 'x-forwarded-for': crypto.randomUUID() },
  },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: [
    {
      command: 'bun run dev',
      cwd: '../api',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: !process.env.CI,
    },
    { command: 'bun run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
  ],
});
