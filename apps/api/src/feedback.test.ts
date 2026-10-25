import { afterAll, afterEach, beforeAll, expect, spyOn, test } from 'bun:test';
import { appFeedback, createDb, migrateDb, sessions, users } from '@app/db';
import { eq } from 'drizzle-orm';
import { createApp } from './app';
import { generateToken, hashToken, sessionExpiry } from './middleware/auth';

const db = createDb(process.env.DATABASE_URL);
const app = createApp(db);
const log = spyOn(console, 'log');

beforeAll(() => migrateDb(process.env.DATABASE_URL));
afterAll(() => db.$client.end());
afterEach(() => {
  delete process.env.FEEDBACK_EMAIL;
  delete process.env.FEEDBACK_GITHUB_TOKEN;
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.ADMIN_EMAILS;
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');

const context = {
  platform: 'web',
  page: '/dashboard',
  device: 'Chrome 141 · macOS',
  viewport: '1440×900 @2x',
  locale: 'de',
  errors: ['POST /api/v1/things → 500'],
};

async function logIn() {
  const email = `test-${crypto.randomUUID()}@example.com`;
  const [user] = await db.insert(users).values({ email, name: 'Lena' }).returning({ id: users.id });
  const token = generateToken();
  await db.insert(sessions).values({ userId: user!.id, tokenHash: hashToken(token), expiresAt: sessionExpiry() });
  return { id: user!.id, email, token };
}

function send(token: string | null, body: unknown) {
  return app.request('/api/v1/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const lastMail = () => log.mock.calls.map((args) => String(args[0])).findLast((line) => line.startsWith('[mail]'));

test('feedback needs a login', async () => {
  expect((await send(null, { kind: 'idea', message: 'Mehr Farben', context })).status).toBe(401);
});

test('a bug report is stored, mailed with reply-to the tester and filed as an issue', async () => {
  const tester = await logIn();
  process.env.FEEDBACK_EMAIL = 'robin@example.com';
  process.env.FEEDBACK_GITHUB_TOKEN = 'token';
  process.env.GITHUB_REPOSITORY = 'robinchoice/fieldtest';
  const github = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    Response.json({ html_url: 'https://github.com/robinchoice/fieldtest/issues/7' }, { status: 201 }),
  );

  const res = await send(tester.token, {
    kind: 'bug',
    message: 'Export geht nicht\nEs kommt nur ein Fehler.',
    screenshot: PNG,
    context,
  });
  const [url, init] = github.mock.calls[0]!;
  github.mockRestore();
  expect(res.status).toBe(200);

  const [row] = await db.select().from(appFeedback).where(eq(appFeedback.userId, tester.id));
  expect(row).toMatchObject({ kind: 'bug', issueUrl: 'https://github.com/robinchoice/fieldtest/issues/7' });
  expect(row!.context).toMatchObject({ ...context, api: 'dev' });

  expect(url).toBe('https://api.github.com/repos/robinchoice/fieldtest/issues');
  const issue = JSON.parse(String(init!.body));
  expect(issue.title).toBe('Feedback: Export geht nicht');
  expect(issue.labels).toEqual(['feedback', 'bug', 'web']);
  expect(issue.body).toContain('> Es kommt nur ein Fehler.');
  expect(issue.body).toContain(row!.id);
  expect(issue.body).not.toContain('/screenshot');
  expect(issue.body).not.toContain(PNG);
  expect(issue.body).not.toContain(tester.email);

  expect(lastMail()).toStartWith('[mail] To robin@example.com: Bug from Lena: Export geht nicht');
  expect(lastMail()).toContain('Issue: https://github.com/robinchoice/fieldtest/issues/7');

  const screenshotUrl = `/api/v1/feedback/${row!.id}/screenshot`;
  expect((await app.request(screenshotUrl)).status).toBe(401);
  expect((await app.request(screenshotUrl, { headers: { authorization: `Bearer ${tester.token}` } })).status).toBe(403);

  const admin = await logIn();
  process.env.ADMIN_EMAILS = admin.email;
  const shot = await app.request(screenshotUrl, { headers: { authorization: `Bearer ${admin.token}` } });
  expect(shot.status).toBe(200);
  expect(shot.headers.get('content-type')).toBe('image/png');
  expect(shot.headers.get('cache-control')).toBe('no-store');
  expect(Buffer.from(await shot.arrayBuffer()).toString('base64')).toBe(PNG);
});

test('without GitHub and mail the feedback is still stored', async () => {
  const tester = await logIn();
  expect((await send(tester.token, { kind: 'idea', message: 'Dunkler Modus wäre schön', context })).status).toBe(200);
  const [row] = await db.select().from(appFeedback).where(eq(appFeedback.userId, tester.id));
  expect(row).toMatchObject({ kind: 'idea', screenshot: null, issueUrl: null });
});

test('a failing GitHub keeps the report and still mails it', async () => {
  const tester = await logIn();
  process.env.FEEDBACK_EMAIL = 'robin@example.com';
  process.env.FEEDBACK_GITHUB_TOKEN = 'token';
  process.env.GITHUB_REPOSITORY = 'robinchoice/fieldtest';
  const github = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('down', { status: 503 }));
  const error = spyOn(console, 'error').mockImplementation(() => {});

  expect((await send(tester.token, { kind: 'bug', message: 'Knopf fehlt', context })).status).toBe(200);
  github.mockRestore();
  error.mockRestore();
  expect(lastMail()).toStartWith('[mail] To robin@example.com: Bug from Lena: Knopf fehlt');
  expect((await db.select().from(appFeedback).where(eq(appFeedback.userId, tester.id))).length).toBe(1);
});

test('short messages and other files are refused', async () => {
  const tester = await logIn();
  const short = await send(tester.token, { kind: 'bug', message: 'ab', context });
  expect(short.status).toBe(400);
  expect(await short.json()).toEqual({ error: 'Schreib bitte mindestens 5 Zeichen.' });

  const html = Buffer.from('<html>').toString('base64');
  const file = await send(tester.token, { kind: 'bug', message: 'Mit Anhang', screenshot: html, context });
  expect(file.status).toBe(400);
});

test('unknown screenshots are not found', async () => {
  const admin = await logIn();
  process.env.ADMIN_EMAILS = admin.email;
  const headers = { authorization: `Bearer ${admin.token}` };
  expect((await app.request(`/api/v1/feedback/${crypto.randomUUID()}/screenshot`, { headers })).status).toBe(404);
  expect((await app.request('/api/v1/feedback/nope/screenshot', { headers })).status).toBe(404);
});
