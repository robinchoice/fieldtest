<script lang="ts">
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Report, { type ReportData } from '$lib/components/Report.svelte';
  import { t } from '$lib/i18n';
  import { toast } from '$lib/toast.svelte';

  const id = $derived(page.params.id!);
  let report = $state<ReportData | null>(null);

  $effect(() => {
    api.get<ReportData>(`/rounds/${id}/report`).then((r) => (report = r), () => {});
  });

  async function share() {
    const { shareToken } = await api.post<{ shareToken: string }>(`/rounds/${id}/share`);
    await navigator.clipboard.writeText(`${location.origin}/r/${shareToken}`);
    toast(t().copied);
  }
</script>

{#if report}
  <div class="share">
    <Button variant="secondary" onclick={share}>{t().shareLink}</Button>
    <small>{t().shareHint}</small>
  </div>
  <Report {report} findingHref={() => `/rounds/${id}`} />
{/if}

<style>
  .share {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-bottom: 1.5rem;
    color: var(--muted);
  }
</style>
