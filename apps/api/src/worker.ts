import './monitoring';
import { createDb } from '@app/db';
import { runNextEvaluation } from './lib/evaluate';
import { deliverNext } from './lib/updates';
import { captureException } from './monitoring';

// Same image as the API, started with `bun apps/api/src/worker.ts`. The API runs
// the migrations. Evaluates tester reports from the jobs in evaluation_jobs and
// sends update mails one by one, Proton's SMTP limits the rate. The jobs are
// rows in Postgres, so a restart loses nothing and several workers share them.
const db = createDb(process.env.DATABASE_URL!);
const interval = Number(process.env.UPDATE_MAIL_INTERVAL_MS || 6000);

// For the healthcheck in docker-compose.prod.yml
Bun.serve({ port: Number(process.env.PORT || 3001), fetch: () => Response.json({ status: 'ok' }) });
console.log(`[worker] Evaluating tester reports, sending update mails every ${interval} ms`);

// A job stopped halfway comes up again when its lease runs out
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(0));

async function evaluations() {
  while (true) {
    try {
      if (await runNextEvaluation(db)) continue;
    } catch (err) {
      console.error('[worker] Claiming a job failed:', err);
      captureException(err);
    }
    await Bun.sleep(5_000);
  }
}

async function updateMails() {
  while (true) {
    const result = await deliverNext(db, interval).catch((err) => {
      console.error('[worker] Delivery crashed:', err);
      captureException(err);
      return 'failed' as const;
    });
    // Nothing due: look again soon. The pace and retries are kept in deliverNext.
    const pause = { idle: 10_000, wait: interval, sent: interval, skipped: 0, failed: interval }[result];
    await Bun.sleep(pause);
  }
}

await Promise.all([evaluations(), updateMails()]);
