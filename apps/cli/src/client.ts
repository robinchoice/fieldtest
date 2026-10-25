import type { Locale, Messages } from '@app/shared';
import { z } from 'zod';
import { EXIT, Failure } from './command';

const errorSchema = z.object({ error: z.string() });

// The same HTTP API as web and app, with the token of this device as bearer.
// Errors come in the CLI's language, the API reads Accept-Language.
export function createClient(url: string, token: string | undefined, locale: Locale, m: Messages) {
  async function request<T extends z.ZodType>(method: string, path: string, schema: T, body?: object) {
    let res: Response;
    try {
      res = await fetch(`${url}/api/v1${path}`, {
        method,
        headers: {
          'accept-language': locale,
          ...(token && { authorization: `Bearer ${token}` }),
          ...(body && { 'content-type': 'application/json' }),
        },
        body: body ? JSON.stringify(body) : null,
      });
    } catch {
      throw new Failure(m.cliUnreachable(url), EXIT.error);
    }
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message = errorSchema.safeParse(json).data?.error ?? m.cliBadAnswer;
      throw new Failure(message, res.status === 401 ? EXIT.loggedOut : EXIT.error);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Failure(m.cliBadAnswer, EXIT.error);
    return parsed.data;
  }

  return {
    get: <T extends z.ZodType>(path: string, schema: T) => request('GET', path, schema),
    post: <T extends z.ZodType>(path: string, schema: T, body: object = {}) => request('POST', path, schema, body),
    patch: <T extends z.ZodType>(path: string, schema: T, body: object) => request('PATCH', path, schema, body),
  };
}

export type Client = ReturnType<typeof createClient>;
