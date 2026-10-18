import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { connection: { timezone: 'UTC' }, onnotice: () => {} });
test.afterAll(() => sql.end());

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

test('a tester reports a dead button, the owner rates it and approves the payout', async ({ page, context }) => {
  test.setTimeout(90_000);
  const email = `e2e-${crypto.randomUUID()}@example.com`;
  const token = randomBytes(32).toString('hex');
  // Sign-up is closed, so the account comes first, as with login-link
  await sql`insert into users (email, name) values (${email}, ${email.split('@')[0]!}) on conflict do nothing`;
  await sql`insert into magic_links (email, token_hash, expires_at)
    values (${email}, ${createHash('sha256').update(token).digest('hex')}, ${new Date(Date.now() + 15 * 60_000)})`;
  await page.goto(`/auth/verify?token=${token}`);
  await expect(page).toHaveURL(/\/dashboard$/);

  // The demo round opens on its setup page with the invite link
  await page.getByRole('button', { name: 'Mit dem Demo-Prototyp ausprobieren' }).click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+\/setup$/);
  const invite = (await page.locator('code').first().textContent())!;
  expect(invite).toContain('/demo/pebble.html?fieldtest=');

  // The tester opens the prototype through the invite link
  const tester = await context.newPage();
  tester.on('pageerror', (err) => errors.push(err.message));
  await tester.goto(invite);
  await expect(tester.getByText('Pebble Wallet: Onboarding')).toBeVisible();
  await tester.getByLabel('Deine Lightning-Adresse').fill(`e2e${randomBytes(4).toString('hex')}@getalby.com`);
  await tester.getByRole('button', { name: 'Test starten' }).click();
  await expect(tester.getByRole('button', { name: /Sats/ })).toBeVisible();

  await tester.getByRole('button', { name: 'Create wallet' }).click();
  for (let i = 0; i < 3; i++) await tester.getByRole('button', { name: 'Continue' }).click();
  await expect(tester.getByText('Hängst du bei „Continue“?')).toBeVisible();
  await tester.getByRole('button', { name: 'Melden' }).click();
  await tester.getByLabel('Was hast du erwartet').fill('Continue does nothing, no hint that I have to scroll.');
  await tester.getByRole('button', { name: 'Feedback senden' }).click();
  await expect(tester.getByText('Feedback gesendet, wird geprüft')).toBeVisible();

  // The new screen earned 10 sats, they wait for the runner
  await tester.getByRole('button', { name: /Sats/ }).click();
  await expect(tester.getByText('Neuer Screen: Backup', { exact: true })).toBeVisible();

  // The owner sees the finding with the tester's words and the friction before it
  await page.getByRole('link', { name: 'Findings' }).click();
  await expect(
    page.getByRole('heading', { name: 'Continue does nothing, no hint that I have to scroll.' }),
  ).toBeVisible();
  await expect(page.getByText('Continue reagiert nicht (3 Taps)')).toBeVisible();
  await page.getByLabel('Schwere').selectOption('blocker');
  await expect(page.getByText('Gespeichert. Die Auszahlungen sind angepasst.')).toBeVisible();

  // New testers earn half: 4,000 → 2,000, above the limit of 1,500, so it waits for the owner
  await page.getByRole('link', { name: /Auszahlungen/ }).click();
  await expect(page.getByText('4.000 Sats × Reputation 0.5')).toBeVisible();
  await page.getByRole('button', { name: 'Freigeben' }).click();
  await expect(page.getByText('Nichts zu entscheiden.')).toBeVisible();

  await page.getByRole('link', { name: 'Bericht' }).click();
  await expect(page.getByText(/Am meisten hält das auf: Continue does nothing/)).toBeVisible();
});
