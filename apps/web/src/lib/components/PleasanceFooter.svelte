<script lang="ts">
  import { APP_BAND } from '@app/shared';
  import { page } from '$app/state';
  import { auth } from '$lib/auth.svelte';
  import { setTestMode, testMode } from '$lib/feedback.svelte';
  import { setLocale, t } from '$lib/i18n';

  const other = $derived(page.data.locale === 'de' ? 'en' : 'de');
</script>

<footer>
  <a href="https://pleasance.org">{t().madeBy} <span class="wordmark" role="img" aria-label="Pleasance"></span></a>
  <span class="band" aria-hidden="true"><span
      class="marker"
      style:left="{((APP_BAND.from - 1) / 6) * 100}%"
      style:width="{((APP_BAND.to - APP_BAND.from) / 6) * 100}%"
    ></span></span>
  {#if auth.user}
    <label title={t().testModeHint}>
      <input type="checkbox" checked={testMode.on} onchange={(e) => setTestMode(e.currentTarget.checked)} />
      {t().testMode}
    </label>
  {/if}
  <button type="button" lang={other} onclick={() => setLocale(other)}>{t().otherLanguage}</button>
</footer>

<style>
  footer {
    display: flex;
    gap: 1rem;
    align-items: center;
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.8125rem;
  }
  a {
    display: inline-flex;
    gap: 0.5rem;
    align-items: center;
    text-decoration: none;
  }
  .wordmark {
    width: 76px;
    height: 14px;
    background: currentColor;
    mask: url('/pleasance-wordmark.svg') left center / contain no-repeat;
  }
  .band {
    position: relative;
    width: 8.5rem;
    height: 3px;
    margin-left: auto;
    border-radius: 2px;
    background: linear-gradient(rgb(255 255 255 / 0.6), rgb(255 255 255 / 0.6)), var(--spectrum);
  }
  label {
    display: inline-flex;
    gap: 0.375rem;
    align-items: center;
    cursor: pointer;
  }
  input {
    margin: 0;
    accent-color: var(--accent);
  }
  button {
    padding: 0.25rem 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }
  .marker {
    position: absolute;
    top: -3px;
    min-width: 9px;
    height: 9px;
    border-radius: 5px;
    background: var(--gradient);
    box-shadow: 0 0 0 2px var(--bg);
  }
</style>
