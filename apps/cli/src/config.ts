import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { APP_ID } from '@app/shared';
import { z } from 'zod';
import type { Env } from './command';

// The slug of the app, last part of the bundle ID. The CLI's file and config folder carry it.
export const SLUG = APP_ID.split('.').at(-1)!;

// build.ts bakes in the URL of the live app, from source it's the default address
export const DEFAULT_URL = process.env.CLI_URL || `https://${SLUG}.pleasance.org`;

// XDG_CONFIG_HOME wherever it is set, else the usual place of the platform
export function sessionFile(env: Env) {
  const home = homedir();
  const base =
    env.XDG_CONFIG_HOME ||
    (process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : process.platform === 'win32'
        ? env.APPDATA || join(home, 'AppData', 'Roaming')
        : join(home, '.config'));
  return join(base, SLUG, 'session.json');
}

// The token of this device and the address it belongs to: it never goes elsewhere
const sessionSchema = z.object({ url: z.string(), token: z.string() });
export type Session = z.infer<typeof sessionSchema>;

export async function loadSession(env: Env): Promise<Session | null> {
  try {
    return sessionSchema.parse(JSON.parse(await readFile(sessionFile(env), 'utf8')));
  } catch {
    return null;
  }
}

// Only the user may read the token. writeFile keeps the mode of an existing
// file, so the file is replaced.
export async function saveSession(env: Env, session: Session) {
  const file = sessionFile(env);
  await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
  await rm(file, { force: true });
  await writeFile(file, JSON.stringify(session), { mode: 0o600 });
}

export const removeSession = (env: Env) => rm(sessionFile(env), { force: true });
