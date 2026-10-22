import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb, migrateDb, sessions, updateDeliveries, users } from '@app/db';
import { APP_NAME } from '@app/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from './app';
import { updateMail } from './lib/mail';
import { deliverNext, parseDraft, readDrafts, redact } from './lib/updates';
import { generateToken, hashToken } from './middleware/auth';
import { altchaPayload, body, read } from './testing';

const db = createDb(process.env.DATABASE_URL);
const app = createApp(db);
const log = spyOn(console, 'log');

beforeAll(() => migrateDb(process.env.DATABASE_URL));
afterAll(() => {
  delete process.env.ADMIN_EMAILS;
  return db.$client.end();
});

process.env.SIGNUP_OPEN = 'true';
const ADMIN = `admin-${crypto.randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = ADMIN;

const ip = crypto.randomUUID();
const freshEmail = () => `test-${crypto.randomUUID()}@example.com`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const content = {
  de: { title: 'Karte mit <Familien>', features: ['Sprachen nach Familie', 'Aussprache zum Anhören'] },
  en: { title: 'Map with families', features: ['Languages by family'] },
};

function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(`/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const userAnswer = z.object({ user: z.object({ updatesSince: z.string().nullable() }) });
const updateAnswer = z.object({ update: z.looseObject({ id: z.string() }) });

const lastMailedToken = () =>
  log.mock.calls
    .map((args) => String(args[0]))
    .findLast((line) => line.startsWith('[mail]'))
    ?.match(/token=([0-9a-f]+)/)?.[1];

async function logInWithLink(email: string, updates?: boolean, locale = 'de') {
  await request(
    'POST',
    '/auth/magic-link',
    { email, updates, altcha: await altchaPayload(app) },
    { 'accept-language': locale },
  );
  return read(request('POST', '/auth/verify', { token: lastMailedToken() }, { 'accept-language': locale }), userAnswer);
}

async function session(email: string) {
  const [user] = await db
    .insert(users)
    .values({ email, name: 'Robin' })
    .onConflictDoUpdate({ target: users.email, set: { email } })
    .returning({ id: users.id });
  const token = generateToken();
  await db
    .insert(sessions)
    .values({ userId: user!.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) });
  return { cookie: `session=${token}` };
}

const userRow = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0]!;

test('the ticked checkbox opts in once the link is opened, the unticked one changes nothing', async () => {
  const email = freshEmail();
  await request(
    'POST',
    '/auth/magic-link',
    { email, updates: true, altcha: await altchaPayload(app) },
    { 'accept-language': 'en' },
  );
  // The login mail says what opening the link confirms
  const mailed = log.mock.calls.map((args) => String(args[0])).findLast((line) => line.startsWith('[mail]'));
  expect(mailed).toContain(`Logging in with this also turns on email updates from ${APP_NAME}.`);
  expect((await userRow(email).catch(() => null))?.updatesConsentAt ?? null).toBeNull();
  const { user } = await read(
    request('POST', '/auth/verify', { token: lastMailedToken() }, { 'accept-language': 'en' }),
    userAnswer,
  );
  expect(user.updatesSince).toEqual(expect.any(String));
  expect((await userRow(email)).locale).toBe('en');

  // Consent keeps its first date, an unticked login leaves it on
  const again = await logInWithLink(email, false);
  expect(again.user.updatesSince).toBe(user.updatesSince);
  expect((await userRow(email)).locale).toBe('de');

  expect((await logInWithLink(freshEmail())).user.updatesSince).toBeNull();
});

test('the settings switch turns update mails on and off', async () => {
  const headers = await session(freshEmail());
  const on = await body(request('PATCH', '/auth/me', { updates: true }, headers));
  expect(on).toMatchObject({ user: { updatesSince: expect.any(String) } });
  const off = await body(request('PATCH', '/auth/me', { updates: false }, headers));
  expect(off).toMatchObject({ user: { updatesSince: null } });
});

test('the unsubscribe link works without login, also as one-click POST', async () => {
  const email = freshEmail();
  await logInWithLink(email, true);
  const { unsubscribeToken } = await userRow(email);

  // What mail clients send for List-Unsubscribe-Post
  const res = await app.request(`/api/v1/updates/unsubscribe?token=${unsubscribeToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
    body: 'List-Unsubscribe=One-Click',
  });
  expect(res.status).toBe(200);
  expect((await userRow(email)).updatesConsentAt).toBeNull();

  expect((await request('POST', `/updates/subscribe?token=${unsubscribeToken}`)).status).toBe(200);
  expect((await userRow(email)).updatesConsentAt).not.toBeNull();

  expect((await request('POST', `/updates/unsubscribe?token=${crypto.randomUUID()}`)).status).toBe(400);
  expect((await request('POST', '/updates/unsubscribe?token=nope')).status).toBe(400);
});

test('unsubscribe limits follow recipients while invalid tokens share the IP limit', async () => {
  const headers = { 'x-forwarded-for': crypto.randomUUID() };
  const recipients = await db
    .insert(users)
    .values(Array.from({ length: 31 }, () => ({ email: freshEmail(), name: 'Lena', updatesConsentAt: new Date() })))
    .returning({ token: users.unsubscribeToken });
  for (const { token } of recipients) {
    expect((await request('POST', `/updates/unsubscribe?token=${token}`, undefined, headers)).status).toBe(200);
  }
  for (let attempt = 1; attempt < 30; attempt++) {
    expect(
      (await request('POST', `/updates/unsubscribe?token=${recipients[0]!.token}`, undefined, headers)).status,
    ).toBe(200);
  }
  expect((await request('POST', `/updates/unsubscribe?token=${recipients[0]!.token}`, undefined, headers)).status).toBe(
    429,
  );
  for (let attempt = 0; attempt < 30; attempt++) {
    expect(
      (await request('POST', `/updates/unsubscribe?token=${crypto.randomUUID()}`, undefined, headers)).status,
    ).toBe(400);
  }
  expect((await request('POST', '/updates/unsubscribe?token=nope', undefined, headers)).status).toBe(429);
  expect((await request('POST', `/updates/unsubscribe?token=${recipients[1]!.token}`, undefined, headers)).status).toBe(
    200,
  );
});

test('only admins see and write updates', async () => {
  const headers = await session(freshEmail());
  expect((await request('GET', '/updates', undefined, headers)).status).toBe(403);
  expect((await request('POST', '/updates', { content }, headers)).status).toBe(403);
  expect((await request('GET', '/updates')).status).toBe(401);
});

test('the admin drafts, previews, tests and sends; the worker delivers to opted-in accounts', async () => {
  const admin = await session(ADMIN);
  const subscriber = freshEmail();
  const leaving = freshEmail();
  const bystander = freshEmail();
  await logInWithLink(subscriber, true, 'en');
  await logInWithLink(leaving, true);
  await logInWithLink(bystander);

  const created = await read(
    request('POST', '/updates', { content: { ...content, en: { title: '', features: [] } } }, admin),
    updateAnswer,
  );
  const id = created.update.id;
  expect(created.update).toMatchObject({ slug: null, sentAt: null, hasImage: false });

  // Incomplete drafts save, but don't send
  expect((await request('POST', `/updates/${id}/send`, undefined, admin)).status).toBe(400);
  const saved = await body(request('PUT', `/updates/${id}`, { content, image: PNG.toString('base64') }, admin));
  expect(saved).toMatchObject({ update: { hasImage: true } });
  const image = await app.request(`/api/v1/updates/${id}/image`);
  expect(image.headers.get('content-type')).toBe('image/png');

  const preview = await request('GET', `/updates/${id}/preview?locale=de`, undefined, admin);
  const html = await preview.text();
  expect(html).toContain('Karte mit &#60;Familien&#62;');
  expect(html).toContain('/unsubscribe?token=');
  expect(html).toContain(`/api/v1/updates/${id}/image`);

  const before = log.mock.calls.length;
  expect((await request('POST', `/updates/${id}/test`, undefined, admin)).status).toBe(200);
  const tests = log.mock.calls.slice(before).filter((args) => String(args[0]).startsWith(`[mail] To ${ADMIN}`));
  expect(tests.map((args) => String(args[0]).split('\n')[0])).toEqual([
    `[mail] To ${ADMIN}: Neu in ${APP_NAME}: Karte mit <Familien>`,
    `[mail] To ${ADMIN}: New in ${APP_NAME}: Map with families`,
  ]);

  const sent = await body(request('POST', `/updates/${id}/send`, undefined, admin));
  expect(sent).toMatchObject({ update: { sentAt: expect.any(String) } });
  expect((await request('POST', `/updates/${id}/send`, undefined, admin)).status).toBe(409);
  expect((await request('PUT', `/updates/${id}`, { content }, admin)).status).toBe(409);
  expect((await request('DELETE', `/updates/${id}`, undefined, admin)).status).toBe(409);

  // Unsubscribed after sending: the worker skips the account
  const { unsubscribeToken } = await userRow(leaving);
  await request('POST', `/updates/unsubscribe?token=${unsubscribeToken}`);

  const queued = await db
    .select({ email: users.email })
    .from(updateDeliveries)
    .innerJoin(users, eq(users.id, updateDeliveries.userId))
    .where(eq(updateDeliveries.updateId, id));
  expect(queued.map((row) => row.email)).toEqual(expect.arrayContaining([subscriber, leaving]));
  expect(queued.map((row) => row.email)).not.toContain(bystander);

  while ((await deliverNext(db, 0)) !== 'idle');
  // Right after a mail the pace holds every worker back
  expect(await deliverNext(db, 60_000)).toBe('wait');
  const statuses = Object.fromEntries(
    (
      await db
        .select({ email: users.email, status: updateDeliveries.status })
        .from(updateDeliveries)
        .innerJoin(users, eq(users.id, updateDeliveries.userId))
        .where(eq(updateDeliveries.updateId, id))
    ).map((row) => [row.email, row.status]),
  );
  expect(statuses[subscriber]).toBe('sent');
  expect(statuses[leaving]).toBe('skipped');
  expect(log.mock.calls.some((args) => String(args[0]).startsWith(`[mail] To ${subscriber}: New in ${APP_NAME}`))).toBe(
    true,
  );

  const list = await read(
    request('GET', '/updates', undefined, admin),
    z.object({ subscribers: z.number(), updates: z.array(z.looseObject({ id: z.string() })) }),
  );
  expect(list.subscribers).toBeGreaterThan(0);
  expect(list.updates.find((update) => update.id === id)).toMatchObject({ pending: 0 });
});

test('failed deliveries wait a minute, then are tried again, and are given up after three attempts', async () => {
  const admin = await session(ADMIN);
  const subscriber = freshEmail();
  await logInWithLink(subscriber, true);
  const { update } = await read(request('POST', '/updates', { content }, admin), updateAnswer);
  await body(request('POST', `/updates/${update.id}/send`, undefined, admin));
  // Only this subscriber's delivery, the database keeps the accounts of earlier runs
  const { id: userId } = await userRow(subscriber);
  await db
    .delete(updateDeliveries)
    .where(and(eq(updateDeliveries.updateId, update.id), ne(updateDeliveries.userId, userId)));
  const outage = async () => {
    throw new Error('451 4.7.1 Try again later');
  };
  const deliveries = () =>
    db
      .select({ status: updateDeliveries.status, attempts: updateDeliveries.attempts })
      .from(updateDeliveries)
      .where(eq(updateDeliveries.updateId, update.id));
  // The pause after a failure is over
  const pause = () =>
    db
      .update(updateDeliveries)
      .set({ attemptedAt: sql`now() - interval '2 minutes'` })
      .where(eq(updateDeliveries.updateId, update.id));

  const errors = spyOn(console, 'error');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const results: string[] = [];
    for (let result = await deliverNext(db, 0, outage); result !== 'idle'; result = await deliverNext(db, 0, outage))
      results.push(result);
    expect(new Set(results)).toEqual(new Set(['failed']));
    const rows = await deliveries();
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.attempts))).toEqual(new Set([attempt]));
    expect(new Set(rows.map((row) => row.status))).toEqual(new Set([attempt < 3 ? 'pending' : 'failed']));
    await pause();
  }
  expect(errors.mock.calls.every((args) => !String(args[0]).includes(subscriber))).toBe(true);
  errors.mockRestore();

  // Given up for good, a working mail server changes nothing
  const sent: string[] = [];
  expect(await deliverNext(db, 0, async ({ to }) => void sent.push(to))).toBe('idle');
  expect(sent).toEqual([]);
});

test('update mails carry one-click unsubscribe headers and a text version', () => {
  const mail = updateMail(
    { id: crypto.randomUUID(), content, hasImage: false, date: new Date('2026-10-13') },
    'de',
    'token-1',
  );
  expect(mail.headers['List-Unsubscribe']).toMatch(/^<.*\/api\/v1\/updates\/unsubscribe\?token=token-1>$/);
  expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  expect(mail.text).toContain('- Sprachen nach Familie');
  expect(mail.text).toContain('/unsubscribe?token=token-1');
  expect(mail.text).toContain('13. Oktober 2026');
});

test('drafts in updates/ parse, broken ones say why', () => {
  // Every draft in the repo, so a broken one fails the CI before a deploy
  expect(() => readDrafts()).not.toThrow();

  const dir = mkdtempSync(path.join(tmpdir(), 'updates-'));
  writeFileSync(path.join(dir, 'map.png'), PNG);
  const draft = parseDraft(
    '2026-10-13',
    '# de: Sprachfamilien\n\n- Eins\n- Zwei\n![](map.png)\n\n# en: Language families\n* One\n',
    dir,
  );
  expect(draft.content).toEqual({
    de: { title: 'Sprachfamilien', features: ['Eins', 'Zwei'] },
    en: { title: 'Language families', features: ['One'] },
  });
  expect(draft.image).toEqual(PNG);

  expect(() => parseDraft('x', '# de: Nur Deutsch\n- Eins', dir)).toThrow('needs a title');
  expect(() => parseDraft('x', 'Hallo\n# de: A\n- B\n# en: A\n- B', dir)).toThrow('line 1');

  writeFileSync(path.join(dir, 'broken.md'), '# de: Nur Deutsch\n- Eins');
  writeFileSync(path.join(dir, 'valid.md'), '# de: Deutsch\n- Eins\n# en: English\n- One');
  expect(() => readDrafts(dir)).toThrow('needs a title');
  const errors: unknown[] = [];
  expect(readDrafts(dir, (err) => errors.push(err)).map((entry) => entry.slug)).toEqual(['valid']);
  expect(errors).toHaveLength(1);
});

test('logged delivery errors carry no addresses', () => {
  const err = Object.assign(new Error('550 5.1.1 <lena@example.com>: Recipient address rejected'), {
    responseCode: 550,
  });
  expect(redact(err)).toStartWith('550 550 5.1.1');
  expect(redact(err)).not.toContain('lena');
});
