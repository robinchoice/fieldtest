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

async function logInAs(page: Page, email: string) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await sql`insert into magic_links (email, token_hash, expires_at)
    values (${email}, ${tokenHash}, ${new Date(Date.now() + 15 * 60_000)})`;
  await page.goto(`/auth/verify?token=${token}`);
  await expect(page).toHaveURL(/\/dashboard$/);
}

const consent = async (email: string) =>
  (await sql`select updates_consent_at from users where email = ${email}`)[0]?.updates_consent_at;

test('the login form asks for update mails without a preset tick', async ({ page }) => {
  const email = freshEmail();
  await sql`insert into users (email, name) values (${email}, 'Lena')`;
  await Promise.all([page.waitForResponse('**/api/v1/auth/me'), page.goto('/login')]);
  const optIn = page.getByLabel('Schick mir Updates', { exact: false });
  await expect(optIn).not.toBeChecked();
  await page.getByLabel('E-Mail').fill(email);
  await optIn.check();
  await page.getByRole('button', { name: 'Login-Link senden' }).click();
  await expect(page.getByText('Check deine E-Mails')).toBeVisible();

  // Counts only once the link is opened
  const [link] = await sql`select updates_opt_in from magic_links where email = ${email}`;
  expect(link!.updates_opt_in).toBe(true);
  expect(await consent(email)).toBeNull();
});

test('the settings switch turns update mails on and off', async ({ page }) => {
  const email = freshEmail();
  await logInAs(page, email);
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  const updates = page.getByRole('switch', { name: 'Updates per Mail' });
  await expect(updates).toHaveAttribute('aria-checked', 'false');

  await updates.click();
  await expect(page.getByText('Eingeschaltet am', { exact: false })).toBeVisible();
  expect(await consent(email)).not.toBeNull();

  await updates.click();
  await expect(updates).toHaveAttribute('aria-checked', 'false');
  expect(await consent(email)).toBeNull();
});

test('the unsubscribe link works without login', async ({ page }) => {
  const email = freshEmail();
  const [user] = await sql`insert into users (email, name, updates_consent_at) values (${email}, 'Lena', now())
    returning unsubscribe_token`;
  await page.goto(`/unsubscribe?token=${user!.unsubscribe_token}`);
  await expect(page.getByRole('heading', { name: 'Abbestellt' })).toBeVisible();
  expect(await consent(email)).toBeNull();

  await page.getByRole('button', { name: 'Doch wieder bestellen' }).click();
  await expect(page.getByRole('heading', { name: 'Wieder bestellt' })).toBeVisible();
  expect(await consent(email)).not.toBeNull();
});

// The API runs with ADMIN_EMAILS=e2e-admin@example.com, see playwright.config.ts
test('the admin writes an update, previews it and sends it', async ({ page }) => {
  await sql`insert into users (email, name, updates_consent_at) values (${freshEmail()}, 'Lena', now())`;
  await logInAs(page, 'e2e-admin@example.com');
  await page.getByRole('link', { name: 'Updates' }).click();
  await page.getByRole('button', { name: 'Neues Update' }).click();

  const title = `Sprachfamilien ${crypto.randomUUID()}`;
  await page.getByLabel('Titel').fill(title);
  await page.getByLabel('Features').fill('Die Karte zeigt Sprachfamilien\nAussprache zum Anhören');
  await page.getByRole('tab', { name: 'English' }).click();
  await page.getByLabel('Titel').fill('Language families');
  await page.getByLabel('Features').fill('The map shows language families');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Gespeichert')).toBeVisible();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Language families' })).toBeVisible();

  await page.getByRole('button', { name: /^An \d+ Abonnenten senden$/ }).click();
  await page.getByRole('button', { name: 'Jetzt senden' }).click();
  await expect(page.getByText('Versendet am', { exact: false })).toBeVisible();
  const [update] =
    await sql`select sent_at, (select count(*)::int from update_deliveries where update_id = updates.id) as queued
    from updates where content->'de'->>'title' = ${title}`;
  expect(update!.sent_at).not.toBeNull();
  expect(update!.queued).toBeGreaterThan(0);
});

test('others see no updates page and get 403 from the API', async ({ page }) => {
  await logInAs(page, freshEmail());
  await expect(page.getByRole('link', { name: 'Updates' })).toBeHidden();
  const res = await page.request.get('/api/v1/updates');
  expect(res.status()).toBe(403);
});
