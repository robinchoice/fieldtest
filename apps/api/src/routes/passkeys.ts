import { passkeyChallenges, passkeys, users } from '@app/db';
import { APP_NAME, type Passkey, passkeyLoginSchema, passkeyRegisterSchema } from '@app/shared';
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { t } from '../lib/i18n';
import { relyingParty } from '../lib/passkeys';
import { clientIp, rateLimit, tooManyRequests } from '../lib/rate-limit';
import { validJson } from '../lib/validate';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';
import { respondWithSession } from './auth';

const MINUTE = 60 * 1000;
// The login page asks for options on every visit, for the autofill
const optionsPerIp = rateLimit('passkey-options-per-ip', 60, 15 * MINUTE);
const loginsPerIp = rateLimit('passkey-logins-per-ip', 30, 15 * MINUTE);

// A challenge is good for one ceremony within five minutes. Expired ones go
// whenever a new one is made.
async function saveChallenge(c: Context<AppEnv>, challenge: string, userId: string | null) {
  const db = c.get('db');
  await db.delete(passkeyChallenges).where(lt(passkeyChallenges.expiresAt, new Date()));
  await db.insert(passkeyChallenges).values({ challenge, userId, expiresAt: new Date(Date.now() + 5 * MINUTE) });
}

// Deleting it in the check keeps it single-use even when two requests race
function useChallenge(c: Context<AppEnv>, userId: string | null) {
  return async (challenge: string) => {
    const used = await c
      .get('db')
      .delete(passkeyChallenges)
      .where(
        and(
          eq(passkeyChallenges.challenge, challenge),
          userId ? eq(passkeyChallenges.userId, userId) : isNull(passkeyChallenges.userId),
          gt(passkeyChallenges.expiresAt, new Date()),
        ),
      )
      .returning({ challenge: passkeyChallenges.challenge });
    return used.length > 0;
  };
}

const passkeyColumns = {
  id: passkeys.id,
  backedUp: passkeys.backedUp,
  createdAt: passkeys.createdAt,
  lastUsedAt: passkeys.lastUsedAt,
};

const toPasskey = (row: { id: string; backedUp: boolean; createdAt: Date; lastUsedAt: Date | null }): Passkey => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
});

// Adding a passkey needs a session, so only existing accounts get one and the
// closed sign-up holds. New devices and recovery go through the mail.
export const passkeyRoutes = new Hono<AppEnv>()
  .get('/', requireAuth, async (c) => {
    const rows = await c
      .get('db')
      .select(passkeyColumns)
      .from(passkeys)
      .where(eq(passkeys.userId, c.get('user').id))
      .orderBy(passkeys.createdAt);
    return c.json({ passkeys: rows.map(toPasskey) });
  })

  .post('/register/options', requireAuth, async (c) => {
    if (!(await optionsPerIp.hit(c, clientIp(c)))) return tooManyRequests(c);
    const user = c.get('user');
    const existing = await c
      .get('db')
      .select({ id: passkeys.id, transports: passkeys.transports })
      .from(passkeys)
      .where(eq(passkeys.userId, user.id));
    const options = await generateRegistrationOptions({
      rpName: APP_NAME,
      rpID: relyingParty().rpID,
      userName: user.email,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.id),
      excludeCredentials: existing.map(({ id, transports }) => ({ id, transports: transports ?? undefined })),
      // Discoverable, so the login needs no address and the browser can offer it as autofill
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    await saveChallenge(c, options.challenge, user.id);
    return c.json(options);
  })

  .post('/register', requireAuth, validJson(passkeyRegisterSchema), async (c) => {
    const user = c.get('user');
    const { rpID, origins } = relyingParty();
    const result = await verifyRegistrationResponse({
      response: c.req.valid('json').response as unknown as RegistrationResponseJSON,
      expectedChallenge: useChallenge(c, user.id),
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: false,
    }).catch(() => null);
    if (!result?.verified) return c.json({ error: t(c).passkeyFailed }, 400);

    const { credential, credentialBackedUp } = result.registrationInfo;
    const [row] = await c
      .get('db')
      .insert(passkeys)
      .values({
        id: credential.id,
        userId: user.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? null,
        backedUp: credentialBackedUp,
      })
      .onConflictDoNothing({ target: passkeys.id })
      .returning(passkeyColumns);
    if (!row) return c.json({ error: t(c).passkeyFailed }, 409);
    return c.json({ passkey: toPasskey(row) });
  })

  .delete('/:id', requireAuth, async (c) => {
    const [row] = await c
      .get('db')
      .delete(passkeys)
      .where(and(eq(passkeys.id, c.req.param('id')), eq(passkeys.userId, c.get('user').id)))
      .returning({ id: passkeys.id });
    if (!row) return c.json({ error: t(c).notFound }, 404);
    return c.json({ ok: true });
  })

  .post('/login/options', async (c) => {
    if (!(await optionsPerIp.hit(c, clientIp(c)))) return tooManyRequests(c);
    // No allowCredentials: the authenticator offers the passkeys it holds for this domain
    const options = await generateAuthenticationOptions({ rpID: relyingParty().rpID, userVerification: 'preferred' });
    await saveChallenge(c, options.challenge, null);
    return c.json(options);
  })

  .post('/login', validJson(passkeyLoginSchema), async (c) => {
    if (!(await loginsPerIp.hit(c, clientIp(c)))) return tooManyRequests(c);
    const { response, cookie } = c.req.valid('json');
    const db = c.get('db');
    const [passkey] = await db
      .select({
        id: passkeys.id,
        publicKey: passkeys.publicKey,
        counter: passkeys.counter,
        transports: passkeys.transports,
        email: users.email,
      })
      .from(passkeys)
      .innerJoin(users, eq(users.id, passkeys.userId))
      .where(eq(passkeys.id, response.id));
    // Removed here, still on the device. The web asks the browser to forget it.
    if (!passkey) return c.json({ error: t(c).passkeyUnknown, code: 'passkeyUnknown' }, 400);

    const { rpID, origins } = relyingParty();
    const result = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge: useChallenge(c, null),
      expectedOrigin: origins,
      expectedRPID: rpID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports ?? undefined,
      },
      requireUserVerification: false,
    }).catch(() => null);
    if (!result?.verified) return c.json({ error: t(c).passkeyFailed }, 400);

    await db
      .update(passkeys)
      .set({
        counter: result.authenticationInfo.newCounter,
        backedUp: result.authenticationInfo.credentialBackedUp,
        lastUsedAt: new Date(),
      })
      .where(eq(passkeys.id, passkey.id));
    return respondWithSession(c, passkey.email, false, cookie);
  });
