import './env';
import './monitoring';
import { setTimeout as sleep } from 'node:timers/promises';
import { createDb } from '@app/db';
import { runNextEvaluation } from './lib/evaluate';
import { deliverNext } from './lib/updates';
import { captureException } from './monitoring';

// Same image as the API, started with `bun apps/api/src/worker.ts`. The API runs
// the migrations. Evaluates tester reports from the jobs in evaluation_jobs and
// sends update mails one by one, Proton's SMTP limits the rate. The jobs are
// rows in Postgres, so a restart loses nothing and several workers share them.
const db = createDb(process.env.DATABASE_URL);
const interval = Number(process.env.UPDATE_MAIL_INTERVAL_MS || 6000);
const stop = new AbortController();

// Both loops finish the job they hold, then the worker exits. A job cut off by
// the kill after stop_grace_period comes up again when its lease runs out.
function shutdown() {
  stop.abort();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// For the healthcheck in docker-compose.prod.yml
const server = Bun.serve({ port: Number(process.env.PORT || 3001), fetch: () => Response.json({ status: 'ok' }) });
console.log(`[worker] Evaluating tester reports, sending update mails every ${interval} ms`);

const pause = (ms: number) => sleep(ms, undefined, { signal: stop.signal }).catch(() => {});

async function evaluations() {
  while (!stop.signal.aborted) {
    try {
      if (await runNextEvaluation(db)) continue;
    } catch (err) {
      console.error('[worker] Claiming a job failed:', err);
      captureException(err);
    }
    await pause(5_000);
  }
}

async function updateMails() {
  while (!stop.signal.aborted) {
    const result = await deliverNext(db, interval).catch((err) => {
      console.error('[worker] Delivery crashed:', err);
      captureException(err);
      return 'failed' as const;
    });
    // Nothing due: look again soon. The pace and retries are kept in deliverNext.
    await pause({ idle: 10_000, wait: interval, sent: interval, skipped: 0, failed: interval }[result]);
  }
}

await Promise.all([evaluations(), updateMails()]);
await server.stop();
await db.$client.end();
process.exit(0);
