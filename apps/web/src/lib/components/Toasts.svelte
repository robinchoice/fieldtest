<script lang="ts">
  import { removeToast, toasts } from '$lib/toast.svelte';
</script>

<div class="toasts">
  {#each toasts as t (t.id)}
    <div class="toast {t.type}" role="alert">
      <span>{t.message}</span>
      <button type="button" onclick={() => removeToast(t.id)} aria-label="Schließen">×</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    left: 1rem;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.5rem;
    pointer-events: none;
  }
  .toast {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    max-width: 400px;
    padding: 0.7rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
    pointer-events: auto;
  }
  .error {
    border-color: var(--error);
  }
  button {
    border: none;
    background: none;
    color: var(--muted);
    font-size: 1.2rem;
    cursor: pointer;
  }
</style>
