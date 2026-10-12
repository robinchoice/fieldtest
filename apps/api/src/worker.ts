import './monitoring';
import { createDb } from '@app/db';
import { runNextEvaluation } from './lib/evaluate';
import { captureException } from './monitoring';

// Same image as the API, started with `bun apps/api/src/worker.ts`. The API runs
// the migrations. Evaluates tester reports from the jobs in evaluation_jobs.
const db = createDb(process.env.DATABASE_URL!);

// For the healthcheck in docker-compose.prod.yml
Bun.serve({ port: Number(process.env.PORT || 3001), fetch: () => Response.json({ status: 'ok' }) });
console.log('[worker] Evaluating tester reports');

// A job stopped halfway comes up again when its lease runs out
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(0));

while (true) {
  try {
    if (await runNextEvaluation(db)) continue;
  } catch (err) {
    console.error('[worker] Claiming a job failed:', err);
    captureException(err);
  }
  await Bun.sleep(5_000);
}
