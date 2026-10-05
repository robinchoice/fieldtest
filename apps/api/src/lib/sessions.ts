import { claims, type Database, events, feedback, type rounds, testSessions } from '@app/db';
import type { sdkEventsSchema } from '@app/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { addLiveReward, scaled } from './claims';

// The overlay reports one window of 10 seconds per call
const WINDOW_SECONDS = 10;
// Sessions stop earning after this, a forgotten tab shouldn't keep counting
const MAX_SESSION_SECONDS = 3 * 60 * 60;

type Session = typeof testSessions.$inferSelect;
type Round = typeof rounds.$inferSelect;

const secondsSince = (start: Date, at = new Date()) => Math.max(0, Math.floor((at.getTime() - start.getTime()) / 1000));

// Scores what the overlay saw: active minutes, first visits of screens and the
// owner's goals, all within the live cap. Friction and errors only go to the log.
export async function recordActivity(
  db: Database,
  session: Session,
  round: Round,
  input: z.infer<typeof sdkEventsSchema>,
) {
  const { rewards } = round;
  const elapsed = secondsSince(session.createdAt);
  const open = !session.endedAt && elapsed < MAX_SESSION_SECONDS;
  let live = session.liveSats;
  const award = (sats: number) => {
    const got = open ? Math.max(0, Math.min(scaled(rewards, sats), rewards.cap - live)) : 0;
    live += got;
    return got;
  };
  const rows: { kind: string; label: string; screen: string; sats: number }[] = [];

  // Active time can't run ahead of the clock, however often the overlay reports
  let active = session.activeSeconds;
  if (input.active && open) {
    const next = Math.min(active + WINDOW_SECONDS, elapsed);
    if (Math.floor(next / 60) > Math.floor(active / 60))
      rows.push({ kind: 'minute', label: '', screen: '', sats: award(rewards.minute) });
    active = next;
  }

  const known = await db
    .select({ kind: events.kind, label: events.label, screen: events.screen })
    .from(events)
    .where(and(eq(events.sessionId, session.id), inArray(events.kind, ['screen', 'goal'])));
  const screens = new Set(known.filter((e) => e.kind === 'screen').map((e) => e.screen));
  const goals = new Set(known.filter((e) => e.kind === 'goal').map((e) => e.label));

  for (const event of input.events) {
    if (event.kind === 'screen') {
      if (!event.screen || screens.has(event.screen)) continue;
      screens.add(event.screen);
      rows.push({ ...event, sats: award(rewards.screen) });
    } else if (event.kind === 'goal') {
      if (!round.goals.includes(event.label) || goals.has(event.label)) continue;
      goals.add(event.label);
      rows.push({ ...event, sats: award(rewards.goal) });
    } else {
      rows.push({ ...event, sats: 0 });
    }
  }

  if (rows.length) await db.insert(events).values(rows.map((row) => ({ ...row, sessionId: session.id })));
  await db
    .update(testSessions)
    .set({ activeSeconds: active, liveSats: live, lastSeenAt: new Date() })
    .where(eq(testSessions.id, session.id));
  await addLiveReward(db, session, live - session.liveSats);
}

// What the overlay shows: earnings, goals and the log of what was recorded
export async function sessionState(db: Database, session: Session, round: Round) {
  const [log, notes, payouts] = await Promise.all([
    db
      .select({
        kind: events.kind,
        label: events.label,
        screen: events.screen,
        sats: events.sats,
        at: events.createdAt,
      })
      .from(events)
      .where(eq(events.sessionId, session.id))
      .orderBy(asc(events.createdAt)),
    db
      .select({ type: feedback.type, label: feedback.anchorLabel, at: feedback.createdAt })
      .from(feedback)
      .where(eq(feedback.sessionId, session.id)),
    db
      .select({
        status: claims.status,
        amount: claims.amountSats,
        preimage: claims.preimage,
        paidAt: claims.paidAt,
        kind: claims.kind,
      })
      .from(claims)
      .where(eq(claims.sessionId, session.id)),
  ]);

  const entries = [
    ...log.map((e) => ({ kind: e.kind, label: e.label, screen: e.screen, sats: e.sats, at: e.at })),
    ...notes.map((n) => ({ kind: 'feedback', label: n.label, screen: n.type, sats: 0, at: n.at })),
    ...payouts
      .filter((p) => p.status === 'paid' && p.paidAt)
      .map((p) => ({
        kind: 'paid',
        label: `${p.preimage?.slice(0, 4)}…${p.preimage?.slice(-4)}`,
        screen: '',
        sats: p.amount,
        at: p.paidAt!,
      })),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(-60)
    .map((e) => ({ ...e, at: secondsSince(session.createdAt, e.at) }));

  const sum = (statuses: string[]) =>
    payouts.filter((p) => statuses.includes(p.status)).reduce((a, p) => a + p.amount, 0);
  const reached = new Set(log.filter((e) => e.kind === 'goal').map((e) => e.label));
  return {
    activeSeconds: session.activeSeconds,
    liveSats: session.liveSats,
    cap: round.rewards.cap,
    paidSats: sum(['paid']),
    pendingSats: sum(['review', 'approved', 'paying']),
    goals: round.goals.map((goal) => ({ goal, reached: reached.has(goal) })),
    feedback: notes.length,
    ended: !!session.endedAt,
    log: entries,
  };
}
