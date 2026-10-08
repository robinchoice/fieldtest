import { claims, type Database, feedback, findings, rounds, testers, testSessions } from '@app/db';
import { type Rewards, type Severity, scaled, severityReward } from '@app/shared';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

const HOUR = 60 * 60 * 1000;
// Claims above the owner's limit wait this long for a decision, then approve themselves
const REVIEW_HOURS = 48;
// Testers who report a known finding again get a small confirmation reward, but only the first few
const MAX_CONFIRMATIONS = 5;
const LOWER = { blocker: 'major', major: 'minor', minor: 'cosmetic' } as const;

// Live rewards of a session collect in one approved claim until the runner
// picks it up, so testers get a few payments instead of one per screen.
export async function addLiveReward(
  db: Pick<Database, 'select' | 'update' | 'insert'>,
  session: { id: string; roundId: string; testerId: string },
  sats: number,
) {
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
async function countApprovedSession(db: Database, sessionId: string | null) {
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

function decision(amount: number, rewards: Rewards) {
  const now = new Date();
  return amount > rewards.autoApprove
    ? { status: 'review', approveAt: new Date(now.getTime() + REVIEW_HOURS * HOUR), approvedAt: null }
    : { status: 'approved', approveAt: null, approvedAt: now };
}

// Recomputes what the reporters of a finding get: the first one the reward for
// its severity, the next ones a confirmation. Claims already paid or being paid stay.
export async function settleFinding(db: Database, findingId: string) {
  const [finding] = await db
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
  if (!finding) return;

  await db.delete(claims).where(and(eq(claims.findingId, findingId), inArray(claims.status, ['review', 'approved'])));
  // Only findings the owner (or the evaluation) accepted pay out
  if (!finding.severity || !['accepted', 'exported'].includes(finding.status)) return;

  const reports = await db
    .select({ testerId: testSessions.testerId, sessionId: feedback.sessionId, reputation: testers.reputation })
    .from(feedback)
    .innerJoin(testSessions, eq(testSessions.id, feedback.sessionId))
    .innerJoin(testers, eq(testers.id, testSessions.testerId))
    .where(eq(feedback.findingId, findingId))
    .orderBy(asc(feedback.createdAt));
  const kept = await db
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
    const state = decision(amount, finding.rewards);
    await db.insert(claims).values({
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
    if (state.status === 'approved') await countApprovedSession(db, report.sessionId);
  }
}

export async function mergeFinding(db: Database, sourceId: string, targetId: string) {
  await db.update(feedback).set({ findingId: targetId }).where(eq(feedback.findingId, sourceId));
  // Payouts already on their way stay with the testers and count as settled for the target
  await db
    .update(claims)
    .set({ findingId: targetId })
    .where(and(eq(claims.findingId, sourceId), inArray(claims.status, ['paying', 'paid'])));
  await db.delete(claims).where(eq(claims.findingId, sourceId));
  await db.delete(findings).where(eq(findings.id, sourceId));
  await settleFinding(db, targetId);
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

// One severity level lower for this payout only, the finding keeps its severity
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
  await db
    .update(claims)
    .set({ baseSats: base, amountSats: Math.round((base * row.claim.multiplier) / 100) })
    .where(eq(claims.id, claimId));
  return true;
}
