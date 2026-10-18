import type { Database } from '@app/db';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { t } from './lib/i18n';
import { captureException } from './monitoring';
import { agentRoutes } from './routes/agents';
import { authRoutes } from './routes/auth';
import { passkeyRoutes } from './routes/passkeys';
import { reportRoutes } from './routes/reports';
import { roundRoutes } from './routes/rounds';
import { runnerRoutes } from './routes/runner';
import { sdkRoutes } from './routes/sdk';
import { updateRoutes } from './routes/updates';
import type { AppEnv } from './types';

export function createApp(db: Database) {
  return (
    new Hono<AppEnv>()
      .use(logger())
      .use(async (c, next) => {
        c.set('db', db);
        await next();
      })
      .onError((err, c) => {
        // Client errors such as malformed JSON keep their status and stay out of GlitchTip
        if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
        console.error('Unhandled error:', err);
        captureException(err);
        return c.json({ error: t(c).internalError }, 500);
      })
      // Public through the web proxy, so Uptime Kuma checks web, API and database in one go.
      // The CI compares revision with the deployed commit.
      .get('/api/health', async (c) => {
        await db.execute(sql`select 1`);
        return c.json({ status: 'ok', revision: process.env.APP_VERSION || 'dev' });
      })
      // /llms.txt, /llms-full.txt and <page>.md, forwarded by the web server
      .route('/', agentRoutes)
      .basePath('/api/v1')
      .route('/auth', authRoutes)
      .route('/auth/passkeys', passkeyRoutes)
      .route('/reports', reportRoutes)
      .route('/rounds', roundRoutes)
      .route('/runner', runnerRoutes)
      .route('/sdk', sdkRoutes)
      .route('/updates', updateRoutes)
  );
}
