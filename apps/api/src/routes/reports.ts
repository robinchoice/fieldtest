import { rounds } from '@app/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { t } from '../lib/i18n';
import type { AppEnv } from '../types';
import { roundReport } from './rounds';

// Read-only reports for whoever has the share link: no replays, no tester names
export const reportRoutes = new Hono<AppEnv>().get('/:token', async (c) => {
  const [round] = await c
    .get('db')
    .select()
    .from(rounds)
    .where(eq(rounds.shareToken, c.req.param('token')));
  if (!round) return c.json({ error: t(c).notFound }, 404);
  return c.json(await roundReport(c, round, true));
});
