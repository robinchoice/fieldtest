<script lang="ts">
  import { onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { sats, t } from '$lib/i18n';
  import { current, loadRound } from '$lib/round.svelte';

  let { children } = $props();

  const id = $derived(page.params.id!);
  const base = $derived(`/rounds/${id}`);
  const detail = $derived(current.detail?.round.id === id ? current.detail : null);

  $effect(() => {
    loadRound(id).catch(() => {});
  });
  // Sessions, budget and runner change while testers are at work
  const refresh = setInterval(() => loadRound(id).catch(() => {}), 15_000);
  onDestroy(() => clearInterval(refresh));

  const tabs = $derived([
    { href: base, label: t().navFindings },
    { href: `${base}/report`, label: t().navReport },
    { href: `${base}/payouts`, label: t().navPayouts, count: detail?.stats.decisions },
    { href: `${base}/testers`, label: t().navTesters },
    { href: `${base}/setup`, label: t().navSetup },
  ]);
</script>

{#if detail}
  <div class="head">
    <p class="crumbs"><a href="/dashboard">{t().allRounds}</a> / {detail.round.product}</p>
    <h1>{detail.round.name}</h1>
    <div class="status">
      <span><strong>{t().sessionsOf(detail.stats.sessions, detail.round.plannedSessions)}</strong>, {t().testingNow(detail.stats.testingNow)}</span>
      {#if detail.runner?.budgetSats != null}<span>{t().budgetLeft(sats(detail.runner.budgetSats))}</span>{/if}
      <span class="runner" class:online={detail.runner?.online}>
        {detail.runner ? (detail.runner.online ? t().runnerOnline : t().runnerOffline) : t().runnerMissing}
      </span>
    </div>
  </div>
  <nav>
    {#each tabs as tab (tab.href)}
      <a href={tab.href} aria-current={page.url.pathname === tab.href ? 'page' : undefined}>
        {tab.label}{#if tab.count}<span class="count">{tab.count}</span>{/if}
      </a>
    {/each}
  </nav>
  {@render children()}
{/if}

<style>
  .head {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 2rem;
    align-items: end;
  }
  .crumbs {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
  h1 {
    margin: 0.2rem 0 0;
    font-size: 2.2rem;
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.5rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .status strong {
    color: var(--text);
    font-weight: 600;
  }
  .runner::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 0.4rem;
    border-radius: 50%;
    background: var(--muted);
  }
  .runner.online::before {
    background: #1d6a44;
  }
  nav {
    display: flex;
    gap: 1.5rem;
    margin: 1.25rem 0 1.5rem;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }
  nav a {
    padding: 0.6rem 0;
    color: var(--muted);
    text-decoration: none;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
  }
  /* Active tab: 2 px line in the product gradient, see DESIGN.md */
  nav a[aria-current='page'] {
    color: var(--text);
    font-weight: 600;
    border-image: var(--gradient) 1;
  }
  .count {
    margin-left: 0.4rem;
    padding: 0 0.45rem;
    border-radius: 999px;
    background: var(--text);
    color: var(--bg);
    font-size: 0.75rem;
  }
  @media (max-width: 800px) {
    .head {
      grid-template-columns: 1fr;
    }
    .status {
      margin-top: 0.5rem;
    }
  }
</style>
