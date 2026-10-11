<script lang="ts">
  import type { ClaimStatus } from '@app/shared';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import { relative, sats, t } from '$lib/i18n';
  import { current, loadRound } from '$lib/round.svelte';
  import { toast } from '$lib/toast.svelte';

  type Claim = {
    id: string;
    kind: 'live' | 'finding' | 'confirm';
    status: ClaimStatus;
    base: number;
    multiplier: number;
    amount: number;
    approveAt: string | null;
    lastError: string | null;
    tester: string;
    findingNumber: number | null;
    findingTitle: string | null;
    proof: string | null;
  };

  const id = $derived(page.params.id!);
  let claims = $state<Claim[] | null>(null);
  const review = $derived(claims?.filter((c) => c.status === 'review') ?? []);

  const load = async () => (claims = (await api.get<{ claims: Claim[] }>(`/rounds/${id}/claims`)).claims);
  $effect(() => {
    load().catch(() => {});
    // Payments of the runner show up without reloading
    const timer = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  });

  const what = (c: Claim) => `${t().claimKinds[c.kind]}${c.findingNumber ? `, F-${c.findingNumber}: ${c.findingTitle}` : ''}`;

  async function act(claim: Claim, action: 'approve' | 'lower' | 'reject') {
    await api.post(`/rounds/${id}/claims/${claim.id}/${action}`);
    toast({ approve: t().approvedToast, lower: t().loweredToast, reject: t().rejectedToast }[action]);
    await Promise.all([load(), loadRound(id)]);
  }
</script>

{#if claims}
  <p class="intro">{t().payoutsIntro(sats(current.detail?.round.rewards.autoApprove ?? 0))}</p>

  <section class="block">
    <h2>{t().needsDecision}</h2>
    {#each review as c (c.id)}
      <div class="decide">
        <div>
          <strong>{c.tester}</strong>: {what(c)}
          <p class="why">{t().baseTimesRep(sats(c.base), c.multiplier)}. {c.approveAt ? t().approvesIn(relative(c.approveAt)) : ''}</p>
          <div class="actions">
            <Button onclick={() => act(c, 'approve')}>{t().approve}</Button>
            {#if c.kind === 'finding'}<Button variant="secondary" onclick={() => act(c, 'lower')}>{t().lower}</Button>{/if}
            <Button variant="secondary" onclick={() => act(c, 'reject')}>{t().reject}</Button>
          </div>
        </div>
        <span class="amount">{t().satsAmount(sats(c.amount))}</span>
      </div>
    {:else}
      <p class="muted">{t().noDecisions}</p>
    {/each}
  </section>

  <section class="block">
    <h2>{t().ledger}</h2>
    {#if claims.length}
      <table>
        <thead>
          <tr><th>{t().colTester}</th><th class="wide">{t().colFor}</th><th class="num">{t().colSats}</th><th>{t().colStatus}</th><th class="wide">{t().colProof}</th></tr>
        </thead>
        <tbody>
          {#each claims as c (c.id)}
            <tr>
              <td>{c.tester}</td>
              <td class="wide">{what(c)}{#if c.lastError}<small class="error">{c.lastError === 'lockedAmountExceedsLimits' ? t().lockedAmountExceedsLimits : c.lastError}</small>{/if}</td>
              <td class="num">{sats(c.amount)}</td>
              <td><span class="claim {c.status}">{t().claimStatuses[c.status]}</span></td>
              <td class="wide proof">{c.proof ?? ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="muted">{t().noClaims}</p>
    {/if}
  </section>
{/if}

<style>
  .intro,
  .muted {
    color: var(--muted);
  }
  .intro {
    margin: 0 0 1.5rem;
  }
  .block {
    margin-bottom: 1.5rem;
    padding: 1.25rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  h2 {
    margin: 0 0 1rem;
    font-size: 1.3rem;
  }
  .decide {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 1rem;
    padding: 1rem 0;
    border-top: 1px solid var(--border);
  }
  .decide:first-of-type {
    padding-top: 0;
    border-top: 0;
  }
  .why {
    margin: 0.25rem 0 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .amount {
    font-family: var(--font-display);
    font-size: 1.6rem;
    font-weight: 750;
    font-stretch: 80%;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th {
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
    font-weight: 600;
    text-align: left;
  }
  td {
    padding: 0.55rem 0.5rem;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  .num {
    text-align: right;
  }
  .proof {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .error {
    display: block;
    color: var(--error);
  }
  .claim {
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: rgb(23 23 26 / 0.07);
    font-size: 0.8rem;
    white-space: nowrap;
  }
  .claim.review {
    background: var(--needs-bg);
  }
  .claim.paid {
    background: var(--new-bg);
  }
  @media (max-width: 700px) {
    .wide {
      display: none;
    }
  }
</style>
