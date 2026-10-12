<script lang="ts">
  import { auth, invite } from '$lib/auth.svelte';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import { t } from '$lib/i18n';
  import { toast } from '$lib/toast.svelte';

  let email = $state('');
  let sending = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    sending = true;
    try {
      await invite(email);
      toast(t().invited(email));
      email = '';
    } catch {
      // The API client already shows the error as a toast
    } finally {
      sending = false;
    }
  }
</script>

<h1>{t().inviteTester}</h1>
{#if auth.user?.admin}
  <p>{t().inviteTesterIntro}</p>
  <form onsubmit={submit}>
    <Input type="email" label={t().email} placeholder={t().emailPlaceholder} bind:value={email} required />
    <Button type="submit" loading={sending}>{t().invite}</Button>
  </form>
{:else}
  <p>{t().adminOnly}</p>
{/if}

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 360px;
  }
</style>
