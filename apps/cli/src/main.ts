import { run } from './cli';

// Bun reads stdin line by line through console
const lines = console[Symbol.asyncIterator]();

const code = await run(process.argv.slice(2), {
  env: process.env,
  out: (text) => console.log(text),
  err: (text) => console.error(text),
  ask: async (question) => {
    process.stderr.write(question);
    return (await lines.next()).value ?? '';
  },
  stdin: () => Bun.stdin.text(),
});
process.exit(code);
