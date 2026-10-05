<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    variant = 'primary',
    type = 'button',
    loading = false,
    disabled = false,
    href,
    onclick,
    children,
  }: {
    variant?: 'primary' | 'secondary';
    type?: 'button' | 'submit';
    loading?: boolean;
    disabled?: boolean;
    href?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  } = $props();
</script>

{#if href}
  <a {href} class="btn {variant}">{@render children()}</a>
{:else}
  <button {type} class="btn {variant}" disabled={disabled || loading} {onclick}>
    {#if loading}<span class="spinner"></span>{/if}
    <span class:hidden={loading}>{@render children()}</span>
  </button>
{/if}

<style>
  .btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 40px;
    padding: 0 1.1rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .primary {
    background: var(--gradient);
    color: var(--text);
  }
  .secondary {
    background: var(--surface);
    border-color: var(--border);
    color: var(--text);
  }
  .spinner {
    position: absolute;
    width: 14px;
    height: 14px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  .hidden {
    visibility: hidden;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
