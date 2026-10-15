<script lang="ts">
  import { APP_NAME } from '@app/shared';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth, checkAuth, logout } from '$lib/auth.svelte';
  import Button from '$lib/components/Button.svelte';
  import { t } from '$lib/i18n';

  let { children } = $props();
  let ready = $state(false);

  onMount(async () => {
    await checkAuth();
    if (auth.user) {
      ready = true;
      return;
    }
    // Come back to the requested page after logging in
    goto(`/login?next=${encodeURIComponent(page.url.pathname + page.url.search)}`, { replaceState: true });
  });

  async function handleLogout() {
    await logout();
    goto('/');
  }
</script>

{#if ready && auth.user}
  <header>
    <a href="/dashboard" class="brand">{APP_NAME}</a>
    <span class="user">{auth.user.name}</span>
    {#if auth.user.admin}
      <Button variant="secondary" href="/admin/updates">{t().updates}</Button>
      <Button variant="secondary" href="/invite">{t().inviteTester}</Button>
    {/if}
    <Button variant="secondary" href="/settings">{t().settings}</Button>
    <Button variant="secondary" onclick={handleLogout}>{t().logOut}</Button>
  </header>
  <main>
    {@render children()}
  </main>
{/if}

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: center;
    padding: 0.75rem 1.5rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .brand {
    margin-right: auto;
    font-family: var(--font-display);
    font-size: 1.3rem;
    font-weight: 750;
    font-stretch: 80%;
    text-decoration: none;
  }
  .user {
    color: var(--muted);
  }
  main {
    max-width: 1280px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }
</style>
