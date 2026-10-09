import { expect, test } from 'bun:test';
import { invoiceFor, publicHost } from './lnurl';
import { createRunner } from './runner';

// Example invoice from BOLT 11 over 250,000 sats
const INVOICE =
  'lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh';

// A fake network: answers by URL, records every call
function network(routes: Record<string, (url: URL, body: unknown, init?: RequestInit) => unknown>) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const key = `${init?.method ?? 'GET'} ${url.origin}${url.pathname}`;
    calls.push(key);
    const route = routes[key];
    if (!route) return Response.json({ error: 'not found' }, { status: 404 });
    const answer = route(url, init?.body ? JSON.parse(String(init.body)) : undefined, init);
    return answer instanceof Response ? answer : Response.json(answer);
  }) as typeof fetch;
  return { fetcher, calls };
}

test('only public host names count as Lightning address domains', () => {
  expect(publicHost('getalby.com')).toBe(true);
  expect(publicHost('pay.wallet.example.org')).toBe(true);
  for (const host of ['localhost', '192.168.1.10', 'router.local', 'nas.lan', 'x'])
    expect(publicHost(host)).toBe(false);
});

test('invoices come from the LNURL callback and must be for the right amount', async () => {
  const { fetcher } = network({
    'GET https://getalby.com/.well-known/lnurlp/mara': (_url, _body, init) => {
      expect(init?.redirect).toBe('error');
      return {
        tag: 'payRequest',
        callback: 'https://getalby.com/lnurlp/mara/callback',
        minSendable: 1000,
        maxSendable: 1_000_000_000,
        commentAllowed: 20,
      };
    },
    'GET https://getalby.com/lnurlp/mara/callback': (url, _body, init) => {
      expect(init?.redirect).toBe('error');
      comment = url.searchParams.get('comment');
      return { pr: INVOICE };
    },
  });
  let comment = null as string | null;
  expect(await invoiceFor('mara@getalby.com', 250_000, 'Fieldtest: Pebble Wallet', fetcher)).toBe(INVOICE);
  // The wallet allows 20 characters
  expect(comment).toBe('Fieldtest: Pebble Wa');
  await expect(invoiceFor('mara@getalby.com', 10, '', fetcher)).rejects.toThrow('different amount');
  await expect(invoiceFor('mara@192.168.1.1', 10, '', fetcher)).rejects.toThrow('Not a public Lightning address');
});

test('the runner pays open claims within its limits and reports the proof', async () => {
  const claims = [
    { id: 'a', kind: 'live', amountSats: 30, lightningAddress: 'mara@getalby.com', product: 'Pebble' },
    { id: 'b', kind: 'finding', amountSats: 20_000, lightningAddress: 'mara@getalby.com', product: 'Pebble' },
  ];
  const paid: Record<string, { paymentHash: string; preimage: string }> = {};
  const { fetcher, calls } = network({
    'POST https://ft.example/api/v1/runner/status': () => ({ ok: true }),
    'GET https://ft.example/api/v1/runner/claims': () => ({ claims }),
    'POST https://ft.example/api/v1/runner/claims/a/lock': () => ({ claim: { id: 'a', amountSats: 30 } }),
    'POST https://ft.example/api/v1/runner/claims/a/paid': (_url, body) => {
      paid.a = body as (typeof paid)['a'];
      return { ok: true };
    },
  });
  const log: string[] = [];
  const runner = createRunner(
    { url: 'https://ft.example', key: 'ft_x', maxPerClaim: 10_000, maxPerTesterDay: 50_000, dryRun: true },
    null,
    fetcher,
    (line) => log.push(line),
  );
  await runner.tick();

  expect(calls).not.toContain('POST https://ft.example/api/v1/runner/claims/b/lock');
  expect(log.some((l) => l.includes('Skipping 20000 sats'))).toBe(true);
  const hash = new Bun.CryptoHasher('sha256').update(Buffer.from(paid.a!.preimage, 'hex')).digest('hex');
  expect(paid.a!.paymentHash).toBe(hash);
});

test('failed payments go back to the queue with the reason', async () => {
  let failure: unknown;
  const { fetcher } = network({
    'POST https://ft.example/api/v1/runner/status': () => ({ ok: true }),
    'GET https://ft.example/api/v1/runner/claims': () => ({
      claims: [{ id: 'a', kind: 'live', amountSats: 30, lightningAddress: 'mara@getalby.com', product: 'Pebble' }],
    }),
    'POST https://ft.example/api/v1/runner/claims/a/lock': () => ({ claim: { id: 'a', amountSats: 30 } }),
    'GET https://getalby.com/.well-known/lnurlp/mara': () => ({ status: 'ERROR', reason: 'Unknown user' }),
    'POST https://ft.example/api/v1/runner/claims/a/failed': (_url, body) => {
      failure = body;
      return { ok: true };
    },
  });
  const wallet = { pay: async () => 'never', budgetSats: async () => 12_000 };
  const runner = createRunner(
    { url: 'https://ft.example', key: 'ft_x', maxPerClaim: 10_000, maxPerTesterDay: 50_000, dryRun: false },
    wallet,
    fetcher,
    () => {},
  );
  await runner.tick();
  expect(failure).toEqual({ error: 'Unknown user' });
});

test('the runner pays the locked amount and counts it toward the daily limit', async () => {
  const listed = [
    { id: 'a', kind: 'live', amountSats: 200_000, lightningAddress: 'mara@getalby.com', product: 'Pebble' },
    { id: 'b', kind: 'live', amountSats: 30, lightningAddress: 'mara@getalby.com', product: 'Pebble' },
  ];
  let payments = 0;
  const { fetcher, calls } = network({
    'POST https://ft.example/api/v1/runner/status': () => ({ ok: true }),
    'GET https://ft.example/api/v1/runner/claims': () => ({ claims: listed }),
    'POST https://ft.example/api/v1/runner/claims/a/lock': () => ({ claim: { id: 'a', amountSats: 250_000 } }),
    'GET https://getalby.com/.well-known/lnurlp/mara': () => ({
      tag: 'payRequest',
      callback: 'https://getalby.com/callback',
    }),
    'GET https://getalby.com/callback': (url) => {
      expect(url.searchParams.get('amount')).toBe('250000000');
      return { pr: INVOICE };
    },
    'POST https://ft.example/api/v1/runner/claims/a/paid': () => ({ ok: true }),
  });
  const runner = createRunner(
    { url: 'https://ft.example', key: 'ft_x', maxPerClaim: 300_000, maxPerTesterDay: 250_000, dryRun: false },
    {
      pay: async () => {
        payments++;
        return 'proof';
      },
      budgetSats: async () => null,
    },
    fetcher,
    () => {},
  );
  await runner.tick();
  expect(payments).toBe(1);
  expect(calls).not.toContain('POST https://ft.example/api/v1/runner/claims/b/lock');
});

test('the runner releases a claim that grew beyond its limits before lock', async () => {
  let failure: unknown;
  let payments = 0;
  const { fetcher, calls } = network({
    'POST https://ft.example/api/v1/runner/status': () => ({ ok: true }),
    'GET https://ft.example/api/v1/runner/claims': () => ({
      claims: [{ id: 'a', kind: 'live', amountSats: 30, lightningAddress: 'mara@getalby.com', product: 'Pebble' }],
    }),
    'POST https://ft.example/api/v1/runner/claims/a/lock': () => ({ claim: { id: 'a', amountSats: 60 } }),
    'POST https://ft.example/api/v1/runner/claims/a/failed': (_url, body) => {
      failure = body;
      return { ok: true };
    },
  });
  const runner = createRunner(
    { url: 'https://ft.example', key: 'ft_x', maxPerClaim: 50, maxPerTesterDay: 100, dryRun: false },
    {
      pay: async () => {
        payments++;
        return 'proof';
      },
      budgetSats: async () => null,
    },
    fetcher,
    () => {},
  );
  await runner.tick();
  expect(payments).toBe(0);
  expect(calls.some((url) => url.startsWith('GET https://getalby.com'))).toBe(false);
  expect(failure).toEqual({ error: 'lockedAmountExceedsLimits' });
});

for (const status of [200, 409]) {
  test(`failed releases retry without blocking other claims and stop after ${status}`, async () => {
    let polls = 0;
    let releases = 0;
    let paid = 0;
    const { fetcher } = network({
      'POST https://ft.example/api/v1/runner/status': () => ({ ok: true }),
      'GET https://ft.example/api/v1/runner/claims': () => ({
        claims:
          polls++ === 0
            ? [
                { id: 'a', kind: 'live', amountSats: 30, lightningAddress: 'mara@getalby.com', product: 'Pebble' },
                { id: 'b', kind: 'live', amountSats: 20, lightningAddress: 'mara@getalby.com', product: 'Pebble' },
              ]
            : [],
      }),
      'POST https://ft.example/api/v1/runner/claims/a/lock': () => ({ claim: { id: 'a', amountSats: 60 } }),
      'POST https://ft.example/api/v1/runner/claims/a/failed': () => {
        if (++releases === 1) throw new Error('Connection lost');
        return Response.json({ ok: status === 200 }, { status });
      },
      'POST https://ft.example/api/v1/runner/claims/b/lock': () => ({ claim: { id: 'b', amountSats: 20 } }),
      'POST https://ft.example/api/v1/runner/claims/b/paid': () => {
        paid++;
        return { ok: true };
      },
    });
    const runner = createRunner(
      { url: 'https://ft.example', key: 'ft_x', maxPerClaim: 50, maxPerTesterDay: 100, dryRun: true },
      null,
      fetcher,
      () => {},
    );
    await runner.tick();
    expect(paid).toBe(1);
    expect(releases).toBe(1);
    await runner.tick();
    expect(releases).toBe(2);
    await runner.tick();
    expect(releases).toBe(2);
    expect(paid).toBe(1);
  });
}
