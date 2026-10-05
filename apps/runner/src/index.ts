// Fieldtest payout runner. Runs on the owner's machine, pays approved claims
// through the owner's wallet (Nostr Wallet Connect) and reports the proof back.
// The wallet connection never leaves this process.
import { NWCClient } from '@getalby/sdk/nwc';
import { createRunner, VERSION, type Wallet } from './runner';

const env = process.env;
const dryRun = env.DRY_RUN === '1';
if (!env.FIELDTEST_URL || !env.FIELDTEST_KEY || (!env.NWC_URL && !dryRun)) {
  console.error('Set FIELDTEST_URL, FIELDTEST_KEY and NWC_URL (or DRY_RUN=1 to test without a wallet).');
  process.exit(1);
}

let wallet: Wallet | null = null;
let client: NWCClient | null = null;
if (!dryRun) {
  client = new NWCClient({ nostrWalletConnectUrl: env.NWC_URL! });
  const nwc = client;
  wallet = {
    pay: async (invoice) => (await nwc.payInvoice({ invoice })).preimage,
    // NWC counts in millisats. Without a budget on the connection, the balance is the limit.
    budgetSats: async () => {
      const budget = await nwc.getBudget();
      if ('total_budget' in budget) return Math.floor((budget.total_budget - budget.used_budget) / 1000);
      return Math.floor((await nwc.getBalance()).balance / 1000);
    },
  };
}

const runner = createRunner(
  {
    url: env.FIELDTEST_URL.replace(/\/$/, ''),
    key: env.FIELDTEST_KEY,
    maxPerClaim: Number(env.MAX_PER_CLAIM || 10_000),
    maxPerTesterDay: Number(env.MAX_PER_TESTER_DAY || 50_000),
    dryRun,
  },
  wallet,
);

const seconds = Number(env.POLL_SECONDS || 10);
console.log(`[runner] Fieldtest runner ${VERSION}${dryRun ? ' in test mode' : ''}, checking every ${seconds} s`);

let running = false;
async function loop() {
  if (running) return;
  running = true;
  try {
    await runner.tick();
  } catch (err) {
    console.error(`[runner] ${(err as Error).message}`);
  } finally {
    running = false;
  }
}
loop();
const timer = setInterval(loop, seconds * 1000);

process.on('SIGINT', () => {
  clearInterval(timer);
  client?.close();
  process.exit(0);
});
