import { decode } from 'light-bolt11-decoder';

const TIMEOUT_MS = 10_000;

// Testers choose their Lightning address, so it can point anywhere. The runner
// only talks to public host names: no IP addresses, no local names, so a
// tester can't make it call into the owner's own network.
export function publicHost(host: string) {
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(host) && !/\.(local|internal|lan|home|localhost)$/i.test(host);
}

type PayParams = {
  tag?: string;
  callback?: string;
  minSendable?: number;
  maxSendable?: number;
  commentAllowed?: number;
  reason?: string;
};

// Asks the tester's wallet for an invoice over the amount (LNURL-pay, LUD-06 and LUD-16)
export async function invoiceFor(address: string, sats: number, comment: string, fetcher: typeof fetch = fetch) {
  const [user, domain] = address.split('@');
  if (!user || !domain || !publicHost(domain)) throw new Error(`Not a public Lightning address: ${address}`);

  const params = (await (
    await fetcher(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    })
  ).json()) as PayParams;
  if (params.tag !== 'payRequest' || !params.callback)
    throw new Error(params.reason || `${address} does not accept payments`);
  const msat = sats * 1000;
  if (msat < (params.minSendable ?? 0) || msat > (params.maxSendable ?? Number.POSITIVE_INFINITY)) {
    throw new Error(`${address} accepts ${params.minSendable! / 1000}–${params.maxSendable! / 1000} sats, not ${sats}`);
  }

  const callback = new URL(params.callback);
  if (callback.protocol !== 'https:' || !publicHost(callback.hostname))
    throw new Error(`Refusing callback ${callback.origin}`);
  callback.searchParams.set('amount', String(msat));
  if (comment && params.commentAllowed) callback.searchParams.set('comment', comment.slice(0, params.commentAllowed));

  const answer = (await (
    await fetcher(callback, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
  ).json()) as {
    pr?: string;
    reason?: string;
  };
  if (!answer.pr) throw new Error(answer.reason || `${address} sent no invoice`);
  const amount = decode(answer.pr).sections.find((s) => s.name === 'amount');
  if (Number(amount && 'value' in amount ? amount.value : 0) !== msat)
    throw new Error(`${address} sent an invoice over a different amount`);
  return answer.pr;
}
