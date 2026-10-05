<script lang="ts">
  import type { Severity } from '@app/shared';
  import { t } from '$lib/i18n';

  let { severity }: { severity: string | null } = $props();
</script>

<span class="severity {severity ?? 'unrated'}">{severity ? t().severityNames[severity as Severity] : t().unrated}</span>

<style>
  /* Deep tones of the family band: red, orange, turquoise, green */
  .severity {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.8rem;
    font-weight: 650;
    white-space: nowrap;
  }
  .severity::before {
    content: '';
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 2px;
    background: currentColor;
  }
  .blocker {
    color: #b3262d;
  }
  .major {
    color: #a8461a;
  }
  .minor {
    color: #156a88;
  }
  .cosmetic {
    color: var(--muted);
  }
  .idea {
    color: #1d6a44;
  }
  .unrated {
    color: var(--text);
  }
  .unrated::before {
    background: none;
    border: 1.5px solid currentColor;
  }
</style>
