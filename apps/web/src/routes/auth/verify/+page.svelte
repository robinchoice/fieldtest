<script lang="ts">
  import { safeNextPath } from '@app/shared';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth, checkAuth, verify } from '$lib/auth.svelte';
  import { t } from '$lib/i18n';

  const token = page.url.searchParams.get('token');
  const next = safeNextPath(page.url.searchParams.get('next'));

  let error = $state('');

  onMount(async () => {
    try {
      if (!token) throw new Error(t().linkIncomplete);
      await verify(token);
    } catch (err) {
      // Links are single-use. Someone opening theirs again is usually still logged in.
      await checkAuth();
      if (!auth.user) {
        error = err instanceof Error ? err.message : t().loginFailed;
        return;
      }
    }
    // Replace the history entry, so the token doesn't linger in it
    goto(next ?? '/dashboard', { replaceState: true });
  });
</script>

<main>
  {#if error}
    <h1>{t().loginFailed}</h1>
    <p>{error}</p>
    <a href={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>{t().requestNewLink}</a>
  {:else}
    <p>{t().loggingIn}</p>
  {/if}
</main>

<style>
  main {
    max-width: 400px;
    margin: 0 auto;
    padding: 6rem 1.5rem;
  }
</style>
