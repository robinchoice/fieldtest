import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import postgres from 'postgres';

// The browser tests run without --env-file and take only DATABASE_URL from .env
const envFile = new URL('../../.env', import.meta.url);
process.env.DATABASE_URL ??= existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')).DATABASE_URL : undefined;

const source = new URL(process.env.DATABASE_URL!);
const name = `test_${crypto.randomUUID().replaceAll('-', '')}`;
const sql = postgres(source.toString(), { max: 1, onnotice: () => {} });
const target = new URL(source);
target.pathname = `/${name}`;

let child: Bun.Subprocess | undefined;
let signal: 'SIGINT' | 'SIGTERM' | undefined;
const interrupt = () => {
  signal = 'SIGINT';
  child?.kill(signal);
};
const terminate = () => {
  signal = 'SIGTERM';
  child?.kill(signal);
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);

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
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
}
process.exit(signal ? (signal === 'SIGINT' ? 130 : 143) : exitCode);
