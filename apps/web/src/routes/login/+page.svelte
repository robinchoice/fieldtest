<script lang="ts">
  import { APP_NAME, safeNextPath } from '@app/shared';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth, checkAuth, sendMagicLink } from '$lib/auth.svelte';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import { t } from '$lib/i18n';

  // Page that sent us here, e.g. a link opened while logged out
  const next = safeNextPath(page.url.searchParams.get('next'));

  let email = $state('');
  let sent = $state(false);
  let loading = $state(false);

  onMount(async () => {
    await checkAuth();
    if (auth.user) goto(next ?? '/dashboard', { replaceState: true });
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    try {
      await sendMagicLink(email, next);
      sent = true;
    } catch {
      // The API client already shows the error as a toast
    } finally {
      loading = false;
    }
  }
</script>

<main>
  <p class="brand">{APP_NAME}</p>
  <h1>{t().logIn}</h1>
  {#if sent}
    <p>{t().linkSent}</p>
    <Button variant="secondary" onclick={() => (sent = false)}>{t().otherAddress}</Button>
  {:else}
    <form onsubmit={submit}>
      <p>{t().linkIntro}</p>
      <Input type="email" label={t().email} placeholder={t().emailPlaceholder} bind:value={email} required />
      <Button type="submit" {loading}>{t().sendLink}</Button>
    </form>
  {/if}
</main>

<style>
  main {
    max-width: 400px;
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
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  p {
    margin: 0 0 1rem;
  }
  form p {
    margin: 0;
    color: var(--muted);
  }
</style>
