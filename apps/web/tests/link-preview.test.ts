import { randomBytes } from 'node:crypto';
import { DEFAULT_REWARDS } from '@app/shared';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';

// Link crawlers run no JavaScript: the server-rendered page must carry the tags
test('the start page links a preview image that exists', async ({ request }) => {
  const html = await (await request.get('/', { headers: { 'accept-language': 'en' } })).text();
  expect(html).toContain('<meta property="og:title" content="');
  const image = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  expect(image).toMatch(/\/og-image-en\.png$/);
  const response = await request.get(image!);
  expect(response.headers()['content-type']).toBe('image/png');
});

test('a shared report previews with its round, unknown links with the general preview', async ({ request }) => {
  const sql = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  const token = randomBytes(12).toString('hex');
  try {
    const [owner] = await sql`insert into users (email, name)
      values (${`e2e-${crypto.randomUUID()}@example.com`}, 'E2E') returning id`;
    await sql`insert into rounds (owner_id, product, name, prototype_url, goals, rewards, invite_token, share_token)
      values (${owner!.id}, 'Pebble Wallet', 'Onboarding', 'https://example.com', ${sql.json([])},
        ${sql.json(DEFAULT_REWARDS)}, ${randomBytes(16).toString('hex')}, ${token})`;
  } finally {
    await sql.end();
  }
  const title = async (path: string) =>
    (await (await request.get(path, { headers: { 'accept-language': 'en' } })).text()).match(
      /<meta property="og:title" content="([^"]+)"/,
    )?.[1];
  expect(await title(`/r/${token}`)).toBe('Pebble Wallet, Onboarding');
  expect(await title('/r/unknown')).toBe('Fieldtest');
});
