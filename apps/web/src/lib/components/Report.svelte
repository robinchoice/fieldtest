<script lang="ts" module>
  export type ReportData = {
    product: string;
    name: string;
    sessions: number;
    top: { id: string; number: number; severity: string | null; title: string; summary: string; fix: string; reporters: number; sessions: number }[];
    rest: { id: string; number: number; severity: string | null; title: string; reporters: number }[];
    unrated: number;
    paidSats: number;
    satsPerFinding: number | null;
    decisions: number;
  };
</script>

<script lang="ts">
  import SeverityBadge from '$lib/components/Severity.svelte';
  import { sats, t } from '$lib/i18n';

  let { report, findingHref }: { report: ReportData; findingHref?: (id: string) => string } = $props();
  const lead = $derived(report.top[0]);
</script>

<div class="report">
  <p class="lede">
    {lead ? t().reportLede(lead.title.replace(/[.!?]+$/, ''), lead.sessions, report.sessions) : t().reportEmpty}
    {#if report.unrated}{t().unratedCount(report.unrated)}{/if}
  </p>

  {#if report.top.length}
    <h2>{t().fixFirst}</h2>
    <ol class="recs">
      {#each report.top as f (f.id)}
        <li>
          <div>
            <h3>{#if findingHref}<a href={findingHref(f.id)}>{f.title}</a>{:else}{f.title}{/if}</h3>
            <p class="impact"><SeverityBadge severity={f.severity} /> {t().impact(f.reporters, f.sessions)}</p>
            {#if f.summary}<p>{f.summary}</p>{/if}
            {#if f.fix}<p><strong>{t().fixLabel}:</strong> {f.fix}</p>{/if}
          </div>
        </li>
      {/each}
    </ol>
  {/if}

  {#if report.rest.length}
    <h2>{t().everythingElse}</h2>
    <ul class="rest">
      {#each report.rest as f (f.id)}
        <li><SeverityBadge severity={f.severity} /><span>{f.title}</span><small>{f.reporters}×</small></li>
      {/each}
    </ul>
  {/if}

  <h2>{t().money}</h2>
  <p>{t().moneyText(sats(report.paidSats), report.satsPerFinding === null ? null : sats(report.satsPerFinding), report.decisions)}</p>
</div>

<style>
  .report {
    max-width: 72ch;
  }
  .lede {
    margin: 0;
    font-size: 1.15rem;
    line-height: 1.6;
  }
  h2 {
    margin: 2rem 0 0.75rem;
    font-size: 1.4rem;
  }
  .recs {
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: rec;
  }
  /* A real order: what to fix first, second, third */
  .recs li {
    display: grid;
    grid-template-columns: 2.5rem 1fr;
    padding: 1rem 0;
    border-top: 1px solid var(--border);
    counter-increment: rec;
  }
  .recs li::before {
    content: counter(rec);
    font-family: var(--font-display);
    font-size: 1.8rem;
    font-weight: 800;
    font-stretch: 80%;
    line-height: 1;
  }
  h3 {
    margin: 0 0 0.25rem;
    font-size: 1.05rem;
  }
  .impact {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .recs p {
    margin: 0 0 0.4rem;
  }
  .rest {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .rest li {
    display: grid;
    grid-template-columns: 7rem 1fr auto;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--border);
  }
  .rest small {
    color: var(--muted);
  }
</style>
