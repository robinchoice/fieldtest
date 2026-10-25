import { z } from 'zod';
import type { Band } from './band';

export * from './band';
export * from './messages';

// The one place to rename a new project. API mails and web titles read it.
export const APP_NAME = 'Fieldtest';

// Bundle ID, its last part names the CLI (README, „CLI“)
export const APP_ID = 'org.pleasance.fieldtest';

// Section of the family colour band for this product, see DESIGN.md.
export const APP_BAND: Band = { from: 3.2, to: 3.85 };

// True once the project is live as 1.0 (README, "Live als 1.0"). From then on
// the bug button waits for the test mode switch, see testMode in the web's feedback.svelte.ts.
export const LIVE = false;

export type User = {
  id: string;
  email: string;
  name: string;
  // In ADMIN_EMAILS, may invite testers and send updates
  admin: boolean;
  // Since when the account gets update mails, as ISO date; null = off
  updatesSince: string | null;
};

// Custom error messages are keys of messages.ts, the API translates them.
const email = z.string().trim().toLowerCase().pipe(z.email('invalidEmail'));

export const magicLinkSchema = z.object({
  email,
  // Page to return to after login, see safeNextPath
  next: z.string().max(2000).optional(),
  // The unticked checkbox under the form. Counts once the link is opened, so
  // it is a double opt-in.
  updates: z.boolean().default(false),
});

export const verifySchema = z.object({
  token: z.string().min(1).max(200),
  // The web logs in with a cookie, the CLI sends false and takes the token
  cookie: z.boolean().optional(),
});

// An ALTCHA challenge as the API hands it out, for the solvers in tests and CLI.
// Loose, so fields the signature covers stay in place; verifySolution checks them.
export const altchaChallengeSchema = z.looseObject({
  parameters: z.looseObject({
    algorithm: z.string(),
    nonce: z.string(),
    salt: z.string(),
    cost: z.number(),
    keyLength: z.number(),
    keyPrefix: z.string(),
  }),
  signature: z.string().exactOptional(),
});

export const loginCodeSchema = z.object({ email, updates: z.boolean().default(false) });

export const inviteSchema = z.object({ email });

export const verifyCodeSchema = z.object({
  email,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'codeDigits'),
  // The web logs in with a cookie, app and CLI take the token from the answer
  cookie: z.boolean().optional(),
});

// WebAuthn's JSON as @simplewebauthn/browser hands it over, @simplewebauthn/server
// checks the signatures. The server reads no client extensions, so they are dropped.
const passkeyCredential = {
  id: z.string().min(1).max(1400),
  rawId: z.string(),
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['cross-platform', 'platform']).exactOptional(),
  clientExtensionResults: z.object({}),
};

export const passkeyRegisterSchema = z.object({
  response: z.object({
    ...passkeyCredential,
    response: z.object({
      clientDataJSON: z.string(),
      attestationObject: z.string(),
      authenticatorData: z.string().exactOptional(),
      transports: z.array(z.string()).exactOptional(),
      publicKeyAlgorithm: z.number().exactOptional(),
      publicKey: z.string().exactOptional(),
    }),
  }),
});

// cookie as in verifyCodeSchema
export const passkeyLoginSchema = z.object({
  response: z.object({
    ...passkeyCredential,
    response: z.object({
      clientDataJSON: z.string(),
      authenticatorData: z.string(),
      signature: z.string(),
      userHandle: z.string().exactOptional(),
    }),
  }),
  cookie: z.boolean().optional(),
});

export type Passkey = {
  id: string;
  // Synced by a password manager, else bound to one device
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  // Update mails on or off, see the settings page
  updates: z.boolean().optional(),
});

// Update mails (README, „Update-Mails“): title and features per language.
// Drafts may be incomplete, sending needs both languages, see updateComplete.
const updateText = z.object({
  title: z.string().trim().max(200),
  features: z.array(z.string().trim().max(500)).max(20),
});

export const updateContentSchema = z.object({ de: updateText, en: updateText });

export type UpdateContent = z.infer<typeof updateContentSchema>;

export const updateComplete = (content: UpdateContent) =>
  Object.values(content).every((text) => text.title && text.features.some(Boolean));

export const saveUpdateSchema = z.object({
  content: updateContentSchema,
  // PNG or JPEG up to about 2 MB, null removes it, missing keeps it
  image: z.base64().max(2_800_000).nullable().optional(),
});

export type UpdateSummary = {
  id: string;
  // File name in updates/ for drafts written by agents
  slug: string | null;
  content: UpdateContent;
  hasImage: boolean;
  createdAt: string;
  sentAt: string | null;
  // Deliveries of a sent update
  sent: number;
  failed: number;
  pending: number;
};

// What the web sends along with feedback on Fieldtest itself. The API adds its own version.
export const feedbackContextSchema = z.object({
  platform: z.enum(['web']),
  page: z.string().max(500),
  device: z.string().max(300),
  viewport: z.string().max(50),
  locale: z.string().max(10),
  // Failed API calls as "METHOD /path → status", newest first
  errors: z.array(z.string().max(300)).max(5),
});

export type FeedbackContext = z.infer<typeof feedbackContextSchema>;

export const feedbackSchema = z.object({
  kind: z.enum(['bug', 'idea']),
  message: z.string().trim().min(5, 'feedbackTooShort').max(5000),
  // PNG or JPEG, up to about 5 MB
  screenshot: z.base64().max(7_000_000).optional(),
  context: feedbackContextSchema,
});

// A path on this site to return to after login. Anything that would resolve to
// another origin (//host, /\host, or tabs and newlines that browsers strip) is
// dropped, so a crafted link can't redirect elsewhere.
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value?.startsWith('/')) return null;
  try {
    const url = new URL(value, 'http://localhost');
    return url.origin === 'http://localhost' && !url.pathname.startsWith('//')
      ? url.pathname + url.search + url.hash
      : null;
  } catch {
    return null;
  }
}

// Test rounds

const sats = z.number().int().min(0).max(1_000_000);

// What testers earn in a round. `scale` in percent multiplies every amount.
export const rewardsSchema = z.object({
  minute: sats,
  screen: sats,
  goal: sats,
  cap: sats,
  cosmetic: sats,
  minor: sats,
  major: sats,
  blocker: sats,
  idea: sats,
  confirm: sats,
  autoApprove: sats,
  // Sum of finding rewards a tester gets approved per round without the owner
  autoApproveTester: sats,
  scale: z.number().int().min(10).max(1000),
});

export type Rewards = z.infer<typeof rewardsSchema>;

export const DEFAULT_REWARDS: Rewards = {
  minute: 20,
  screen: 10,
  goal: 100,
  cap: 1000,
  cosmetic: 200,
  minor: 500,
  major: 1500,
  blocker: 4000,
  idea: 800,
  confirm: 100,
  autoApprove: 1500,
  autoApproveTester: 3000,
  scale: 100,
};

export const SEVERITIES = ['blocker', 'major', 'minor', 'cosmetic', 'idea'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const FEEDBACK_TYPES = ['bug', 'confusing', 'idea'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FINDING_STATUSES = ['new', 'accepted', 'exported', 'dismissed'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export type ClaimStatus = 'review' | 'approved' | 'paying' | 'paid' | 'rejected';

const prototypeUrl = z
  .string()
  .trim()
  .pipe(z.url({ protocol: /^https?$/, error: 'invalidUrl' }));

export const createRoundSchema = z.object({
  product: z.string().trim().min(1, 'productRequired').max(120),
  name: z.string().trim().min(1, 'roundNameRequired').max(120),
  prototypeUrl,
  goals: z.array(z.string().trim().min(1).max(120)).max(10),
  plannedSessions: z.number().int().min(1).max(1000).default(20),
});

export const updateRoundSchema = createRoundSchema.partial().extend({ rewards: rewardsSchema.optional() });

export const lightningAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._+-]+@([a-z0-9-]+\.)+[a-z]{2,}$/, 'invalidLightningAddress');

export const sdkStartSchema = z.object({
  invite: z.string().min(1).max(100),
  lightningAddress: lightningAddressSchema,
});

export const SDK_EVENT_KINDS = ['screen', 'goal', 'friction', 'error'] as const;

// The overlay reports every 10 seconds whether the tester was active in that
// window, plus what happened in between.
export const sdkEventsSchema = z.object({
  active: z.number().int().min(0).max(1).default(0),
  events: z
    .array(
      z.object({
        kind: z.enum(SDK_EVENT_KINDS),
        label: z.string().max(300).default(''),
        screen: z.string().max(200).default(''),
      }),
    )
    .max(50)
    .default([]),
});

export const sdkFeedbackSchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  text: z.string().trim().min(1, 'feedbackRequired').max(4000),
  anchor: z.object({
    label: z.string().max(300),
    screen: z.string().max(200),
    auto: z.string().max(200).optional(),
  }),
});

export const updateFindingSchema = z.object({
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(FINDING_STATUSES).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  summary: z.string().trim().max(4000).optional(),
  fix: z.string().trim().max(4000).optional(),
});

export const mergeFindingSchema = z.object({ into: z.uuid() });

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

export const runnerPaidSchema = z.object({
  invoice: z.string().max(4000).exactOptional(),
  // Only with ALLOW_FAKE_PAYMENTS, for runners in test mode without an invoice
  paymentHash: hex64.exactOptional(),
  preimage: hex64,
});

export const runnerFailedSchema = z.object({ error: z.string().max(500) });

export const runnerStatusSchema = z.object({
  budgetSats: z.number().int().min(0).nullable().optional(),
  host: z.string().max(200).optional(),
  version: z.string().max(40).optional(),
});

// What the first reporter of a finding earns, before reputation
export function severityReward(rewards: Rewards, severity: Severity): number {
  return scaled(rewards, rewards[severity]);
}

export const scaled = (rewards: Rewards, sats: number) => Math.round((sats * rewards.scale) / 100);
