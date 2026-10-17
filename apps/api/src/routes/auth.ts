import { loginCodes, magicLinks, sessions, users } from '@app/db';
import {
  inviteSchema,
  loginCodeSchema,
  magicLinkSchema,
  safeNextPath,
  updateMeSchema,
  verifyCodeSchema,
  verifySchema,
} from '@app/shared';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { locale, t } from '../lib/i18n';
import { sendLoginCodeEmail, sendMagicLinkEmail } from '../lib/mail';
import { clientIp, rateLimit, tooManyRequests } from '../lib/rate-limit';
import { mayLogIn } from '../lib/signup';
import { validJson } from '../lib/validate';
import {
  consentNow,
  currentUser,
  generateToken,
  hashToken,
  requireAdmin,
  requireAuth,
  SESSION_COOKIE,
  SESSION_DAYS,
  sessionToken,
  setSessionCookie,
  toUser,
  userColumns,
} from '../middleware/auth';
import type { AppEnv } from '../types';

const MINUTE = 60 * 1000;
// Apps would otherwise ask for a new code every month
const APP_SESSION_DAYS = 365;
const CODE_ATTEMPTS = 5;
const mailsPerAddress = rateLimit('mails-per-address', 5, 60 * MINUTE);
const mailsPerIp = rateLimit('mails-per-ip', 20, 60 * MINUTE);
const codeChecksPerIp = rateLimit('code-checks-per-ip', 30, 15 * MINUTE);

// The first login creates the account, /magic-link and /code only send one
// to addresses that may sign up. Every login refreshes the language of the
// update mails. A ticked opt-in switches them on, an unticked one leaves them.
async function startSession(c: Context<AppEnv>, email: string, days: number, updates: boolean) {
  const db = c.get('db');
  const [user] = await db
    .insert(users)
    .values({ email, name: email.split('@')[0]!, locale: locale(c), updatesConsentAt: updates ? new Date() : null })
    .onConflictDoUpdate({
      target: users.email,
      set: { locale: locale(c), ...(updates && { updatesConsentAt: consentNow }) },
    })
    .returning(userColumns);

  const token = generateToken();
  await db.insert(sessions).values({
    userId: user!.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + days * 24 * 60 * MINUTE),
  });
  return { user: toUser(user!), token };
}

async function mailMagicLink(c: Context<AppEnv>, email: string, next: string | null, updatesOptIn: boolean) {
  const token = generateToken();
  await c
    .get('db')
    .insert(magicLinks)
    .values({
      email,
      tokenHash: hashToken(token),
      updatesOptIn,
      expiresAt: new Date(Date.now() + 15 * MINUTE),
    });
  await sendMagicLinkEmail(email, token, next, { locale: locale(c), updates: updatesOptIn });
}

export const authRoutes = new Hono<AppEnv>()
  .post('/magic-link', validJson(magicLinkSchema), async (c) => {
    const { email, next, updates } = c.req.valid('json');
    if (!(await mailsPerIp.hit(c, clientIp(c))) || !(await mailsPerAddress.hit(c, email))) return tooManyRequests(c);
    if (!(await mayLogIn(c.get('db'), email))) return c.json({ error: t(c).signupClosed }, 403);
    await mailMagicLink(c, email, safeNextPath(next), updates);
    return c.json({ ok: true });
  })

  // While sign-up is closed, admins invite single testers: the account exists
  // first, then the tester logs in like any other. SIGNUP_OPEN stays untouched.
  .post('/invite', requireAuth, requireAdmin, validJson(inviteSchema), async (c) => {
    const { email } = c.req.valid('json');
    if (!(await mailsPerIp.hit(c, clientIp(c))) || !(await mailsPerAddress.hit(c, email))) return tooManyRequests(c);
    await c
      .get('db')
      .insert(users)
      .values({ email, name: email.split('@')[0]! })
      .onConflictDoNothing();
    await mailMagicLink(c, email, null, false);
    return c.json({ ok: true });
  })

  .post('/verify', validJson(verifySchema), async (c) => {
    const db = c.get('db');

    // Marking the link as used in the same statement keeps it single-use
    // even when two requests race.
    const [link] = await db
      .update(magicLinks)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(magicLinks.tokenHash, hashToken(c.req.valid('json').token)),
          isNull(magicLinks.usedAt),
          gt(magicLinks.expiresAt, new Date()),
        ),
      )
      .returning({ email: magicLinks.email, updatesOptIn: magicLinks.updatesOptIn });
    if (!link) return c.json({ error: t(c).linkExpired }, 400);

    const { user, token } = await startSession(c, link.email, SESSION_DAYS, link.updatesOptIn);
    setSessionCookie(c, token);
    return c.json({ user });
  })

  // Mobile apps: a 6-digit code by mail instead of a link
  .post('/code', validJson(loginCodeSchema), async (c) => {
    const { email, updates } = c.req.valid('json');
    if (!(await mailsPerIp.hit(c, clientIp(c))) || !(await mailsPerAddress.hit(c, email))) return tooManyRequests(c);
    if (!(await mayLogIn(c.get('db'), email))) return c.json({ error: t(c).signupClosed }, 403);

    const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0');
    await c
      .get('db')
      .insert(loginCodes)
      .values({
        email,
        codeHash: hashToken(code),
        updatesOptIn: updates,
        expiresAt: new Date(Date.now() + 15 * MINUTE),
      });
    await sendLoginCodeEmail(email, code, { locale: locale(c), updates });
    return c.json({ ok: true });
  })

  // Answers with the session token, the app sends it as a bearer token
  .post('/code/verify', validJson(verifyCodeSchema), async (c) => {
    if (!(await codeChecksPerIp.hit(c, clientIp(c)))) return tooManyRequests(c);
    const { email, code } = c.req.valid('json');
    const db = c.get('db');

    // Every guess counts against all open codes of the address before the
    // comparison, so parallel requests can't get more than CODE_ATTEMPTS tries.
    const open = await db
      .update(loginCodes)
      .set({ attempts: sql`${loginCodes.attempts} + 1` })
      .where(
        and(
          eq(loginCodes.email, email),
          isNull(loginCodes.usedAt),
          gt(loginCodes.expiresAt, new Date()),
          lt(loginCodes.attempts, CODE_ATTEMPTS),
        ),
      )
      .returning({ id: loginCodes.id, codeHash: loginCodes.codeHash, updatesOptIn: loginCodes.updatesOptIn });
    const match = open.find((row) => row.codeHash === hashToken(code));
    if (!match) return c.json({ error: t(c).codeWrong }, 400);

    const [used] = await db
      .update(loginCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(loginCodes.id, match.id), isNull(loginCodes.usedAt)))
      .returning({ id: loginCodes.id });
    if (!used) return c.json({ error: t(c).codeWrong }, 400);

    return c.json(await startSession(c, email, APP_SESSION_DAYS, match.updatesOptIn));
  })

  .post('/logout', async (c) => {
    const token = sessionToken(c);
    if (token)
      await c
        .get('db')
        .delete(sessions)
        .where(eq(sessions.tokenHash, hashToken(token)));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  })

  .get('/me', async (c) => c.json({ user: await currentUser(c) }))

  .patch('/me', requireAuth, validJson(updateMeSchema), async (c) => {
    const { name, updates } = c.req.valid('json');
    const [user] = await c
      .get('db')
      .update(users)
      .set({
        name,
        ...(updates !== undefined && {
          updatesConsentAt: updates ? consentNow : null,
          locale: locale(c),
        }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, c.get('user').id))
      .returning(userColumns);
    return c.json({ user: toUser(user!) });
  });
