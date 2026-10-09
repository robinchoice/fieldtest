import { hostname } from 'node:os';
import { invoiceFor } from './lnurl';

export const VERSION = '0.1.0';

export type Config = {
  url: string;
  key: string;
  // Claims above this amount stay open for the owner to look at
  maxPerClaim: number;
  maxPerTesterDay: number;
  // Test mode: no wallet, made-up payment proofs. The API has to allow them (ALLOW_FAKE_PAYMENTS=1).
  dryRun: boolean;
};

export type Wallet = {
  pay(invoice: string): Promise<string>;
  // What the wallet connection may still spend, null if the wallet doesn't say
  budgetSats(): Promise<number | null>;
};

type Claim = { id: string; kind: string; amountSats: number; lightningAddress: string; product: string };
type Proof = { invoice?: string; paymentHash?: string; preimage: string };

const sha256 = (hex: string) => new Bun.CryptoHasher('sha256').update(Buffer.from(hex, 'hex')).digest('hex');

export function createRunner(config: Config, wallet: Wallet | null, fetcher: typeof fetch = fetch, log = console.log) {
  const paidToday = new Map<string, number>();
  let day = new Date().toDateString();
  // Paid, but Fieldtest didn't get the proof yet. Retried on every tick, so nothing gets paid twice.
  const unreported = new Map<string, Proof>();
  const unreleased = new Map<string, string>();

  const overLimit = (claim: Claim) =>
    claim.amountSats > config.maxPerClaim ||
    (paidToday.get(claim.lightningAddress) ?? 0) + claim.amountSats > config.maxPerTesterDay;

  async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetcher(`${config.url}/api/v1/runner${path}`, {
      method,
      headers: { authorization: `Bearer ${config.key}`, 'content-type': 'application/json', 'accept-language': 'en' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok)
      throw Object.assign(new Error(data.error || `${res.status} ${res.statusText}`), { status: res.status });
    return data;
  }

  async function pay(claim: Claim): Promise<Proof> {
    if (config.dryRun || !wallet) {
      const preimage = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
      return { paymentHash: sha256(preimage), preimage };
    }
    const invoice = await invoiceFor(claim.lightningAddress, claim.amountSats, `Fieldtest: ${claim.product}`, fetcher);
    return { invoice, preimage: await wallet.pay(invoice) };
  }

  async function tick() {
    if (new Date().toDateString() !== day) {
      day = new Date().toDateString();
      paidToday.clear();
    }
    for (const [id, proof] of unreported) {
      await api('POST', `/claims/${id}/paid`, proof).then(
        () => unreported.delete(id),
        () => {},
      );
    }
    for (const [id, error] of unreleased) {
      await api('POST', `/claims/${id}/failed`, { error }).then(
        () => unreleased.delete(id),
        (err) => {
          if (err.status === 409) unreleased.delete(id);
        },
      );
    }

    const budgetSats = wallet ? await wallet.budgetSats().catch(() => null) : null;
    await api('POST', '/status', { budgetSats, host: hostname(), version: VERSION });

    const { claims } = await api<{ claims: Claim[] }>('GET', '/claims');
    for (const listedClaim of claims) {
      if (overLimit(listedClaim)) {
        log(
          `[runner] Skipping ${listedClaim.amountSats} sats to ${listedClaim.lightningAddress}: above MAX_PER_CLAIM or MAX_PER_TESTER_DAY`,
        );
        continue;
      }
      const locked = await api<{ claim: { amountSats: number } }>('POST', `/claims/${listedClaim.id}/lock`).catch(
        () => null,
      );
      if (!locked) continue;
      const claim = { ...listedClaim, amountSats: locked.claim.amountSats };
      if (overLimit(claim)) {
        const error = 'lockedAmountExceedsLimits';
        log(`[runner] Skipping ${claim.amountSats} sats to ${claim.lightningAddress}: ${error}`);
        await api('POST', `/claims/${claim.id}/failed`, { error }).catch(() => unreleased.set(claim.id, error));
        continue;
      }

      const today = (paidToday.get(claim.lightningAddress) ?? 0) + claim.amountSats;
      let proof: Proof;
      try {
        proof = await pay(claim);
      } catch (err) {
        const error = (err as Error).message.slice(0, 500);
        log(`[runner] Payment of ${claim.amountSats} sats to ${claim.lightningAddress} failed: ${error}`);
        await api('POST', `/claims/${claim.id}/failed`, { error }).catch(() => unreleased.set(claim.id, error));
        continue;
      }
      paidToday.set(claim.lightningAddress, today);
      log(`[runner] Paid ${claim.amountSats} sats to ${claim.lightningAddress}`);
      await api('POST', `/claims/${claim.id}/paid`, proof).catch(() => unreported.set(claim.id, proof));
    }
  }

  return { tick };
}
