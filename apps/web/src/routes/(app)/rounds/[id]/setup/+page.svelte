<script lang="ts">
  import type { Rewards } from '@app/shared';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import { relative, sats, t } from '$lib/i18n';
  import { current, loadRound } from '$lib/round.svelte';
  import { toast } from '$lib/toast.svelte';

  const id = $derived(page.params.id!);
  const detail = $derived(current.detail?.round.id === id ? current.detail : null);

  let name = $state('');
  let prototypeUrl = $state('');
  let goals = $state('');
  let rewards = $state<Rewards | null>(null);
  let key = $state('');
  let loadedFor = '';

  // Fill the form once per round, later refreshes of the layout must not overwrite edits
  $effect(() => {
    if (!detail || loadedFor === id) return;
    loadedFor = id;
    name = detail.round.name;
    prototypeUrl = detail.round.prototypeUrl;
    goals = detail.round.goals.join('\n');
    rewards = { ...detail.round.rewards };
  });

  const origin = $derived(page.url.origin);
  // Split, a closing script tag would end this script block
  const snippet = $derived(`<script src="${origin}/api/v1/sdk/overlay.js" async></${'script'}>`);
  const apiExample = `Fieldtest.screen('Backup');\nFieldtest.goal('Back up your wallet');`;

  const fields = ['minute', 'screen', 'goal', 'cap', 'cosmetic', 'minor', 'major', 'blocker', 'idea', 'confirm', 'autoApprove', 'scale'] as const;

  // 20 active minutes, about eight new screens, all goals, then a minor and a major finding
  const estimate = $derived.by(() => {
    if (!rewards) return null;
    const scale = (n: number) => Math.round((n * rewards!.scale) / 100);
    const live = Math.min(scale(rewards.minute * 20 + rewards.screen * 8 + rewards.goal * (detail?.round.goals.length ?? 0)), rewards.cap);
    const session = live + scale(rewards.minor + rewards.major);
    return { session, round: session * 20 };
  });

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    toast(t().copied);
  }

  async function saveRound(e: SubmitEvent) {
    e.preventDefault();
    await api.patch(`/rounds/${id}`, { name, prototypeUrl, goals: goals.split('\n').map((g) => g.trim()).filter(Boolean) });
    toast(t().saved);
    await loadRound(id);
  }

  async function saveRewards(e: SubmitEvent) {
    e.preventDefault();
    await api.patch(`/rounds/${id}`, { rewards });
    toast(t().saved);
    await loadRound(id);
  }

  async function createKey() {
    key = (await api.post<{ key: string }>('/runner/key')).key;
    await loadRound(id);
  }
</script>

{#if detail && rewards}
  <div class="grid">
    <section>
      <h2>{t().inviteTitle}</h2>
      <p class="muted">{t().inviteIntro}</p>
      <div class="copy">
        <code>{detail.round.inviteUrl}</code>
        <Button variant="secondary" onclick={() => copy(detail.round.inviteUrl)}>{t().copyLink}</Button>
      </div>
    </section>

    <section>
      <h2>{t().embedTitle}</h2>
      <p class="muted">{t().embedIntro}</p>
      <div class="copy">
        <code>{snippet}</code>
        <Button variant="secondary" onclick={() => copy(snippet)}>{t().copyText}</Button>
      </div>
      <p class="muted">{t().embedApi}</p>
      <pre>{apiExample}</pre>
    </section>

    <form onsubmit={saveRound}>
      <h2>{t().roundTitle}</h2>
      <Input label={t().roundNameLabel} bind:value={name} required />
      <Input type="url" label={t().prototypeUrlLabel} bind:value={prototypeUrl} required />
      <label class="area">
        <span>{t().goalsLabel}</span>
        <textarea rows="3" bind:value={goals}></textarea>
      </label>
      <div><Button type="submit">{t().save}</Button></div>
    </form>

    <form onsubmit={saveRewards}>
      <h2>{t().rewardsTitle}</h2>
      <div class="rates">
        {#each fields as field (field)}
          <label>
            <span>{t().rewardNames[field]}</span>
            <input type="number" min="0" step="1" bind:value={rewards[field]} />
          </label>
        {/each}
      </div>
      {#if estimate}<p class="estimate">{t().estimate(sats(estimate.session), sats(estimate.round))}</p>{/if}
      <div><Button type="submit">{t().save}</Button></div>
    </form>

    <section class="wide">
      <h2>{t().runnerTitle}</h2>
      <p class="muted">{t().runnerIntro}</p>
      {#if detail.runner}
        <p>
          <strong>{detail.runner.online ? t().runnerOnline : t().runnerOffline}</strong>.
          {detail.runner.lastSeenAt ? t().runnerSeen(relative(detail.runner.lastSeenAt)) : t().runnerNever}
          {#if detail.runner.host}{t().runnerDetails(detail.runner.host, detail.runner.version ?? '?')}{/if}
        </p>
      {/if}
      {#if key}
        <p class="muted">{t().keyOnce}</p>
        <pre>FIELDTEST_URL={origin}
FIELDTEST_KEY={key}
NWC_URL=nostr+walletconnect://…
bun run --filter @app/runner start</pre>
      {/if}
      <p class="muted">{t().budgetHint}</p>
      <Button variant="secondary" onclick={createKey}>{detail.runner ? t().rotateKey : t().createKey}</Button>
    </section>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.5rem;
  }
  section,
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1.25rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .wide {
    grid-column: 1 / -1;
  }
  h2 {
    margin: 0;
    font-size: 1.3rem;
  }
  p {
    margin: 0;
  }
  .muted {
    color: var(--muted);
  }
  .copy {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  code {
    flex: 1;
    min-width: 0;
    padding: 0.55rem 0.7rem;
    border-radius: var(--radius);
    background: var(--bg);
    font-size: 0.82rem;
    overflow-wrap: anywhere;
  }
  pre {
    margin: 0;
    padding: 0.8rem 1rem;
    border-radius: var(--radius);
    background: #17171a;
    color: #f2f0ea;
    font-size: 0.82rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .area {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .area span,
  .rates span {
    font-size: 0.85rem;
    font-weight: 600;
  }
  textarea,
  input {
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  .rates {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem 1rem;
  }
  .rates label {
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    align-items: center;
  }
  .rates input {
    width: 6.5rem;
    text-align: right;
  }
  .estimate {
    padding: 0.75rem 1rem;
    border-radius: var(--radius);
    background: #f6f1d9;
  }
  @media (max-width: 860px) {
    .grid,
    .rates {
      grid-template-columns: 1fr;
    }
    .copy {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
