import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import postgres from 'postgres';

// API tests load .env via --env-file; browser tests take only DATABASE_URL from it.
const envFile = new URL('../../.env', import.meta.url);
process.env.DATABASE_URL ??= existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')).DATABASE_URL : undefined;

const source = new URL(process.env.DATABASE_URL!);
const name = `test_${crypto.randomUUID().replaceAll('-', '')}`;
const sql = postgres(source.toString(), { max: 1, onnotice: () => {} });
const target = new URL(source);
target.pathname = `/${name}`;

let child: Bun.Subprocess | undefined;
let signal: 'SIGINT' | 'SIGTERM' | undefined;
function forward(sig: 'SIGINT' | 'SIGTERM') {
  signal = sig;
  child?.kill(sig);
}
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));

let exitCode = 0;
try {
  await sql`create database ${sql(name)}`;
  try {
    if (!signal) {
      child = Bun.spawn(process.argv.slice(2), {
        env: { ...process.env, DATABASE_URL: target.toString() },
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      });
      exitCode = await child.exited;
      child = undefined;
    }
  } finally {
    await sql`drop database ${sql(name)} with (force)`;
  }
} finally {
  await sql.end();
}
process.exit(signal ? (signal === 'SIGINT' ? 130 : 143) : exitCode);
