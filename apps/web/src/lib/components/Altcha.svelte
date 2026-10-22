<script lang="ts">
  import type {} from 'altcha/types/svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';

  // Proof of work against bots for public forms (README, „ALTCHA“). The first
  // submit starts it, the widget submits the form again once it is solved. The
  // form's handler therefore ignores submits without a payload.
  let { payload = $bindable('') }: { payload?: string } = $props();
  let widget = $state<HTMLElementTagNameMap['altcha-widget']>();

  onMount(() => {
    import('$lib/altcha');
  });

  // Each solution counts once, after a failed request the form needs a new one
  export function reset() {
    payload = '';
    widget?.reset();
  }
</script>

<altcha-widget
  bind:this={widget}
  challenge="/api/v1/altcha"
  language={page.data.locale}
  auto="onsubmit"
  configuration={JSON.stringify({ humanInteractionSignature: false })}
  onstatechange={(e) => (payload = e.detail.payload ?? '')}
  onexpired={reset}
></altcha-widget>

<style>
  altcha-widget {
    --altcha-border-color: var(--border);
    --altcha-border-radius: var(--radius);
    --altcha-color-base: var(--surface);
    --altcha-color-base-content: var(--text);
    --altcha-color-neutral-content: var(--muted);
    --altcha-color-primary: var(--text);
    --altcha-color-error: var(--error);
    --altcha-max-width: 100%;
  }
</style>
