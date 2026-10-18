<script lang="ts">
  import { APP_NAME, type Passkey } from '@app/shared';
  import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
  import { onMount } from 'svelte';
  import { addPasskey, auth, listPasskeys, removePasskey, setUpdates } from '$lib/auth.svelte';
  import Button from '$lib/components/Button.svelte';
  import { date, t } from '$lib/i18n';
  import { toast } from '$lib/toast.svelte';

  let busy = $state(false);
  const on = $derived(!!auth.user?.updatesSince);
  const day = (iso: string) => date(iso, { dateStyle: 'long' });
  const since = $derived(auth.user?.updatesSince && day(auth.user.updatesSince));

  let passkeys = $state<Passkey[]>([]);
  let canAddPasskey = $state(false);
  let adding = $state(false);

  onMount(async () => {
    canAddPasskey = browserSupportsWebAuthn();
    passkeys = await listPasskeys().catch(() => []);
  });

  async function add() {
    adding = true;
    try {
      passkeys = [...passkeys, await addPasskey()];
      toast(t().passkeyAdded);
    } catch {
      // Cancelled in the browser's dialog, or the API client showed the error
    } finally {
      adding = false;
    }
  }

  async function remove(id: string) {
    try {
      await removePasskey(id);
      passkeys = passkeys.filter((passkey) => passkey.id !== id);
      toast(t().passkeyRemoved);
    } catch {
      // The API client already shows the error as a toast
    }
  }

  // Saves right away, the toast confirms it
  async function toggle() {
    busy = true;
    try {
      await setUpdates(!on);
      toast(on ? t().updatesTurnedOn : t().updatesTurnedOff);
    } catch {
      // The API client already shows the error as a toast
    } finally {
      busy = false;
    }
  }
</script>

<h1>{t().settings}</h1>

<section>
  <h2>{t().mails}</h2>
  <div class="row">
    <div>
      <strong id="updates-label">{t().updatesByMail}</strong>
      <p>{t().updatesHint(APP_NAME)}</p>
      <p>{since ? t().updatesSince(since) : t().updatesOff}</p>
    </div>
    <button
      type="button"
      class="switch"
      class:on
      role="switch"
      aria-checked={on}
      aria-labelledby="updates-label"
      disabled={busy}
      onclick={toggle}
    ></button>
  </div>
</section>

<section>
  <h2>{t().passkeys}</h2>
  <p>{t().passkeysHint}</p>
  {#if passkeys.length}
    <ul>
      {#each passkeys as passkey (passkey.id)}
        <li>
          <div>
            <strong>{t().passkeyAddedOn(day(passkey.createdAt))}</strong>
            <p>
              {passkey.backedUp ? t().passkeySynced : t().passkeyOneDevice}{#if passkey.lastUsedAt}
                · {t().passkeyUsedOn(day(passkey.lastUsedAt))}{/if}
            </p>
          </div>
          <Button variant="secondary" onclick={() => remove(passkey.id)}>{t().removePasskey}</Button>
        </li>
      {/each}
    </ul>
  {:else}
    <p>{t().noPasskeys}</p>
  {/if}
  {#if canAddPasskey}
    <div class="add"><Button loading={adding} onclick={add}>{t().addPasskey}</Button></div>
  {/if}
</section>

<style>
  ul {
    margin: 0.8rem 0 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 0;
    border-top: 1px solid var(--border);
  }
  .add {
    margin-top: 1rem;
  }
  section {
    max-width: 560px;
    padding: 1.1rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  section + section {
    margin-top: 1rem;
  }
  h2 {
    margin: 0 0 0.8rem;
    font-size: 1.2rem;
  }
  .row {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    justify-content: space-between;
  }
  p {
    margin: 0.2rem 0 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .switch {
    position: relative;
    flex: none;
    width: 46px;
    height: 28px;
    border: 0;
    border-radius: 99px;
    background: #d5d5d0;
    cursor: pointer;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
    transition: left 0.15s;
  }
  .switch.on {
    background: var(--gradient);
  }
  .switch.on::after {
    left: 21px;
  }
  .switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
