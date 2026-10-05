<script lang="ts">
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import Report, { type ReportData } from '$lib/components/Report.svelte';
  import { t } from '$lib/i18n';

  let report = $state<ReportData | null>(null);
  let missing = $state(false);

  $effect(() => {
    api.get<ReportData>(`/reports/${page.params.token}`, true).then(
      (r) => (report = r),
      () => (missing = true),
    );
  });
</script>

<main>
  {#if report}
    <p class="kicker">{t().sharedReport}</p>
    <h1>{t().reportTitle(report.product, report.name)}</h1>
    <Report {report} />
  {:else if missing}
    <h1>{t().notFound}</h1>
  {/if}
</main>

<style>
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 3rem 1.5rem;
  }
  .kicker {
    margin: 0;
    color: var(--muted);
  }
  h1 {
    margin: 0.25rem 0 1.5rem;
    font-size: 2.4rem;
  }
</style>
