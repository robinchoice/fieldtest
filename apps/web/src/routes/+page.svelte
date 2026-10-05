<script lang="ts">
  import { APP_NAME } from '@app/shared';
  import { onMount } from 'svelte';
  import { auth, checkAuth } from '$lib/auth.svelte';
  import Button from '$lib/components/Button.svelte';
  import { t } from '$lib/i18n';

  onMount(checkAuth);
</script>

<main>
  <h1>{APP_NAME}</h1>
  <p>{t().tagline}</p>
  {#if auth.user}
    <Button href="/dashboard">{t().openApp}</Button>
  {:else}
    <Button href="/login">{t().logIn}</Button>
  {/if}
</main>

<style>
  main {
    max-width: 640px;
    margin: 0 auto;
    padding: 6rem 1.5rem;
  }
  h1 {
    margin: 0 0 0.75rem;
    font-size: clamp(2.75rem, 9vw, 4.5rem);
    font-weight: 800;
    font-stretch: 75%;
    line-height: 0.95;
  }
  p {
    margin: 0 0 2rem;
    color: var(--muted);
  }
</style>
