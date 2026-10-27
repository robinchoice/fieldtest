import { z } from 'zod';

// The code reads process.env where it needs a value, so the tests can switch
// them. The entry points import this first: a missing or malformed variable
// stops the boot instead of the first request. Empty counts as unset, as in
// .env.example. A new variable with a required value or a format goes here.
const unset = z.literal('');
const number = z.string().regex(/^\d+$/);

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    APP_URL: z.url(),
    NODE_ENV: z.string().exactOptional(),
    PORT: number.or(unset).exactOptional(),
    SMTP_HOST: z.string().exactOptional(),
    SMTP_PORT: number.or(unset).exactOptional(),
    ALLOW_FAKE_PAYMENTS: z.enum(['0', '1']).or(unset).exactOptional(),
    FEEDBACK_EMAIL: z.email().or(unset).exactOptional(),
    UPDATE_MAIL_INTERVAL_MS: number.or(unset).exactOptional(),
    SIGNUP_OPEN: z.enum(['true', 'false']).or(unset).exactOptional(),
    SENTRY_DSN: z.url().or(unset).exactOptional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'Required in production, otherwise login links would end up in the log',
      });
    }
    if (env.ALLOW_FAKE_PAYMENTS === '1') {
      ctx.addIssue({ code: 'custom', path: ['ALLOW_FAKE_PAYMENTS'], message: 'Forbidden in production' });
    }
  });

declare module 'bun' {
  interface Env extends z.infer<typeof envSchema> {}
}

const result = envSchema.safeParse(process.env);
if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
