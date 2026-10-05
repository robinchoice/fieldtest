import type { Rewards } from '@app/shared';
import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Stored lowercase, see the email schema in @app/shared
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const magicLinks = pgTable('magic_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Mobile apps log in with a code from the mail, a link can't open the app
export const loginCodes = pgTable('login_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  codeHash: varchar('code_hash', { length: 64 }).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Counters of lib/rate-limit.ts in the API
export const rateLimits = pgTable('rate_limits', {
  key: varchar('key', { length: 300 }).primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('reset_at').notNull(),
});

// A test round of one product. Testers join through the invite link.
export const rounds = pgTable('rounds', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  product: varchar('product', { length: 120 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  prototypeUrl: varchar('prototype_url', { length: 2000 }).notNull(),
  goals: jsonb('goals').$type<string[]>().notNull(),
  rewards: jsonb('rewards').$type<Rewards>().notNull(),
  plannedSessions: integer('planned_sessions').default(20).notNull(),
  // Part of the link testers get, so stored as is
  inviteToken: varchar('invite_token', { length: 64 }).notNull().unique(),
  // Read-only link to the report, created when the owner shares it
  shareToken: varchar('share_token', { length: 64 }).unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Testers have no account. The Lightning address they get paid to is their identity.
export const testers = pgTable('testers', {
  id: uuid('id').defaultRandom().primaryKey(),
  lightningAddress: varchar('lightning_address', { length: 320 }).notNull().unique(),
  // Multiplier in percent on finding rewards, see lib/claims.ts
  reputation: integer('reputation').default(50).notNull(),
  approvedSessions: integer('approved_sessions').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const testSessions = pgTable(
  'test_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roundId: uuid('round_id')
      .references(() => rounds.id, { onDelete: 'cascade' })
      .notNull(),
    testerId: uuid('tester_id')
      .references(() => testers.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    activeSeconds: integer('active_seconds').default(0).notNull(),
    // Live rewards so far, capped by rewards.cap
    liveSats: integer('live_sats').default(0).notNull(),
    // Counts toward the tester's reputation once something of it was approved
    approved: integer('approved').default(0).notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
    endedAt: timestamp('ended_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('test_sessions_round_idx').on(t.roundId)],
);

// What the overlay saw, plus the live rewards. Also the log testers see.
export const events = pgTable(
  'events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .references(() => testSessions.id, { onDelete: 'cascade' })
      .notNull(),
    // screen, goal, friction, error or minute
    kind: varchar('kind', { length: 20 }).notNull(),
    label: varchar('label', { length: 300 }).notNull(),
    screen: varchar('screen', { length: 200 }).notNull(),
    sats: integer('sats').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('events_session_idx').on(t.sessionId)],
);

// Findings group the feedback of several testers about the same thing
export const findings = pgTable(
  'findings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roundId: uuid('round_id')
      .references(() => rounds.id, { onDelete: 'cascade' })
      .notNull(),
    // Shown as F-12, counted per round
    number: integer('number').notNull(),
    // Empty until the owner or the evaluation sets it, see FINDING_STATUSES
    severity: varchar('severity', { length: 20 }),
    status: varchar('status', { length: 20 }).default('new').notNull(),
    title: varchar('title', { length: 300 }).notNull(),
    screen: varchar('screen', { length: 200 }).notNull(),
    summary: text('summary').default('').notNull(),
    fix: text('fix').default('').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('findings_round_idx').on(t.roundId)],
);

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .references(() => testSessions.id, { onDelete: 'cascade' })
      .notNull(),
    findingId: uuid('finding_id').references(() => findings.id, { onDelete: 'set null' }),
    // bug, confusing or idea
    type: varchar('type', { length: 20 }).notNull(),
    text: text('text').notNull(),
    anchorLabel: varchar('anchor_label', { length: 300 }).notNull(),
    anchorScreen: varchar('anchor_screen', { length: 200 }).notNull(),
    // Set when the overlay noticed the trouble itself, e.g. "3 taps without response"
    auto: varchar('auto', { length: 200 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('feedback_finding_idx').on(t.findingId)],
);

// What a tester gets paid. Fieldtest only keeps the books, the owner's runner pays.
export const claims = pgTable(
  'claims',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roundId: uuid('round_id')
      .references(() => rounds.id, { onDelete: 'cascade' })
      .notNull(),
    testerId: uuid('tester_id')
      .references(() => testers.id, { onDelete: 'cascade' })
      .notNull(),
    sessionId: uuid('session_id').references(() => testSessions.id, { onDelete: 'set null' }),
    findingId: uuid('finding_id').references(() => findings.id, { onDelete: 'set null' }),
    // live, finding or confirm
    kind: varchar('kind', { length: 20 }).notNull(),
    baseSats: integer('base_sats').notNull(),
    // Reputation of the tester in percent when the claim was made
    multiplier: integer('multiplier').default(100).notNull(),
    amountSats: integer('amount_sats').notNull(),
    // See ClaimStatus. Claims in review approve themselves at approveAt.
    status: varchar('status', { length: 20 }).notNull(),
    approveAt: timestamp('approve_at'),
    invoice: text('invoice'),
    paymentHash: varchar('payment_hash', { length: 64 }),
    preimage: varchar('preimage', { length: 64 }),
    lastError: varchar('last_error', { length: 500 }),
    approvedAt: timestamp('approved_at'),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('claims_round_idx').on(t.roundId), index('claims_status_idx').on(t.status)],
);

// The payout runner of an owner. It authenticates with a key of which only the hash is stored.
export const runners = pgTable('runners', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
  // Remaining budget of the wallet connection, as the runner reports it
  budgetSats: integer('budget_sats'),
  host: varchar('host', { length: 200 }),
  version: varchar('version', { length: 40 }),
  lastSeenAt: timestamp('last_seen_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
