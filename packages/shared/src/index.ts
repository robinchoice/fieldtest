import { z } from 'zod';
import type { Band } from './band';

export * from './band';

// The one place to rename a new project. API mails and web titles read it.
export const APP_NAME = 'Starter';

// Section of the family colour band for this product, see DESIGN.md. The
// starter shows the whole band until a project picks its own.
export const APP_BAND: Band = { from: 1, to: 7 };

export type User = {
  id: string;
  email: string;
  name: string;
};

const email = z.string().trim().toLowerCase().pipe(z.email());

export const magicLinkSchema = z.object({
  email,
  // Page to return to after login, see safeNextPath
  next: z.string().max(2000).optional(),
});

export const verifySchema = z.object({
  token: z.string().min(1).max(200),
});

export const loginCodeSchema = z.object({ email });

export const verifyCodeSchema = z.object({
  email,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Der Code hat 6 Ziffern.'),
});

export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(255),
});

// A path on this site to return to after login. Anything that would resolve to
// another origin (//host, /\host, or tabs and newlines that browsers strip) is
// dropped, so a crafted link can't redirect elsewhere.
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value?.startsWith('/')) return null;
  try {
    const url = new URL(value, 'http://localhost');
    return url.origin === 'http://localhost' ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}
