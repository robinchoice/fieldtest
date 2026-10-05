import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { createDb, migrateDb } from '@app/db';
import { createApp } from './app';

// Runs against DATABASE_URL. Only adds rows with fresh addresses, so the
// local dev database is safe to use.
const db = createDb(process.env.DATABASE_URL!);
const app = createApp(db);
const log = spyOn(console, 'log');

beforeAll(() => migrateDb(process.env.DATABASE_URL!));
afterAll(() => db.$client.end());

const freshEmail = () => `test-${crypto.randomUUID()}@example.com`;

// Rate limits live in the database, so each run counts against its own address
const ip = crypto.randomUUID();

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: JSON.stringify(body),
  });
}

// biome-ignore lint/suspicious/noExplicitAny: the tests check the shape with expect
async function body(res: Response | Promise<Response>): Promise<any> {
  return (await res).json();
}

// Without SMTP_HOST the login mail lands in the log
function lastMailedToken() {
  const mail = log.mock.calls.map((args) => String(args[0])).findLast((line) => line.startsWith('[mail]'));
  return mail?.match(/token=([0-9a-f]+)/)?.[1];
}

function lastMailedCode() {
  const mail = log.mock.calls.map((args) => String(args[0])).findLast((line) => line.startsWith('[mail]'));
  return mail?.match(/Dein Code: (\d{6})/)?.[1];
}

const otherCode = (code: string) => (code === '000000' ? '000001' : '000000');

test('health checks the database', async () => {
  const res = await app.request('/api/health');
  expect(res.status).toBe(200);
});

test('magic link logs in, creates the account and logs out', async () => {
  const email = freshEmail();
  expect((await post('/auth/magic-link', { email: ` ${email.toUpperCase()} ` })).status).toBe(200);
  const token = lastMailedToken()!;

  const verify = await post('/auth/verify', { token });
  expect(verify.status).toBe(200);
  expect((await body(verify)).user).toMatchObject({ email, name: email.split('@')[0] });
  const session = verify.headers.get('set-cookie')!.match(/session=([0-9a-f]+)/)![1]!;

  const me = await app.request('/api/v1/auth/me', { headers: { cookie: `session=${session}` } });
  expect((await body(me)).user.email).toBe(email);

  // Native clients send the same token as a bearer token
  const rename = await app.request('/api/v1/auth/me', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Robin' }),
  });
  expect((await body(rename)).user.name).toBe('Robin');

  expect((await post('/auth/verify', { token })).status).toBe(400);

  await post('/auth/logout', {}, { cookie: `session=${session}` });
  const after = await app.request('/api/v1/auth/me', { headers: { cookie: `session=${session}` } });
  expect((await body(after)).user).toBeNull();
});

test('a second login reuses the account', async () => {
  const email = freshEmail();
  const ids = [];
  for (let i = 0; i < 2; i++) {
    await post('/auth/magic-link', { email });
    ids.push((await body(post('/auth/verify', { token: lastMailedToken() }))).user.id);
  }
  expect(ids[0]).toBe(ids[1]);
});

test('protected routes need a session', async () => {
  const res = await app.request('/api/v1/auth/me', { method: 'PATCH', body: '{}' });
  expect(res.status).toBe(401);
});

test('login mails per address are rate limited', async () => {
  const email = freshEmail();
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await post('/auth/magic-link', { email })).status);
  expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
});

test('invalid input answers with an error message', async () => {
  const res = await post('/auth/magic-link', { email: 'no-address' });
  expect(res.status).toBe(400);
  expect(typeof (await body(res)).error).toBe('string');
});

test('apps log in with a code and get a bearer token', async () => {
  const email = freshEmail();
  expect((await post('/auth/code', { email })).status).toBe(200);
  const code = lastMailedCode()!;

  expect((await post('/auth/code/verify', { email, code: otherCode(code) })).status).toBe(400);
  const verify = await post('/auth/code/verify', { email, code });
  expect(verify.status).toBe(200);
  expect(verify.headers.get('set-cookie')).toBeNull();
  const { user, token } = await body(verify);
  expect(user.email).toBe(email);

  const me = await app.request('/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } });
  expect((await body(me)).user.id).toBe(user.id);

  expect((await post('/auth/code/verify', { email, code })).status).toBe(400);
});

test('a code stops working after five wrong tries', async () => {
  const email = freshEmail();
  await post('/auth/code', { email });
  const code = lastMailedCode()!;
  for (let i = 0; i < 5; i++) await post('/auth/code/verify', { email, code: otherCode(code) });
  expect((await post('/auth/code/verify', { email, code })).status).toBe(400);
});
