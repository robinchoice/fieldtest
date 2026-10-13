import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { createDb, migrateDb, sessions, users } from '@app/db';
import { eq } from 'drizzle-orm';
import { createApp } from './app';
import { generateToken, hashToken } from './middleware/auth';

// Runs against DATABASE_URL. Only adds rows with fresh addresses, so the
// local dev database is safe to use.
const db = createDb(process.env.DATABASE_URL!);
const app = createApp(db);
const log = spyOn(console, 'log');

beforeAll(() => migrateDb(process.env.DATABASE_URL!));
afterAll(() => db.$client.end());

// Most tests sign up fresh addresses, the closed case has its own test
process.env.SIGNUP_OPEN = 'true';

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
function lastMail() {
  return log.mock.calls.map((args) => String(args[0])).findLast((line) => line.startsWith('[mail]'));
}

const mailCount = () => log.mock.calls.filter((args) => String(args[0]).startsWith('[mail]')).length;

function lastMailedToken() {
  return lastMail()?.match(/token=([0-9a-f]+)/)?.[1];
}

function lastMailedCode() {
  return lastMail()?.match(/Dein Code: (\d{6})/)?.[1];
}

const otherCode = (code: string) => (code === '000000' ? '000001' : '000000');

test('health checks the database', async () => {
  const res = await app.request('/api/health');
  expect(res.status).toBe(200);
  expect(await body(res)).toMatchObject({ status: 'ok', revision: expect.any(String) });
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

test('closed sign-up mails only existing accounts and the allowlist', async () => {
  const allowed = freshEmail();
  const [existing] = await db.insert(users).values({ email: freshEmail(), name: 'Lena' }).returning();
  delete process.env.SIGNUP_OPEN;
  process.env.SIGNUP_ALLOWLIST = ` ${allowed.toUpperCase()} , someone@example.com`;
  try {
    const mails = mailCount();
    const stranger = freshEmail();
    const link = await post('/auth/magic-link', { email: stranger });
    expect(link.status).toBe(403);
    expect((await body(link)).error).toBe(
      'Die Registrierung ist noch geschlossen. Für diese Adresse gibt es noch kein Konto.',
    );
    expect((await post('/auth/code', { email: stranger })).status).toBe(403);
    expect(mailCount()).toBe(mails);

    expect((await post('/auth/code', { email: existing!.email })).status).toBe(200);
    expect((await post('/auth/magic-link', { email: allowed })).status).toBe(200);
    expect((await body(post('/auth/verify', { token: lastMailedToken() }))).user.email).toBe(allowed);

    const run = Bun.spawnSync(['bun', 'src/login-link.ts', stranger], {
      env: { ...process.env, APP_URL: 'https://app.test' },
    });
    expect(run.exitCode).toBe(1);
    expect(run.stdout.toString()).toBe('');
    expect(run.stderr.toString()).toContain('Sign-up is closed for this address');
    expect(await db.select().from(users).where(eq(users.email, stranger))).toEqual([]);

    const existingLink = Bun.spawnSync(['bun', 'src/login-link.ts', existing!.email], {
      env: { ...process.env, APP_URL: 'https://app.test' },
    });
    expect(existingLink.exitCode).toBe(0);
    const token = new URL(existingLink.stdout.toString().trim()).searchParams.get('token');
    expect((await body(post('/auth/verify', { token }))).user.email).toBe(existing!.email);
  } finally {
    process.env.SIGNUP_OPEN = 'true';
    delete process.env.SIGNUP_ALLOWLIST;
  }
});

test('links and codes cannot create accounts after sign-up closes', async () => {
  const headers = { 'x-forwarded-for': crypto.randomUUID() };
  const linkEmail = freshEmail();
  const codeEmail = freshEmail();
  expect((await post('/auth/magic-link', { email: linkEmail }, headers)).status).toBe(200);
  const token = lastMailedToken();
  expect((await post('/auth/code', { email: codeEmail }, headers)).status).toBe(200);
  const code = lastMailedCode();
  const previousAllowlist = process.env.SIGNUP_ALLOWLIST;
  delete process.env.SIGNUP_OPEN;
  process.env.SIGNUP_ALLOWLIST = '';
  try {
    expect((await post('/auth/verify', { token }, headers)).status).toBe(403);
    expect((await post('/auth/code/verify', { email: codeEmail, code }, headers)).status).toBe(403);
    expect(await db.select().from(users).where(eq(users.email, linkEmail))).toEqual([]);
    expect(await db.select().from(users).where(eq(users.email, codeEmail))).toEqual([]);

    const allowed = freshEmail();
    process.env.SIGNUP_ALLOWLIST = allowed;
    expect((await post('/auth/magic-link', { email: allowed }, headers)).status).toBe(200);
    const allowedToken = lastMailedToken();
    process.env.SIGNUP_ALLOWLIST = '';
    expect((await post('/auth/verify', { token: allowedToken }, headers)).status).toBe(403);
    expect(await db.select().from(users).where(eq(users.email, allowed))).toEqual([]);
  } finally {
    process.env.SIGNUP_OPEN = 'true';
    if (previousAllowlist === undefined) delete process.env.SIGNUP_ALLOWLIST;
    else process.env.SIGNUP_ALLOWLIST = previousAllowlist;
  }
});

async function sessionFor(email: string) {
  const [user] = await db.insert(users).values({ email, name: 'Robin' }).returning({ id: users.id });
  const token = generateToken();
  await db
    .insert(sessions)
    .values({ userId: user!.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) });
  return { cookie: `session=${token}` };
}

test('admins invite testers past the closed sign-up, others get 403', async () => {
  const admin = freshEmail();
  const asAdmin = await sessionFor(admin);
  const asUser = await sessionFor(freshEmail());
  delete process.env.SIGNUP_OPEN;
  process.env.ADMIN_EMAILS = `someone@example.com, ${admin.toUpperCase()}`;
  try {
    const me = await app.request('/api/v1/auth/me', { headers: asAdmin });
    expect((await body(me)).user.admin).toBe(true);

    const tester = freshEmail();
    expect((await post('/auth/invite', { email: tester })).status).toBe(401);
    const denied = await post('/auth/invite', { email: tester }, asUser);
    expect(denied.status).toBe(403);
    expect((await body(denied)).error).toBe('Nur für Admins');
    expect(await db.select().from(users).where(eq(users.email, tester))).toEqual([]);

    expect((await post('/auth/invite', { email: tester }, asAdmin)).status).toBe(200);
    expect(lastMail()).toStartWith(`[mail] To ${tester}:`);
    const verify = await body(post('/auth/verify', { token: lastMailedToken() }));
    expect(verify.user).toMatchObject({ email: tester, admin: false });

    // From now on the tester logs in like any existing account
    expect((await post('/auth/magic-link', { email: tester })).status).toBe(200);
    expect(process.env.SIGNUP_OPEN).toBeUndefined();
  } finally {
    process.env.SIGNUP_OPEN = 'true';
    delete process.env.ADMIN_EMAILS;
  }
});

test('login-link prints a magic link that logs in', async () => {
  const email = freshEmail();
  const run = Bun.spawnSync(['bun', 'src/login-link.ts', email], {
    env: { ...process.env, APP_URL: 'https://app.test' },
  });
  const link = new URL(run.stdout.toString().trim());
  expect(link.origin + link.pathname).toBe('https://app.test/auth/verify');

  const verify = await post('/auth/verify', { token: link.searchParams.get('token') });
  expect((await body(verify)).user.email).toBe(email);
});

test('login-link requires APP_URL before issuing a link', () => {
  const run = Bun.spawnSync(['bun', 'src/login-link.ts', freshEmail()], {
    env: { ...process.env, APP_URL: '' },
  });
  expect(run.exitCode).toBe(1);
  expect(run.stdout.toString()).toBe('');
  expect(run.stderr.toString()).toContain('APP_URL is required');
});

test('a session in use is renewed', async () => {
  const [user] = await db.insert(users).values({ email: freshEmail(), name: 'Lena' }).returning({ id: users.id });
  const token = generateToken();
  const [session] = await db
    .insert(sessions)
    .values({ userId: user!.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) })
    .returning({ id: sessions.id });

  const me = await app.request('/api/v1/auth/me', { headers: { cookie: `session=${token}` } });
  expect(me.headers.get('set-cookie')).toContain(`session=${token}`);
  const [renewed] = await db.select().from(sessions).where(eq(sessions.id, session!.id));
  expect(renewed!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);

  // Renewed sessions are left alone for a day
  const again = await app.request('/api/v1/auth/me', { headers: { cookie: `session=${token}` } });
  expect(again.headers.get('set-cookie')).toBeNull();
});
