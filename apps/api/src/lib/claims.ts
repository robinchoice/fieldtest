import { claims, type Database, feedback, findings, rounds, testers, testSessions } from '@app/db';
import { type Rewards, type Severity, scaled, severityReward } from '@app/shared';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

// A connection or an open transaction
type Db = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

const HOUR = 60 * 60 * 1000;
// Claims above the owner's limit wait this long for a decision, then approve themselves
const REVIEW_HOURS = 48;
// Testers who report a known finding again get a small confirmation reward, but only the first few
const MAX_CONFIRMATIONS = 5;
const LOWER = { blocker: 'major', major: 'minor', minor: 'cosmetic' } as const;

// Live rewards of a session collect in one approved claim until the runner
// picks it up, so testers get a few payments instead of one per screen.
export async function addLiveReward(db: Db, session: { id: string; roundId: string; testerId: string }, sats: number) {
  if (sats <= 0) return;
  const [grown] = await db
    .update(claims)
    .set({ baseSats: sql`${claims.baseSats} + ${sats}`, amountSats: sql`${claims.amountSats} + ${sats}` })
    .where(
      and(
        eq(claims.status, 'approved'),
        eq(
          claims.id,
          db
            .select({ id: claims.id })
            .from(claims)
            .where(and(eq(claims.sessionId, session.id), eq(claims.kind, 'live'), eq(claims.status, 'approved')))
            .orderBy(asc(claims.createdAt), asc(claims.id))
            .limit(1),
        ),
      ),
    )
    .returning({ id: claims.id });
  if (grown) return;
  await db.insert(claims).values({
    roundId: session.roundId,
    testerId: session.testerId,
    sessionId: session.id,
    kind: 'live',
    baseSats: sats,
    amountSats: sats,
    status: 'approved',
    approvedAt: new Date(),
  });
}

// The first approved reward of a session counts toward the tester's reputation:
// new testers earn half on findings, from 3 sessions the full amount, from 10 a quarter more.
async function countApprovedSession(db: Db, sessionId: string | null) {
  if (!sessionId) return;
  const [session] = await db
    .update(testSessions)
    .set({ approved: 1 })
    .where(and(eq(testSessions.id, sessionId), eq(testSessions.approved, 0)))
    .returning({ testerId: testSessions.testerId });
  if (!session) return;
  await db
    .update(testers)
    .set({
      approvedSessions: sql`${testers.approvedSessions} + 1`,
      reputation: sql`case when ${testers.approvedSessions} + 1 >= 10 then 125 when ${testers.approvedSessions} + 1 >= 3 then 100 else 50 end`,
    })
    .where(eq(testers.id, session.testerId));
}

// Claims wait for the owner above the limit per claim, and once the tester's finding
// rewards in this round would pass the limit per tester. So no evaluation alone pays
// out more than that, however many reports a tester sends.
async function decision(db: Db, roundId: string, testerId: string, amount: number, rewards: Rewards) {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${claims.amountSats}), 0)::int` })
    .from(claims)
    .where(
      and(
        eq(claims.roundId, roundId),
        eq(claims.testerId, testerId),
        inArray(claims.kind, ['finding', 'confirm']),
        inArray(claims.status, ['approved', 'paying', 'paid']),
      ),
    );
  const now = new Date();
  return amount > rewards.autoApprove || row!.total + amount > rewards.autoApproveTester
    ? { status: 'review', approveAt: new Date(now.getTime() + REVIEW_HOURS * HOUR), approvedAt: null }
    : { status: 'approved', approveAt: null, approvedAt: now };
}

// Finding rewards of a round are decided one at a time: the round's row stays
// locked until the transaction ends, like for the finding numbers in routes/sdk.ts.
// So the owner and the evaluation can't both settle a finding at once, and the
// limit per tester holds across findings settled at the same time. The finding
// is read after the lock, so it is the state the previous settlement left.
async function lockedFinding(tx: Db, findingId: string) {
  await tx
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.id, tx.select({ id: findings.roundId }).from(findings).where(eq(findings.id, findingId))))
    .for('no key update');
  const [finding] = await tx
    .select({
      id: findings.id,
      roundId: findings.roundId,
      severity: findings.severity,
      status: findings.status,
      rewards: rounds.rewards,
    })
    .from(findings)
    .innerJoin(rounds, eq(rounds.id, findings.roundId))
    .where(eq(findings.id, findingId));
  return finding;
}

type LockedFinding = NonNullable<Awaited<ReturnType<typeof lockedFinding>>>;

// Recomputes what the reporters of a finding get: the first one the reward for
// its severity, the next ones a confirmation. Claims already paid or being paid stay.
// Returns the sessions approved for the first time; their reputation is counted
// after the transaction, as testers report in several rounds at once and two
// settlements holding each other's tester rows would deadlock.
async function settle(tx: Db, finding: LockedFinding) {
  const findingId = finding.id;
  const approved: string[] = [];
  await tx.delete(claims).where(and(eq(claims.findingId, findingId), inArray(claims.status, ['review', 'approved'])));
  // Only findings the owner (or the evaluation) accepted pay out
  if (!finding.severity || !['accepted', 'exported'].includes(finding.status)) return approved;

  const reports = await tx
    .select({ testerId: testSessions.testerId, sessionId: feedback.sessionId, reputation: testers.reputation })
    .from(feedback)
    .innerJoin(testSessions, eq(testSessions.id, feedback.sessionId))
    .innerJoin(testers, eq(testers.id, testSessions.testerId))
    .where(eq(feedback.findingId, findingId))
    .orderBy(asc(feedback.createdAt));
  const kept = await tx
    .select({ testerId: claims.testerId })
    .from(claims)
    .where(and(eq(claims.findingId, findingId), inArray(claims.status, ['paying', 'paid'])));
  const settled = new Set(kept.map((k) => k.testerId));

  const seen = new Set<string>();
  for (const report of reports) {
    if (seen.has(report.testerId)) continue;
    const first = seen.size === 0;
    seen.add(report.testerId);
    if (!first && seen.size > MAX_CONFIRMATIONS + 1) break;
    if (settled.has(report.testerId)) continue;

    const base = first
      ? severityReward(finding.rewards, finding.severity as Severity)
      : scaled(finding.rewards, finding.rewards.confirm);
    const multiplier = first ? report.reputation : 100;
    const amount = Math.round((base * multiplier) / 100);
    if (amount <= 0) continue;
    const state = await decision(tx, finding.roundId, report.testerId, amount, finding.rewards);
    await tx.insert(claims).values({
      roundId: finding.roundId,
      testerId: report.testerId,
      sessionId: report.sessionId,
      findingId,
      kind: first ? 'finding' : 'confirm',
      baseSats: base,
      multiplier,
      amountSats: amount,
      ...state,
    });
    if (state.status === 'approved' && report.sessionId) approved.push(report.sessionId);
  }
  return approved;
}

// After every change of a finding's severity or status
export async function settleFinding(db: Database, findingId: string) {
  const approved = await db.transaction(async (tx) => {
    const finding = await lockedFinding(tx, findingId);
    return finding ? settle(tx, finding) : [];
  });
  for (const sessionId of approved) await countApprovedSession(db, sessionId);
}

export async function mergeFinding(db: Database, sourceId: string, targetId: string) {
  const approved = await db.transaction(async (tx) => {
    const target = await lockedFinding(tx, targetId);
    if (!target) return [];
    await tx.update(feedback).set({ findingId: targetId }).where(eq(feedback.findingId, sourceId));
    // Payouts already on their way stay with the testers and count as settled for the target
    await tx
      .update(claims)
      .set({ findingId: targetId })
      .where(and(eq(claims.findingId, sourceId), inArray(claims.status, ['paying', 'paid'])));
    await tx.delete(claims).where(eq(claims.findingId, sourceId));
    await tx.delete(findings).where(eq(findings.id, sourceId));
    return settle(tx, target);
  });
  for (const sessionId of approved) await countApprovedSession(db, sessionId);
}

// Claims in review whose waiting time is over count as approved
export async function approveDueClaims(db: Database, roundIds: string[]) {
  if (!roundIds.length) return;
  const due = await db
    .update(claims)
    .set({ status: 'approved', approvedAt: new Date() })
    .where(and(inArray(claims.roundId, roundIds), eq(claims.status, 'review'), lte(claims.approveAt, new Date())))
    .returning({ sessionId: claims.sessionId });
  for (const claim of due) await countApprovedSession(db, claim.sessionId);
}

export async function approveClaim(db: Database, claimId: string) {
  const [claim] = await db
    .update(claims)
    .set({ status: 'approved', approvedAt: new Date(), approveAt: null })
    .where(and(eq(claims.id, claimId), eq(claims.status, 'review')))
    .returning({ sessionId: claims.sessionId });
  if (claim) await countApprovedSession(db, claim.sessionId);
  return !!claim;
}

export async function rejectClaim(db: Database, claimId: string) {
  const [claim] = await db
    .update(claims)
    .set({ status: 'rejected', approveAt: null })
    .where(and(eq(claims.id, claimId), inArray(claims.status, ['review', 'approved'])))
    .returning({ id: claims.id });
  return !!claim;
}

// One severity level lower for this payout only, the finding keeps its severity.
// The update checks the status again: a claim approved and taken by the runner
// in between keeps its amount, the invoice is already for it.
export async function lowerClaim(db: Database, claimId: string) {
  const [row] = await db
    .select({ claim: claims, rewards: rounds.rewards })
    .from(claims)
    .innerJoin(rounds, eq(rounds.id, claims.roundId))
    .where(and(eq(claims.id, claimId), eq(claims.status, 'review'), eq(claims.kind, 'finding')));
  if (!row) return false;
  const current = (['blocker', 'major', 'minor'] as const).find(
    (s) => severityReward(row.rewards, s) === row.claim.baseSats,
  );
  if (!current) return false;
  const base = severityReward(row.rewards, LOWER[current]);
  const [lowered] = await db
    .update(claims)
    .set({ baseSats: base, amountSats: Math.round((base * row.claim.multiplier) / 100) })
    .where(and(eq(claims.id, claimId), eq(claims.status, 'review')))
    .returning({ id: claims.id });
  return !!lowered;
}
