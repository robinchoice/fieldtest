import { type Messages, messages, pickLocale } from '@app/shared';
import type { Context } from 'hono';

// The language the client asks for. Web and overlay send the chosen one as Accept-Language.
export const locale = (c: Context) => pickLocale(c.req.header('accept-language'));

// Texts in that language
export const t = (c: Context) => messages[locale(c)];

// zod messages are keys of messages.ts, anything else falls back to a generic text
export function translateIssue(c: Context, message: string | undefined) {
  const m = t(c);
  const text = message && message in m ? m[message as keyof Messages] : undefined;
  return typeof text === 'string' ? text : m.invalidInput;
}
