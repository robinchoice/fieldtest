<script lang="ts">
  import { APP_NAME, safeNextPath } from '@app/shared';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth, checkAuth, sendMagicLink } from '$lib/auth.svelte';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';

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
  <h1>Einloggen</h1>
  {#if sent}
    <p>Check deine E-Mails, der Login-Link ist unterwegs.</p>
    <Button variant="secondary" onclick={() => (sent = false)}>Andere Adresse</Button>
  {:else}
    <form onsubmit={submit}>
      <p>Wir schicken dir einen Login-Link. Beim ersten Login legen wir dein Konto an.</p>
      <Input type="email" label="E-Mail" placeholder="du@example.com" bind:value={email} required />
      <Button type="submit" {loading}>Login-Link senden</Button>
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
