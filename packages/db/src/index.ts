import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';

export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    connection: { timezone: 'UTC' },
    onnotice: () => {},
  });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

// Several API instances may start at once. A session-level advisory lock on a
// single connection makes them migrate one after another.
export async function migrateDb(connectionString: string) {
  const client = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    await client`select pg_advisory_lock(hashtext('migrations'))`;
    await migrate(drizzle(client), { migrationsFolder: path.join(import.meta.dir, 'migrations') });
  } finally {
    await client.end();
  }
}

export * from './schema';
