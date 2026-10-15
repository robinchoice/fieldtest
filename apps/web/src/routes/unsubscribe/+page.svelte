<script lang="ts">
  import { APP_NAME } from '@app/shared';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import { t } from '$lib/i18n';

  // The link from the update mails. Opening it unsubscribes without login.
  // Mail scanners fetch links without running scripts, so they don't.
  const token = page.url.searchParams.get('token') ?? '';
  let status = $state<'busy' | 'unsubscribed' | 'subscribed' | 'error'>('busy');
  let error = $state('');

  async function set(path: string, next: typeof status) {
    try {
      await api.post(`/updates/${path}?token=${encodeURIComponent(token)}`, undefined, true);
      status = next;
    } catch (err) {
      error = err instanceof Error ? err.message : t().unsubscribeInvalid;
      status = 'error';
    }
  }

  onMount(() => set('unsubscribe', 'unsubscribed'));
</script>

<main>
  <p class="brand">{APP_NAME}</p>
  {#if status === 'busy'}
    <p>{t().unsubscribing}</p>
  {:else if status === 'unsubscribed'}
    <h1>{t().unsubscribed}</h1>
    <p>{t().unsubscribedText(APP_NAME)}</p>
    <Button variant="secondary" onclick={() => set('subscribe', 'subscribed')}>{t().resubscribe}</Button>
  {:else if status === 'subscribed'}
    <h1>{t().resubscribed}</h1>
    <p>{t().resubscribedText(APP_NAME)}</p>
  {:else}
    <p>{error}</p>
  {/if}
</main>

<style>
  main {
    max-width: 440px;
    margin: 0 auto;
    padding: 6rem 1.5rem;
  }
  .brand {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  h1 {
    margin: 0 0 1rem;
  }
  p {
    margin: 0 0 1.5rem;
  }
</style>
