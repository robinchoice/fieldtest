import { sessions, users } from '@app/db';
import { and, eq, gt } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { t } from '../lib/i18n';
import type { AppEnv } from '../types';

export const SESSION_COOKIE = 'session';
export const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export function generateToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
}

// Only hashes are stored, so a leaked database holds no usable tokens.
export function hashToken(token: string) {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

// Native clients such as mobile apps have no cookie jar and send the
// session token as a bearer token instead.
export function bearerToken(c: Context) {
  const header = c.req.header('authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() || undefined : undefined;
}

export function sessionToken(c: Context) {
  return getCookie(c, SESSION_COOKIE) ?? bearerToken(c);
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: (SESSION_DAYS * DAY) / 1000,
  });
}

export async function currentUser(c: Context<AppEnv>) {
  const token = sessionToken(c);
  if (!token) return null;
  const db = c.get('db');
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;

  // Sessions in use don't expire: at most once a day they run SESSION_DAYS
  // from now again, the cookie with them.
  if (row.expiresAt.getTime() < Date.now() + (SESSION_DAYS - 1) * DAY) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_DAYS * DAY) })
      .where(eq(sessions.id, row.sessionId));
    if (getCookie(c, SESSION_COOKIE)) setSessionCookie(c, token);
  }
  return { id: row.id, email: row.email, name: row.name };
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: t(c).notLoggedIn }, 401);
  c.set('user', user);
  await next();
});
