import { expect, test } from 'bun:test';

const appModule = JSON.stringify(`${import.meta.dir}/app.ts`);
const updatesModule = JSON.stringify(`${import.meta.dir}/lib/updates.ts`);
// The worker tests drive the update mails, the evaluation loop stays idle
const idleEvaluations = `mock.module(${JSON.stringify(`${import.meta.dir}/lib/evaluate.ts`)}, () => ({
  runNextEvaluation: async () => false,
}));`;

// Isolated processes keep module mocks and OS signals out of the other tests.
function start(entry: 'index' | 'worker', setup: string, env: Record<string, string> = {}) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `import { mock } from 'bun:test';
       ${setup}
       await import(${JSON.stringify(`${import.meta.dir}/${entry}.ts`)});`,
    ],
    {
      env: { ...process.env, PORT: '0', SMTP_HOST: '', SENTRY_DSN: '', NODE_ENV: 'test', ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const lines = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let output = '';
  async function until(marker: string) {
    while (!output.includes(marker)) {
      const { value, done } = await lines.read();
      if (done) throw new Error(`Child exited before ${marker}: ${output}\n${await child.stderr.text()}`);
      output += value;
    }
    return output;
  }
  return { child, until };
}

test('worker records an SMTP timeout before exiting on SIGTERM', async () => {
  const command = Promise.withResolvers<void>();
  const smtp = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        socket.write('220 localhost SMTP\r\n');
      },
      // Accept the connection but never answer EHLO, triggering the idle timeout.
      data() {
        command.resolve();
      },
    },
  });
  const { child, until } = start(
    'worker',
    `${idleEvaluations}
     const { sendMail } = await import(${JSON.stringify(`${import.meta.dir}/lib/mail.ts`)});
     mock.module(${updatesModule}, () => ({ deliverNext: async (db) => db.transaction(async (tx) => {
       try {
         await sendMail({ to: 'shutdown-test@example.com', subject: 'test', text: 'test', html: 'test' });
       } catch {
         await tx.execute('select 1');
         console.log('delivery-failure-recorded');
         return 'failed';
       }
       throw new Error('The unresponsive SMTP server must time out');
     }) }));`,
    { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_USER: '', SMTP_PASS: '' },
  );
  try {
    await command.promise;
    child.kill('SIGTERM');
    await until('delivery-failure-recorded');
    expect(await child.exited).toBe(0);
  } finally {
    child.kill('SIGKILL');
    await child.exited;
    smtp.stop(true);
  }
}, 20_000);

// Each child loads the whole API, which takes a few seconds on a busy machine
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  test(`API drains an active database request on ${signal}`, async () => {
    const { child, until } = start(
      'index',
      `mock.module(${appModule}, () => ({
         createApp: (db) => ({ fetch: async () => {
           console.log('request-started');
           await db.execute('select pg_sleep(0.3)');
           return new Response('complete');
         } })
       }));`,
    );
    try {
      const output = await until('API listening on port ');
      const port = output.match(/API listening on port (\d+)/)![1];
      const response = fetch(`http://localhost:${port}`).then((res) => res.text());
      await until('request-started');
      child.kill(signal);
      expect(await response).toBe('complete');
      expect(await child.exited).toBe(0);
    } finally {
      child.kill('SIGKILL');
      await child.exited;
    }
  }, 15_000);

  test(`API finishes startup before closing on ${signal}`, async () => {
    const { child, until } = start(
      'index',
      `const updates = await import(${updatesModule});
       mock.module(${updatesModule}, () => ({ ...updates, importDrafts: async (db) => {
         console.log('import-started');
         await db.execute('select pg_sleep(0.3)');
         console.log('import-finished');
       } }));`,
    );
    try {
      await until('import-started');
      child.kill(signal);
      await until('import-finished');
      expect(await child.exited).toBe(0);
    } finally {
      child.kill('SIGKILL');
      await child.exited;
    }
  }, 15_000);

  test(`worker completes its transaction on ${signal}`, async () => {
    const { child, until } = start(
      'worker',
      `${idleEvaluations}
       mock.module(${updatesModule}, () => ({ deliverNext: async (db) => {
         await db.transaction(async (tx) => {
           console.log('delivery-started');
           await tx.execute('select pg_sleep(0.3)');
         });
         console.log('delivery-committed');
         return 'idle';
       } }));`,
    );
    try {
      await until('delivery-started');
      child.kill(signal);
      await until('delivery-committed');
      expect(await child.exited).toBe(0);
    } finally {
      child.kill('SIGKILL');
      await child.exited;
    }
  }, 15_000);

  test(`worker interrupts its idle pause on ${signal}`, async () => {
    const { child, until } = start(
      'worker',
      `${idleEvaluations}
       mock.module(${updatesModule}, () => ({ deliverNext: async () => {
         console.log('idle');
         return 'idle';
       } }));`,
    );
    try {
      await until('idle');
      const before = performance.now();
      child.kill(signal);
      expect(await child.exited).toBe(0);
      expect(performance.now() - before).toBeLessThan(1000);
    } finally {
      child.kill('SIGKILL');
      await child.exited;
    }
  }, 15_000);
}
