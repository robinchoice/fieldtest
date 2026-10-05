import { sessions, users } from '@app/db';
import { and, eq, gt } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { t } from '../lib/i18n';
import type { AppEnv } from '../types';

export const SESSION_COOKIE = 'session';

export function generateToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
}

// Only hashes are stored, so a leaked database holds no usable tokens.
export function hashToken(token: string) {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

// Native clients such as mobile apps have no cookie jar and send the
// session token as a bearer token instead.
export function sessionToken(c: Context) {
  const header = c.req.header('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
  return getCookie(c, SESSION_COOKIE) ?? (bearer || undefined);
}

export async function currentUser(c: Context<AppEnv>) {
  const token = sessionToken(c);
  if (!token) return null;
  const [user] = await c
    .get('db')
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return user ?? null;
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: t(c).notLoggedIn }, 401);
  c.set('user', user);
  await next();
});
