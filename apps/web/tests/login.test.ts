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

test('the login form sends a magic link to an existing account', async ({ page }) => {
  const email = freshEmail();
  await sql`insert into users (email, name) values (${email}, 'Lena')`;
  await openHydrated(page, '/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByRole('button', { name: 'Login-Link senden' }).click();
  await expect(page.getByText('Check deine E-Mails')).toBeVisible();
});

// The API runs without SIGNUP_OPEN, like a prototype before Robin opens it
test('strangers learn that sign-up is still closed', async ({ page }) => {
  await openHydrated(page, '/login');
  await page.getByLabel('E-Mail').fill(freshEmail());
  await page.getByRole('button', { name: 'Login-Link senden' }).click();
  await expect(page.getByText('Die Registrierung ist noch geschlossen.', { exact: false })).toBeVisible();
  await expect(page.getByText('Check deine E-Mails')).toBeHidden();
  // The browser logs the expected 403 as an error
  errors = errors.filter((error) => !error.includes('status of 403'));
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
  await expect(page.getByRole('heading', { name: 'Testrunden' })).toBeVisible();
  await expect(page.getByText(email.split('@')[0]!).first()).toBeVisible();

  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
});

async function logInAs(page: Page, email: string) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await sql`insert into magic_links (email, token_hash, expires_at)
    values (${email}, ${tokenHash}, ${new Date(Date.now() + 15 * 60_000)})`;
  await page.goto(`/auth/verify?token=${token}`);
  await expect(page).toHaveURL(/\/dashboard$/);
}

// The API runs with ADMIN_EMAILS=e2e-admin@example.com, see playwright.config.ts
test('the admin invites a tester, who can log in afterwards', async ({ page }) => {
  const tester = freshEmail();
  await logInAs(page, 'e2e-admin@example.com');
  await page.getByRole('link', { name: 'Tester einladen' }).click();
  await page.getByLabel('E-Mail').fill(tester);
  await page.getByRole('button', { name: 'Einladen' }).click();
  await expect(page.getByText(`Einladung an ${tester} verschickt`)).toBeVisible();
  expect(await sql`select 1 from users where email = ${tester}`).toHaveLength(1);

  await page.getByRole('button', { name: 'Abmelden' }).click();
  await openHydrated(page, '/login');
  await page.getByLabel('E-Mail').fill(tester);
  await page.getByRole('button', { name: 'Login-Link senden' }).click();
  await expect(page.getByText('Check deine E-Mails')).toBeVisible();
});

test('others see no invite and get 403 from the API', async ({ page }) => {
  await logInAs(page, freshEmail());
  await expect(page.getByRole('link', { name: 'Tester einladen' })).toBeHidden();
  const res = await page.request.post('/api/v1/auth/invite', { data: { email: freshEmail() } });
  expect(res.status()).toBe(403);
});
