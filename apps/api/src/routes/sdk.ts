import path from 'node:path';
import { claims, feedback, findings, rounds, runners, testers, testSessions, users } from '@app/db';
import { sdkEventsSchema, sdkFeedbackSchema, sdkStartSchema } from '@app/shared';
import { and, eq, inArray, max, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { evaluateLater } from '../lib/evaluate';
import { t } from '../lib/i18n';
import { clientIp, rateLimit, tooManyRequests } from '../lib/rate-limit';
import { runnerOnline } from '../lib/runners';
import { recordActivity, sessionState } from '../lib/sessions';
import { validJson } from '../lib/validate';
import { bearerToken, generateToken, hashToken } from '../middleware/auth';
import type { AppEnv } from '../types';

const MINUTE = 60 * 1000;
const startsPerIp = rateLimit('sdk-starts-per-ip', 20, 60 * MINUTE);
const reportsPerSession = rateLimit('sdk-reports-per-session', 40, MINUTE);
const feedbackPerSession = rateLimit('sdk-feedback-per-session', 30, 60 * MINUTE);

const OVERLAY_ENTRY = path.join(import.meta.dir, '../../../../packages/sdk/src/index.ts');
let overlay: Promise<string> | undefined;

// Built on first request and kept. In dev every request builds, so changes show up right away.
function overlayScript() {
  if (!overlay || process.env.NODE_ENV !== 'production') {
    overlay = Bun.build({ entrypoints: [OVERLAY_ENTRY], target: 'browser', minify: true }).then((result) => {
      if (!result.success) throw new Error(result.logs.join('\n'));
      return result.outputs[0]!.text();
    });
  }
  return overlay;
}

async function currentSession(c: Context<AppEnv>) {
  const token = bearerToken(c);
  const [row] = token
    ? await c
        .get('db')
        .select({ session: testSessions, round: rounds })
        .from(testSessions)
        .innerJoin(rounds, eq(rounds.id, testSessions.roundId))
        .where(eq(testSessions.tokenHash, hashToken(token)))
    : [];
  if (!row) throw new HTTPException(401, { message: t(c).sessionInvalid });
  return row;
}

// What testers see before they start: the rewards, and how reliably this owner pays
async function invitation(c: Context<AppEnv>, invite: string) {
  const db = c.get('db');
  const [row] = await db
    .select({ round: rounds, owner: users.name })
    .from(rounds)
    .innerJoin(users, eq(users.id, rounds.ownerId))
    .where(eq(rounds.inviteToken, invite));
  if (!row) return null;

  const [payouts, [runner]] = await Promise.all([
    db
      .select({ status: claims.status, approvedAt: claims.approvedAt, paidAt: claims.paidAt })
      .from(claims)
      .innerJoin(rounds, eq(rounds.id, claims.roundId))
      .where(and(eq(rounds.ownerId, row.round.ownerId), inArray(claims.status, ['approved', 'paying', 'paid']))),
    db.select().from(runners).where(eq(runners.ownerId, row.round.ownerId)),
  ]);
  const waits = payouts
    .filter((p) => p.status === 'paid' && p.approvedAt && p.paidAt)
    .map((p) => (p.paidAt!.getTime() - p.approvedAt!.getTime()) / 1000)
    .sort((a, b) => a - b);
  const { round } = row;
  return {
    product: round.product,
    name: round.name,
    owner: row.owner,
    goals: round.goals,
    rewards: round.rewards,
    paid: waits.length,
    payouts: payouts.length,
    medianSeconds: waits.length ? Math.round(waits[Math.floor(waits.length / 2)]!) : null,
    runnerOnline: runnerOnline(runner),
    budgetSats: runner?.budgetSats ?? null,
  };
}

// The tester overlay talks to these routes from the prototype's origin, so they allow any origin.
// Testers have no account: a session token in the Authorization header identifies them.
export const sdkRoutes = new Hono<AppEnv>()
  .use(
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['content-type', 'authorization', 'accept-language'],
      maxAge: 86400,
    }),
  )

  .get('/overlay.js', async (c) =>
    c.body(await overlayScript(), 200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': process.env.NODE_ENV === 'production' ? 'public, max-age=300' : 'no-store',
    }),
  )

  .get('/rounds/:invite', async (c) => {
    const info = await invitation(c, c.req.param('invite'));
    return info ? c.json(info) : c.json({ error: t(c).inviteInvalid }, 404);
  })

  .post('/sessions', validJson(sdkStartSchema), async (c) => {
    if (!(await startsPerIp.hit(c, clientIp(c)))) return tooManyRequests(c);
    const { invite, lightningAddress } = c.req.valid('json');
    const db = c.get('db');
    const [round] = await db.select().from(rounds).where(eq(rounds.inviteToken, invite));
    if (!round) return c.json({ error: t(c).inviteInvalid }, 404);

    // The no-op update lets RETURNING yield existing testers too
    const [tester] = await db
      .insert(testers)
      .values({ lightningAddress })
      .onConflictDoUpdate({ target: testers.lightningAddress, set: { lightningAddress } })
      .returning({ id: testers.id });
    const token = generateToken();
    const [session] = await db
      .insert(testSessions)
      .values({ roundId: round.id, testerId: tester!.id, tokenHash: hashToken(token) })
      .returning();
    return c.json({ token, state: await sessionState(db, session!, round) });
  })

  .get('/session', async (c) => {
    const { session, round } = await currentSession(c);
    return c.json(await sessionState(c.get('db'), session, round));
  })

  .post('/session/events', validJson(sdkEventsSchema), async (c) => {
    const { session, round } = await currentSession(c);
    if (!(await reportsPerSession.hit(c, session.id))) return tooManyRequests(c);
    const db = c.get('db');
    const fresh = await recordActivity(db, session, round, c.req.valid('json'));
    return c.json(await sessionState(db, fresh!, round));
  })

  // Every report starts as its own finding. The evaluation (lib/evaluate.ts) or the owner merges duplicates.
  .post('/session/feedback', validJson(sdkFeedbackSchema), async (c) => {
    const { session, round } = await currentSession(c);
    if (session.endedAt) return c.json({ error: t(c).sessionEnded }, 409);
    if (!(await feedbackPerSession.hit(c, session.id))) return tooManyRequests(c);
    const { type, text, anchor } = c.req.valid('json');
    const db = c.get('db');

    const report = await db.transaction(async (tx) => {
      await tx.select({ id: rounds.id }).from(rounds).where(eq(rounds.id, round.id)).for('no key update');
      const [{ last }] = (await tx
        .select({ last: max(findings.number) })
        .from(findings)
        .where(eq(findings.roundId, round.id))) as [{ last: number | null }];
      const firstLine = text.split('\n')[0]!;
      const [finding] = await tx
        .insert(findings)
        .values({
          roundId: round.id,
          number: (last ?? 0) + 1,
          severity: type === 'idea' ? 'idea' : null,
          title: firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine,
          screen: anchor.screen,
        })
        .returning({ id: findings.id });
      const [report] = await tx
        .insert(feedback)
        .values({
          sessionId: session.id,
          findingId: finding!.id,
          type,
          text,
          anchorLabel: anchor.label,
          anchorScreen: anchor.screen,
          auto: anchor.auto,
        })
        .returning({ id: feedback.id });
      return report!;
    });
    evaluateLater(db, report.id);
    await db.update(testSessions).set({ lastSeenAt: new Date() }).where(eq(testSessions.id, session.id));
    return c.json(await sessionState(db, session, round));
  })

  .post('/session/end', async (c) => {
    const { session, round } = await currentSession(c);
    const db = c.get('db');
    const [ended] = await db
      .update(testSessions)
      .set({ endedAt: sql`coalesce(${testSessions.endedAt}, now())` })
      .where(eq(testSessions.id, session.id))
      .returning();
    return c.json(await sessionState(db, ended!, round));
  });
