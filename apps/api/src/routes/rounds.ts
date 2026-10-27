import { claims, type Database, events, feedback, findings, rounds, runners, testers, testSessions } from '@app/db';
import {
  createRoundSchema,
  DEFAULT_REWARDS,
  mergeFindingSchema,
  type Severity,
  updateFindingSchema,
  updateRoundSchema,
} from '@app/shared';
import { and, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { approveClaim, approveDueClaims, lowerClaim, mergeFinding, rejectClaim, settleFinding } from '../lib/claims';
import { t } from '../lib/i18n';
import { runnerOnline } from '../lib/runners';
import { validJson } from '../lib/validate';
import { generateToken, requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const SEVERITY_WEIGHT: Record<Severity, number> = { blocker: 8, major: 4, minor: 2, idea: 1.5, cosmetic: 1 };
// Testers count as "testing now" when the overlay reported within this time
const LIVE_MS = 60 * 1000;

const handle = (lightningAddress: string) => lightningAddress.split('@')[0]!;

// New findings without severity need a look first, then by impact, dismissed ones last
const rank = (f: { status: string; severity: string | null; sessions: number }) =>
  f.status === 'dismissed' ? -1 : f.severity ? SEVERITY_WEIGHT[f.severity as Severity] * f.sessions : 1e6;

export const inviteUrl = (round: { prototypeUrl: string; inviteToken: string }) =>
  `${round.prototypeUrl}${round.prototypeUrl.includes('?') ? '&' : '?'}fieldtest=${round.inviteToken}`;

async function ownRound(c: Context<AppEnv>) {
  const [round] = await c
    .get('db')
    .select()
    .from(rounds)
    .where(and(eq(rounds.id, c.req.param('id')!), eq(rounds.ownerId, c.get('user').id)));
  if (!round) throw new HTTPException(404, { message: t(c).notFound });
  return round;
}

async function ownFinding(c: Context<AppEnv>, roundId: string, findingId: string) {
  const [finding] = await c
    .get('db')
    .select()
    .from(findings)
    .where(and(eq(findings.id, findingId), eq(findings.roundId, roundId)));
  if (!finding) throw new HTTPException(404, { message: t(c).notFound });
  return finding;
}

// Findings with who reported them and how many sessions ran into the same spot.
// Friction the overlay noticed on its own counts too, not only written feedback.
async function findingList(c: Context<AppEnv>, roundId: string) {
  const db = c.get('db');
  const [rows, reports, friction] = await Promise.all([
    db.select().from(findings).where(eq(findings.roundId, roundId)),
    db
      .select({
        findingId: feedback.findingId,
        sessionId: feedback.sessionId,
        label: feedback.anchorLabel,
        screen: feedback.anchorScreen,
        at: feedback.createdAt,
        address: testers.lightningAddress,
      })
      .from(feedback)
      .innerJoin(testSessions, eq(testSessions.id, feedback.sessionId))
      .innerJoin(testers, eq(testers.id, testSessions.testerId))
      .where(eq(testSessions.roundId, roundId))
      .orderBy(feedback.createdAt),
    db
      .select({ sessionId: events.sessionId, label: events.label, screen: events.screen })
      .from(events)
      .innerJoin(testSessions, eq(testSessions.id, events.sessionId))
      .where(and(eq(testSessions.roundId, roundId), eq(events.kind, 'friction'))),
  ]);

  return rows
    .map((finding) => {
      const own = reports.filter((r) => r.findingId === finding.id);
      const first = own[0];
      const sessions = new Set(own.map((r) => r.sessionId));
      for (const f of friction)
        if (first && f.label === first.label && f.screen === first.screen) sessions.add(f.sessionId);
      return {
        ...finding,
        reporters: new Set(own.map((r) => r.address)).size,
        sessions: sessions.size,
        firstReporter: first ? handle(first.address) : null,
      };
    })
    .sort((a, b) => rank(b) - rank(a));
}

async function claimTotals(db: Database, roundId: string) {
  const [totals] = await db
    .select({
      paidSats: sql`coalesce(sum(${claims.amountSats}) filter (where ${claims.status} = 'paid'), 0)`.mapWith(Number),
      decisions: sql`count(*) filter (where ${claims.status} = 'review')`.mapWith(Number),
    })
    .from(claims)
    .where(eq(claims.roundId, roundId));
  return totals!;
}

// What to fix first, the rest and the money, built from the same data as the findings list.
// Shared reports leave out who reported what.
export async function roundReport(c: Context<AppEnv>, round: typeof rounds.$inferSelect, anonymous: boolean) {
  const db = c.get('db');
  const list = (await findingList(c, round.id))
    .filter((f) => f.status !== 'dismissed')
    .map((f) => (anonymous ? { ...f, firstReporter: null } : f));
  const rated = list.filter((f) => f.severity && f.severity !== 'idea');
  const top = rated.slice(0, 3);
  const [sessions, { paidSats, decisions }] = await Promise.all([
    db.$count(testSessions, eq(testSessions.roundId, round.id)),
    claimTotals(db, round.id),
  ]);
  return {
    product: round.product,
    name: round.name,
    sessions,
    top,
    rest: list.filter((f) => !top.includes(f)),
    unrated: list.filter((f) => !f.severity).length,
    paidSats,
    satsPerFinding: rated.length && paidSats ? Math.round(paidSats / rated.length) : null,
    decisions,
  };
}

export const roundRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get('/', async (c) => {
    const db = c.get('db');
    const own = await db
      .select()
      .from(rounds)
      .where(eq(rounds.ownerId, c.get('user').id))
      .orderBy(desc(rounds.createdAt));
    const ids = own.map((r) => r.id);
    if (!ids.length) return c.json({ rounds: [] });
    const [sessions, found] = await Promise.all([
      db
        .select({ roundId: testSessions.roundId, n: count() })
        .from(testSessions)
        .where(inArray(testSessions.roundId, ids))
        .groupBy(testSessions.roundId),
      db
        .select({ roundId: findings.roundId, n: count() })
        .from(findings)
        .where(inArray(findings.roundId, ids))
        .groupBy(findings.roundId),
    ]);
    const sessionCounts = new Map(sessions.map((s) => [s.roundId, s.n]));
    const findingCounts = new Map(found.map((f) => [f.roundId, f.n]));
    return c.json({
      rounds: own.map((r) => ({
        id: r.id,
        product: r.product,
        name: r.name,
        createdAt: r.createdAt,
        sessions: sessionCounts.get(r.id) ?? 0,
        findings: findingCounts.get(r.id) ?? 0,
      })),
    });
  })

  .post('/', validJson(createRoundSchema), async (c) => {
    const [round] = await c
      .get('db')
      .insert(rounds)
      .values({
        ...c.req.valid('json'),
        ownerId: c.get('user').id,
        rewards: DEFAULT_REWARDS,
        inviteToken: generateToken().slice(0, 24),
      })
      .returning();
    return c.json({ round: { ...round!, inviteUrl: inviteUrl(round!) } });
  })

  .get('/:id', async (c) => {
    const round = await ownRound(c);
    const db = c.get('db');
    await approveDueClaims(db, [round.id]);
    const live = and(isNull(testSessions.endedAt), gt(testSessions.lastSeenAt, new Date(Date.now() - LIVE_MS)));
    const [[sessions], totals, [runner], findingCount] = await Promise.all([
      db
        .select({
          total: count(),
          testingNow: sql`count(*) filter (where ${live})`.mapWith(Number),
        })
        .from(testSessions)
        .where(eq(testSessions.roundId, round.id)),
      claimTotals(db, round.id),
      db.select().from(runners).where(eq(runners.ownerId, round.ownerId)),
      db.$count(findings, eq(findings.roundId, round.id)),
    ]);
    return c.json({
      round: { ...round, inviteUrl: inviteUrl(round) },
      stats: {
        sessions: sessions!.total,
        testingNow: sessions!.testingNow,
        findings: findingCount,
        ...totals,
      },
      runner: runner
        ? {
            online: runnerOnline(runner),
            lastSeenAt: runner.lastSeenAt,
            budgetSats: runner.budgetSats,
            host: runner.host,
            version: runner.version,
          }
        : null,
    });
  })

  .patch('/:id', validJson(updateRoundSchema), async (c) => {
    const round = await ownRound(c);
    const [updated] = await c
      .get('db')
      .update(rounds)
      .set(c.req.valid('json'))
      .where(eq(rounds.id, round.id))
      .returning();
    return c.json({ round: { ...updated!, inviteUrl: inviteUrl(updated!) } });
  })

  .get('/:id/findings', async (c) => {
    const round = await ownRound(c);
    return c.json({ findings: await findingList(c, round.id) });
  })

  .get('/:id/findings/:fid', async (c) => {
    const round = await ownRound(c);
    const finding = await ownFinding(c, round.id, c.req.param('fid'));
    const db = c.get('db');
    const reports = await db
      .select({
        id: feedback.id,
        type: feedback.type,
        text: feedback.text,
        label: feedback.anchorLabel,
        screen: feedback.anchorScreen,
        auto: feedback.auto,
        at: feedback.createdAt,
        sessionId: feedback.sessionId,
        sessionStart: testSessions.createdAt,
        address: testers.lightningAddress,
      })
      .from(feedback)
      .innerJoin(testSessions, eq(testSessions.id, feedback.sessionId))
      .innerJoin(testers, eq(testers.id, testSessions.testerId))
      .where(eq(feedback.findingId, finding.id))
      .orderBy(feedback.createdAt);

    // What happened in the first reporter's session shortly before the report
    const first = reports[0];
    const evidence = first
      ? (
          await db
            .select({ kind: events.kind, label: events.label, screen: events.screen, at: events.createdAt })
            .from(events)
            .where(
              and(eq(events.sessionId, first.sessionId), gt(events.createdAt, new Date(first.at.getTime() - 90_000))),
            )
            .orderBy(events.createdAt)
        )
          .filter((e) => e.at.getTime() <= first.at.getTime() + 30_000 && e.kind !== 'minute')
          .map((e) => ({ ...e, seconds: Math.round((e.at.getTime() - first.sessionStart.getTime()) / 1000) }))
      : [];
    const payouts = await db
      .select({
        id: claims.id,
        kind: claims.kind,
        amount: claims.amountSats,
        status: claims.status,
        address: testers.lightningAddress,
      })
      .from(claims)
      .innerJoin(testers, eq(testers.id, claims.testerId))
      .where(eq(claims.findingId, finding.id));

    return c.json({
      finding,
      reports: reports.map(({ address, sessionStart, ...r }) => ({
        ...r,
        tester: handle(address),
        seconds: Math.round((r.at.getTime() - sessionStart.getTime()) / 1000),
      })),
      evidence,
      payouts: payouts.map(({ address, ...p }) => ({ ...p, tester: handle(address) })),
    });
  })

  .patch('/:id/findings/:fid', validJson(updateFindingSchema), async (c) => {
    const round = await ownRound(c);
    const finding = await ownFinding(c, round.id, c.req.param('fid'));
    const changes = c.req.valid('json');
    // Rating a new finding accepts it
    if (changes.severity && !changes.status && finding.status === 'new') changes.status = 'accepted';
    const [updated] = await c.get('db').update(findings).set(changes).where(eq(findings.id, finding.id)).returning();
    if (changes.severity || changes.status) await settleFinding(c.get('db'), finding.id);
    return c.json({ finding: updated });
  })

  .post('/:id/findings/:fid/merge', validJson(mergeFindingSchema), async (c) => {
    const round = await ownRound(c);
    const source = await ownFinding(c, round.id, c.req.param('fid'));
    const target = await ownFinding(c, round.id, c.req.valid('json').into);
    if (source.id === target.id) return c.json({ error: t(c).mergeSelf }, 400);
    await mergeFinding(c.get('db'), source.id, target.id);
    return c.json({ ok: true });
  })

  .get('/:id/claims', async (c) => {
    const round = await ownRound(c);
    const db = c.get('db');
    await approveDueClaims(db, [round.id]);
    const rows = await db
      .select({
        id: claims.id,
        kind: claims.kind,
        status: claims.status,
        base: claims.baseSats,
        multiplier: claims.multiplier,
        amount: claims.amountSats,
        approveAt: claims.approveAt,
        approvedAt: claims.approvedAt,
        paidAt: claims.paidAt,
        preimage: claims.preimage,
        lastError: claims.lastError,
        createdAt: claims.createdAt,
        address: testers.lightningAddress,
        findingNumber: findings.number,
        findingTitle: findings.title,
      })
      .from(claims)
      .innerJoin(testers, eq(testers.id, claims.testerId))
      .leftJoin(findings, eq(findings.id, claims.findingId))
      .where(eq(claims.roundId, round.id))
      .orderBy(desc(claims.createdAt))
      .limit(300);
    return c.json({
      claims: rows.map(({ address, preimage, ...r }) => ({
        ...r,
        tester: handle(address),
        proof: preimage ? `${preimage.slice(0, 4)}…${preimage.slice(-4)}` : null,
      })),
    });
  })

  .post('/:id/claims/:cid/:action{approve|reject|lower}', async (c) => {
    const round = await ownRound(c);
    const db = c.get('db');
    const [claim] = await db
      .select({ id: claims.id })
      .from(claims)
      .where(and(eq(claims.id, c.req.param('cid')), eq(claims.roundId, round.id)));
    if (!claim) return c.json({ error: t(c).notFound }, 404);
    const action = { approve: approveClaim, reject: rejectClaim, lower: lowerClaim }[
      c.req.param('action') as 'approve'
    ];
    if (!(await action(db, claim.id))) return c.json({ error: t(c).claimNotOpen }, 409);
    return c.json({ ok: true });
  })

  .get('/:id/testers', async (c) => {
    const round = await ownRound(c);
    const db = c.get('db');
    const [sessions, reports, payouts] = await Promise.all([
      db
        .select({ testerId: testers.id, address: testers.lightningAddress, reputation: testers.reputation })
        .from(testSessions)
        .innerJoin(testers, eq(testers.id, testSessions.testerId))
        .where(eq(testSessions.roundId, round.id)),
      db
        .select({ testerId: testSessions.testerId })
        .from(feedback)
        .innerJoin(testSessions, eq(testSessions.id, feedback.sessionId))
        .where(eq(testSessions.roundId, round.id)),
      db
        .select({ testerId: claims.testerId, amount: claims.amountSats })
        .from(claims)
        .where(and(eq(claims.roundId, round.id), eq(claims.status, 'paid'))),
    ]);
    const byTester = new Map<
      string,
      { tester: string; reputation: number; sessions: number; reports: number; paidSats: number }
    >();
    for (const s of sessions) {
      const row = byTester.get(s.testerId) ?? {
        tester: handle(s.address),
        reputation: s.reputation,
        sessions: 0,
        reports: 0,
        paidSats: 0,
      };
      row.sessions++;
      byTester.set(s.testerId, row);
    }
    for (const r of reports) byTester.get(r.testerId)!.reports++;
    for (const p of payouts) {
      const row = byTester.get(p.testerId);
      if (row) row.paidSats += p.amount;
    }
    return c.json({ testers: [...byTester.values()].sort((a, b) => b.paidSats - a.paidSats) });
  })

  .get('/:id/report', async (c) => c.json(await roundReport(c, await ownRound(c), false)))

  // A read-only link to the report, see routes/reports.ts
  .post('/:id/share', async (c) => {
    const round = await ownRound(c);
    if (round.shareToken) return c.json({ shareToken: round.shareToken });
    const [updated] = await c
      .get('db')
      .update(rounds)
      .set({ shareToken: generateToken().slice(0, 24) })
      .where(eq(rounds.id, round.id))
      .returning({ shareToken: rounds.shareToken });
    return c.json(updated);
  });
