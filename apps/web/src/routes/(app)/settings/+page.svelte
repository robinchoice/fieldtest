<script lang="ts">
  import { APP_NAME } from '@app/shared';
  import { page } from '$app/state';
  import { auth, setUpdates } from '$lib/auth.svelte';
  import { t } from '$lib/i18n';
  import { toast } from '$lib/toast.svelte';

  let busy = $state(false);
  const on = $derived(!!auth.user?.updatesSince);
  const since = $derived(
    auth.user?.updatesSince &&
      new Date(auth.user.updatesSince).toLocaleDateString(page.data.locale === 'de' ? 'de-DE' : 'en-GB', {
        dateStyle: 'long',
      }),
  );

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

<style>
  section {
    max-width: 560px;
    padding: 1.1rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
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
