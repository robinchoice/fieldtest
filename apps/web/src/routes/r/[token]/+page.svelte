<script lang="ts">
  import Report from '$lib/components/Report.svelte';
  import { t } from '$lib/i18n';

  let { data } = $props();
</script>

<main>
  {#if data.report}
    <p class="kicker">{t().sharedReport}</p>
    <h1>{t().reportTitle(data.report.product, data.report.name)}</h1>
    <Report report={data.report} />
  {:else}
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
