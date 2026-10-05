import { createHash, randomBytes } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { connection: { timezone: 'UTC' }, onnotice: () => {} });
test.afterAll(() => sql.end());

const freshEmail = () => `e2e-${crypto.randomUUID()}@example.com`;

// Console errors fail the test, CSP violations included
let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
});
test.afterEach(() => expect(errors).toEqual([]));

// The form only works once hydrated. That is when onMount asks for the login state.
async function openHydrated(page: Page, path: string) {
  await Promise.all([page.waitForResponse('**/api/v1/auth/me'), page.goto(path)]);
}

test('the login form sends a magic link', async ({ page }) => {
  await openHydrated(page, '/login');
  await page.getByLabel('E-Mail').fill(freshEmail());
  await page.getByRole('button', { name: 'Login-Link senden' }).click();
  await expect(page.getByText('Check deine E-Mails')).toBeVisible();
});

test('a magic link opens the dashboard until logout', async ({ page }) => {
  // Stored like the API does it: only the hash of the token
  const email = freshEmail();
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await sql`insert into magic_links (email, token_hash, expires_at)
    values (${email}, ${tokenHash}, ${new Date(Date.now() + 15 * 60_000)})`;

  await page.goto(`/auth/verify?token=${token}`);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: `Hallo ${email.split('@')[0]}` })).toBeVisible();

  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
});
