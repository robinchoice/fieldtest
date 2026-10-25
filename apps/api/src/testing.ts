import { altchaChallengeSchema } from '@app/shared';
import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import type { z } from 'zod';
import type { createApp } from './app';

export async function body(res: Response | Promise<Response>): Promise<unknown> {
  return (await res).json();
}

// For fields a test reads on, the schema checks they are there
export async function read<T extends z.ZodType>(res: Response | Promise<Response>, schema: T): Promise<z.output<T>> {
  return schema.parse(await body(res));
}

// What the ALTCHA widget sends once it has solved a challenge of the API
export async function altchaPayload(app: ReturnType<typeof createApp>) {
  const challenge = altchaChallengeSchema.parse(await (await app.request('/api/v1/altcha')).json());
  const solution = await solveChallenge({ challenge, deriveKey });
  return btoa(JSON.stringify({ challenge, solution }));
}
