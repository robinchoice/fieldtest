import { claims, rounds, runners, testers } from '@app/db';
import { runnerFailedSchema, runnerPaidSchema, runnerStatusSchema } from '@app/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { approveDueClaims } from '../lib/claims';
import { t } from '../lib/i18n';
import { checkPayment } from '../lib/payments';
import { validJson } from '../lib/validate';
import { bearerToken, generateToken, hashToken, requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

// The runner sends its key as a bearer token. Only the hash is stored.
const requireRunner = createMiddleware<AppEnv>(async (c, next) => {
  const key = bearerToken(c);
  const [runner] = key
    ? await c
        .get('db')
        .update(runners)
        .set({ lastSeenAt: new Date() })
        .where(eq(runners.keyHash, hashToken(key)))
        .returning({ id: runners.id, ownerId: runners.ownerId })
    : [];
  if (!runner) return c.json({ error: t(c).runnerKeyInvalid }, 401);
  c.set('runner', runner);
  await next();
});

async function ownerRoundIds(c: Context<AppEnv>) {
  const rows = await c
    .get('db')
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.ownerId, c.get('runner').ownerId));
  return rows.map((r) => r.id);
}

// Moves a claim of this runner's owner from one status to the next, or answers 409
async function moveClaim(c: Context<AppEnv>, from: string, set: Partial<typeof claims.$inferInsert>) {
  const ids = await ownerRoundIds(c);
  if (!ids.length) return null;
  const [claim] = await c
    .get('db')
    .update(claims)
    .set(set)
    .where(and(eq(claims.id, c.req.param('id')!), eq(claims.status, from), inArray(claims.roundId, ids)))
    .returning();
  return claim ?? null;
}

export const runnerRoutes = new Hono<AppEnv>()
  // For the owner: status and a new key. A new key replaces the old one.
  .get('/', requireAuth, async (c) => {
    const [runner] = await c
      .get('db')
      .select()
      .from(runners)
      .where(eq(runners.ownerId, c.get('user').id));
    return c.json({
      runner: runner
        ? { lastSeenAt: runner.lastSeenAt, budgetSats: runner.budgetSats, host: runner.host, version: runner.version }
        : null,
    });
  })

  .post('/key', requireAuth, async (c) => {
    const key = `ft_${generateToken()}`;
    await c
      .get('db')
      .insert(runners)
      .values({ ownerId: c.get('user').id, keyHash: hashToken(key) })
      .onConflictDoUpdate({ target: runners.ownerId, set: { keyHash: hashToken(key), lastSeenAt: null } });
    return c.json({ key });
  })

  // For the runner itself
  .post('/status', requireRunner, validJson(runnerStatusSchema), async (c) => {
    await c
      .get('db')
      .update(runners)
      .set(c.req.valid('json'))
      .where(eq(runners.id, c.get('runner').id));
    return c.json({ ok: true });
  })

  .get('/claims', requireRunner, async (c) => {
    const db = c.get('db');
    const ids = await ownerRoundIds(c);
    if (!ids.length) return c.json({ claims: [] });
    await approveDueClaims(db, ids);
    const rows = await db
      .select({
        id: claims.id,
        kind: claims.kind,
        amountSats: claims.amountSats,
        lightningAddress: testers.lightningAddress,
        product: rounds.product,
      })
      .from(claims)
      .innerJoin(testers, eq(testers.id, claims.testerId))
      .innerJoin(rounds, eq(rounds.id, claims.roundId))
      .where(and(inArray(claims.roundId, ids), eq(claims.status, 'approved')))
      .orderBy(claims.createdAt)
      .limit(50);
    return c.json({ claims: rows });
  })

  // Taking a claim stops it from growing, see addLiveReward, and from being paid twice
  .post('/claims/:id/lock', requireRunner, async (c) => {
    const claim = await moveClaim(c, 'approved', { status: 'paying' });
    return claim
      ? c.json({ claim: { id: claim.id, amountSats: claim.amountSats } })
      : c.json({ error: t(c).claimNotOpen }, 409);
  })

  .post('/claims/:id/paid', requireRunner, validJson(runnerPaidSchema), async (c) => {
    const proof = c.req.valid('json');
    const ids = await ownerRoundIds(c);
    const [claim] = ids.length
      ? await c
          .get('db')
          .select({ amountSats: claims.amountSats })
          .from(claims)
          .where(and(eq(claims.id, c.req.param('id')), eq(claims.status, 'paying'), inArray(claims.roundId, ids)))
      : [];
    if (!claim) return c.json({ error: t(c).claimNotOpen }, 409);
    const check = checkPayment(proof, claim.amountSats, process.env.ALLOW_FAKE_PAYMENTS === '1');
    if (check !== 'ok') return c.json({ error: t(c)[check] }, 400);
    const paid = await moveClaim(c, 'paying', {
      status: 'paid',
      paidAt: new Date(),
      invoice: proof.invoice,
      paymentHash: proof.paymentHash,
      preimage: proof.preimage,
      lastError: null,
    });
    return paid ? c.json({ ok: true }) : c.json({ error: t(c).claimNotOpen }, 409);
  })

  // A failed payment goes back to the queue, the runner tries again later
  .post('/claims/:id/failed', requireRunner, validJson(runnerFailedSchema), async (c) => {
    const claim = await moveClaim(c, 'paying', { status: 'approved', lastError: c.req.valid('json').error });
    return claim ? c.json({ ok: true }) : c.json({ error: t(c).claimNotOpen }, 409);
  });
