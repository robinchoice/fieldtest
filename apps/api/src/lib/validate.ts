import { zValidator } from '@hono/zod-validator';
import type { ZodType } from 'zod';
import { translateIssue } from './i18n';

// Validates the JSON body and answers like every other error: { error: string }
export const validJson = <T extends ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: translateIssue(c, result.error.issues[0]?.message) }, 400);
    }
  });
