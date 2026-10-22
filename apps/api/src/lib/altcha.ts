import { type Database, serverSecrets } from '@app/db';
import { createChallenge, randomInt, verifySolution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { generateToken } from '../middleware/auth';
import type { AppEnv } from '../types';
import { t } from './i18n';
import { rateLimit } from './rate-limit';

// Proof of work against bots on public forms (README, „ALTCHA“). The solver
// counts up to a random counter: 0.1–0.5 s on a laptop, in the browser and in the app.
const ALGORITHM = 'PBKDF2/SHA-256';
const COST = 100;
const MIN_COUNTER = 1_500;
const MAX_COUNTER = 3_000;
const LIFETIME = 10 * 60 * 1000;

// Each payload counts once. The window outlasts the challenge, after that it has expired.
const usedPayloads = rateLimit('altcha-used', 1, LIFETIME);

// The challenge as the API hands it out. Loose, so fields the signature
// covers stay in place; verifySolution checks them.
export const challengeSchema = z.looseObject({
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

const payloadSchema = z.object({
  challenge: challengeSchema,
  solution: z.object({ counter: z.number(), derivedKey: z.string(), time: z.number().exactOptional() }),
});

const altchaBody = z.looseObject({ altcha: z.string() });

let key: string | undefined;

async function hmacKey(db: Database) {
  if (key) return key;
  const value = generateToken();
  let [row] = await db.insert(serverSecrets).values({ name: 'altcha', value }).onConflictDoNothing().returning();
  if (!row) [row] = await db.select().from(serverSecrets).where(eq(serverSecrets.name, 'altcha'));
  key = row!.value;
  return key;
}

export async function altchaChallenge(db: Database) {
  return createChallenge({
    algorithm: ALGORITHM,
    cost: COST,
    counter: randomInt(MAX_COUNTER, MIN_COUNTER),
    deriveKey,
    expiresAt: new Date(Date.now() + LIFETIME),
    hmacSignatureSecret: await hmacKey(db),
  });
}

// The widget sends a base64 JSON payload; anything that doesn't parse or
// verify is no solution.
async function verified(db: Database, payload: string) {
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(atob(payload)));
    if (!parsed.success) return null;
    const { challenge, solution } = parsed.data;
    const result = await verifySolution({ challenge, solution, deriveKey, hmacSignatureSecret: await hmacKey(db) });
    return result.verified ? challenge.parameters.nonce : null;
  } catch {
    return null;
  }
}

// Before validJson on public routes that send mails or create data: the JSON
// body carries the solution as `altcha`. Checked before the rate limits, so
// bots can't use up the limits of an address.
export const requireAltcha = createMiddleware<AppEnv>(async (c, next) => {
  const body = altchaBody.safeParse(await c.req.json().catch(() => null));
  const nonce = body.success && (await verified(c.get('db'), body.data.altcha));
  if (!nonce || !(await usedPayloads.hit(c, nonce))) return c.json({ error: t(c).altchaFailed }, 403);
  await next();
});
