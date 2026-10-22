<script lang="ts">
  import { APP_NAME, safeNextPath } from '@app/shared';
  import {
    browserSupportsWebAuthn,
    browserSupportsWebAuthnAutofill,
    WebAuthnAbortService,
  } from '@simplewebauthn/browser';
  import { onDestroy, onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth, checkAuth, passkeyLogin, sendMagicLink, verifyCode } from '$lib/auth.svelte';
  import Altcha from '$lib/components/Altcha.svelte';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import { t } from '$lib/i18n';

  // Page that sent us here, e.g. a link opened while logged out
  const next = safeNextPath(page.url.searchParams.get('next'));

  let email = $state('');
  let code = $state('');
  // Unticked: update mails are opt-in, see README „Update-Mails“
  let updates = $state(false);
  let altcha = $state('');
  let altchaWidget = $state<Altcha>();
  let sent = $state(false);
  let loading = $state(false);
  let passkeys = $state(false);
  let autofillAvailable = $state(false);
  let visible = $state(false);
  let passkeyLoading = $state(false);
  const lifetime = new AbortController();

  onMount(() => {
    const updateVisibility = () => (visible = document.visibilityState === 'visible');
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  });

  onMount(async () => {
    await checkAuth();
    if (lifetime.signal.aborted) return;
    if (auth.user) return goto(next ?? '/dashboard', { replaceState: true });
    passkeys = browserSupportsWebAuthn();
    autofillAvailable = await browserSupportsWebAuthnAutofill();
  });

  $effect(() => {
    if (!autofillAvailable || !visible || sent || passkeyLoading) return;
    // Offers saved passkeys in the address field's autofill. Its challenge
    // expires after five minutes, so a fresh request replaces it before.
    let request: AbortController;
    function renew() {
      request?.abort();
      request = new AbortController();
      logInWithPasskey(true, request.signal);
    }
    renew();
    const interval = setInterval(renew, 4 * 60 * 1000);
    return () => {
      clearInterval(interval);
      request.abort();
      WebAuthnAbortService.cancelCeremony();
    };
  });

  // The autofill request would otherwise outlive the page
  onDestroy(() => {
    lifetime.abort();
    WebAuthnAbortService.cancelCeremony();
  });

  async function logInWithPasskey(autofill: boolean, signal = lifetime.signal) {
    if (!autofill) {
      if (passkeyLoading) return;
      passkeyLoading = true;
      await tick();
    }
    try {
      await passkeyLogin(autofill, signal);
      await goto(next ?? '/dashboard', { replaceState: true });
    } catch {
      // Cancelled, replaced by the button's request, or the API client showed the error
    } finally {
      if (!autofill) passkeyLoading = false;
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!altcha) return;
    loading = true;
    try {
      await sendMagicLink(email, next, updates, altcha);
      sent = true;
      code = '';
      // Used up: another address gets a new widget that solves again
      altcha = '';
    } catch {
      // The API client already shows the error as a toast
      altchaWidget?.reset();
    } finally {
      loading = false;
    }
  }

  async function submitCode(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    try {
      await verifyCode(email, code);
      goto(next ?? '/dashboard', { replaceState: true });
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
    <form onsubmit={submitCode}>
      <p>{t().linkSent}</p>
      <Input
        label={t().code}
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength={6}
        bind:value={code}
        required
      />
      <Button type="submit" {loading}>{t().logIn}</Button>
      <Button variant="secondary" onclick={() => (sent = false)}>{t().otherAddress}</Button>
    </form>
  {:else}
    <form onsubmit={submit}>
      <p>{t().linkIntro}</p>
      <Input
        type="email"
        label={t().email}
        placeholder={t().emailPlaceholder}
        autocomplete="email webauthn"
        bind:value={email}
        required
      />
      <label class="check">
        <input type="checkbox" bind:checked={updates} />
        <span>{t().updatesOptIn}</span>
      </label>
      <Altcha bind:payload={altcha} bind:this={altchaWidget} />
      <Button type="submit" {loading}>{t().sendLink}</Button>
    </form>
    {#if passkeys}
      <div class="passkey">
        <p>{t().or}</p>
        <Button variant="secondary" loading={passkeyLoading} onclick={() => logInWithPasskey(false)}>
          {t().passkeyLogIn}
        </Button>
      </div>
    {/if}
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
  .passkey {
    display: flex;
    flex-direction: column;
  }
  .passkey p {
    margin: 1rem 0;
    color: var(--muted);
    text-align: center;
  }
  .check {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    font-size: 0.92rem;
    cursor: pointer;
  }
  .check input {
    width: 18px;
    height: 18px;
    margin: 2px 0 0;
    flex: none;
    accent-color: var(--accent);
  }
</style>
