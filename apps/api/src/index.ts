import './monitoring';
import { createDb, migrateDb } from '@app/db';
import { createApp } from './app';
import { importDrafts } from './lib/updates';

// A failed migration aborts the boot.
await migrateDb(process.env.DATABASE_URL!);
const db = createDb(process.env.DATABASE_URL!);
console.log('[boot] Migrations up to date.');
await importDrafts(db);

const port = Number(process.env.PORT || 3000);
console.log(`[boot] API listening on port ${port}`);

export default {
  port,
  fetch: createApp(db).fetch,
};
