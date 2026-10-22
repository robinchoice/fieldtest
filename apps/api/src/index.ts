import './monitoring';
import { createDb, migrateDb } from '@app/db';
import { createApp } from './app';
import { importDrafts } from './lib/updates';

const db = createDb(process.env.DATABASE_URL!);
let stopping = false;

// Finish the startup and the requests in flight, then close the database
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const server = await startup;
  await server.stop();
  await db.$client.end();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const startup = (async () => {
  // A failed migration aborts the boot.
  await migrateDb(process.env.DATABASE_URL!);
  console.log('[boot] Migrations up to date.');
  await importDrafts(db);

  const server = Bun.serve({
    port: Number(process.env.PORT || 3000),
    fetch: createApp(db).fetch,
  });
  console.log(`[boot] API listening on port ${server.port}`);
  return server;
})();

await startup;
