import { parseArgs } from 'node:util';
import { APP_NAME, type Messages, messages, pickLocale } from '@app/shared';
import { createClient } from './client';
import { type Command, EXIT, Failure, type Io, type Result } from './command';
import { auth } from './commands/auth';
import { rounds } from './commands/rounds';
import { DEFAULT_URL, loadSession, SLUG } from './config';

// Every command of the CLI. A new one goes in here (README, „CLI“).
export const commands: Record<string, Command> = { ...auth, rounds };

const globalOptions = {
  json: { type: 'boolean' },
  url: { type: 'string' },
  lang: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

// For --json the same lines as data, so agents read the commands too
function help(m: Messages): Result {
  const rows = Object.values(commands).flatMap((command) => command.help(m));
  const options: [string, string][] = [
    ['--json', m.cliJsonHelp],
    ['--url <url>', m.cliUrlHelp(DEFAULT_URL)],
    ['--lang de|en', m.cliLangHelp],
    ['-h, --help', m.cliHelpHelp],
  ];
  const width = Math.max(...[...rows, ...options].map(([usage]) => usage.length)) + 2;
  const table = (list: [string, string][]) => list.map(([usage, text]) => `  ${usage.padEnd(width)}${text}`);
  const text = [
    `${SLUG} – ${m.cliIntro(APP_NAME)}`,
    '',
    m.cliUsage(SLUG),
    '',
    `${m.cliCommands}:`,
    ...table(rows),
    '',
    `${m.cliOptions}:`,
    ...table(options),
    '',
    m.cliExitCodes,
  ].join('\n');
  const lines = (list: [string, string][]) => list.map(([usage, text]) => ({ usage, text }));
  return { data: { commands: lines(rows), options: lines(options), exitCodes: EXIT }, text };
}

const isParseError = (error: unknown): error is TypeError =>
  error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS');

// `<slug> <command> [options]`. With --json, stdout holds exactly one JSON
// value, the result or { error }; the exit code tells which (EXIT).
export async function run(args: string[], io: Io): Promise<number> {
  // The language of the terminal as in LANG, --lang overrides it once parsed
  let locale = pickLocale(io.env.LC_ALL || io.env.LC_MESSAGES || io.env.LANG);
  let m = messages[locale];
  let json = args.includes('--json');
  try {
    const [name = '', ...rest] = args;
    const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
    if (name && !command && !name.startsWith('-')) throw new Failure(m.cliUnknownCommand(name, SLUG), EXIT.usage);
    const { values } = parseArgs({ args: command ? rest : args, options: { ...globalOptions, ...command?.options } });
    if (typeof values.lang === 'string') {
      locale = pickLocale(values.lang);
      m = messages[locale];
    }
    json = values.json === true;
    if (!command && !values.help && args.length > 0) throw new Failure(m.cliUsage(SLUG), EXIT.usage);

    // The address of the last login, unless --url names another
    const stored = await loadSession(io.env);
    const url = (typeof values.url === 'string' ? values.url : (stored?.url ?? DEFAULT_URL)).replace(/\/+$/, '');
    const session = stored?.url === url ? stored : null;
    const api = createClient(url, session?.token, locale, m);
    const result = command && !values.help ? await command.run({ api, url, session, values, m, locale, io }) : help(m);
    io.out(json ? JSON.stringify(result.data, null, 2) : result.text);
    return EXIT.ok;
  } catch (error) {
    let failure: Failure;
    if (error instanceof Failure) failure = error;
    else if (isParseError(error)) failure = new Failure(m.cliBadOptions(error.message, SLUG), EXIT.usage);
    // Anything else, such as a config folder that can't be written
    else failure = new Failure(error instanceof Error ? error.message : String(error), EXIT.error);
    if (json) io.out(JSON.stringify({ error: failure.message }));
    else io.err(failure.message);
    return failure.exitCode;
  }
}
