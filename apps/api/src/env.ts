import { z } from 'zod';

// The code reads process.env where it needs a value, so the tests can switch
// them. The entry points import this first: a missing or malformed variable
// stops the boot instead of the first request. Empty counts as unset, as in
// .env.example. A new variable with a required value or a format goes here.
const unset = z.literal('');
const number = z.string().regex(/^\d+$/);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  PORT: number.or(unset).exactOptional(),
  SMTP_PORT: number.or(unset).exactOptional(),
  FEEDBACK_EMAIL: z.email().or(unset).exactOptional(),
  UPDATE_MAIL_INTERVAL_MS: number.or(unset).exactOptional(),
  SIGNUP_OPEN: z.enum(['true', 'false']).or(unset).exactOptional(),
  SENTRY_DSN: z.url().or(unset).exactOptional(),
});

declare module 'bun' {
  interface Env extends z.infer<typeof envSchema> {}
}

const result = envSchema.safeParse(process.env);
if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
