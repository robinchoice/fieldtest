import type { Locale, Messages } from '@app/shared';
import type { Client } from './client';
import type { Session } from './config';

export type Env = Record<string, string | undefined>;

// What the CLI needs from the outside, so the tests run it in-process
export type Io = {
  env: Env;
  out: (text: string) => void;
  err: (text: string) => void;
  // One line from stdin, after the question on stderr
  ask: (question: string) => Promise<string>;
  // All of stdin
  stdin: () => Promise<string>;
};

export type Context = {
  api: Client;
  url: string;
  // The stored session, only if it belongs to url
  session: Session | null;
  values: Record<string, unknown>;
  m: Messages;
  locale: Locale;
  io: Io;
};

// data is printed for --json, text for people
export type Result = { data: unknown; text: string };

export type Command = {
  // Lines in the help: usage and what it does
  help: (m: Messages) => [usage: string, text: string][];
  options?: Record<string, { type: 'string' | 'boolean'; short?: string }>;
  run: (ctx: Context) => Promise<Result>;
};

export const EXIT = { ok: 0, error: 1, usage: 2, loggedOut: 3 } as const;

// Ends the command with a message and an exit code from EXIT
export class Failure extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

// An option of type string, or undefined
export const str = (value: unknown) => (typeof value === 'string' ? value : undefined);
