import type { Database } from '@app/db';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { captureException } from './monitoring';
import { authRoutes } from './routes/auth';
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
        return c.json({ error: 'Interner Fehler' }, 500);
      })
      // Public through the web proxy, so Uptime Kuma checks web, API and database in one go
      .get('/api/health', async (c) => {
        await db.execute(sql`select 1`);
        return c.json({ status: 'ok' });
      })
      .basePath('/api/v1')
      .route('/auth', authRoutes)
  );
}
