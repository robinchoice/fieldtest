<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  // Further attributes such as autocomplete or inputmode go to the input
  let {
    value = $bindable(''),
    label,
    type = 'text',
    placeholder = '',
    error,
    required = false,
    ...rest
  }: {
    value?: string;
    label: string;
    type?: 'text' | 'email' | 'url';
    placeholder?: string;
    error?: string;
    required?: boolean;
  } & Omit<HTMLInputAttributes, 'value' | 'type'> = $props();
</script>

<label>
  <span>{label}</span>
  <input {...rest} {type} bind:value {placeholder} {required} class:invalid={!!error} />
  {#if error}<small>{error}</small>{/if}
</label>

<style>
  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  span {
    font-size: 0.85rem;
    font-weight: 600;
  }
  input {
    height: 42px;
    padding: 0 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .invalid {
    border-color: var(--error);
  }
  small {
    color: var(--error);
  }
</style>
