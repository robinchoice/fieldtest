<script lang="ts">
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { sats, t } from '$lib/i18n';

  type Tester = { tester: string; reputation: number; sessions: number; reports: number; paidSats: number };

  let testers = $state<Tester[] | null>(null);
  $effect(() => {
    api.get<{ testers: Tester[] }>(`/rounds/${page.params.id}/testers`).then((r) => (testers = r.testers), () => {});
  });
</script>

<p class="intro">{t().testersIntro}</p>
{#if testers?.length}
  <table>
    <thead>
      <tr>
        <th>{t().colTester}</th><th class="num">{t().colReputation}</th><th class="num">{t().colSessions}</th>
        <th class="num">{t().colReports}</th><th class="num">{t().colPaid}</th>
      </tr>
    </thead>
    <tbody>
      {#each testers as row (row.tester)}
        <tr>
          <td>{row.tester}</td><td class="num">{row.reputation / 100}×</td><td class="num">{row.sessions}</td>
          <td class="num">{row.reports}</td><td class="num">{sats(row.paidSats)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else if testers}
  <p class="intro">{t().noTesters}</p>
{/if}

<style>
  .intro {
    max-width: 68ch;
    margin: 0 0 1.5rem;
    color: var(--muted);
  }
  table {
    width: 100%;
    max-width: 760px;
    border-collapse: collapse;
    background: var(--surface);
  }
  th,
  td {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  th {
    color: var(--muted);
    font-size: 0.85rem;
    font-weight: 600;
  }
  .num {
    text-align: right;
  }
</style>
