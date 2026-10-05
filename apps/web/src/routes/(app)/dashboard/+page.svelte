<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { auth, updateName } from '$lib/auth.svelte';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import { t } from '$lib/i18n';
  import { toast } from '$lib/toast.svelte';

  type Round = { id: string; product: string; name: string; sessions: number; findings: number };

  let rounds = $state<Round[] | null>(null);
  let product = $state('');
  let name = $state('');
  let prototypeUrl = $state('');
  let goals = $state('');
  let saving = $state(false);
  let ownerName = $state(auth.user?.name ?? '');

  onMount(async () => {
    rounds = (await api.get<{ rounds: Round[] }>('/rounds')).rounds;
  });

  async function create(body: { product: string; name: string; prototypeUrl: string; goals: string[] }) {
    saving = true;
    try {
      const { round } = await api.post<{ round: { id: string } }>('/rounds', body);
      goto(`/rounds/${round.id}/setup`);
    } catch {
      // The API client already shows the error as a toast
    } finally {
      saving = false;
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    create({ product, name, prototypeUrl, goals: goals.split('\n').map((g) => g.trim()).filter(Boolean) });
  }

  async function saveName(e: SubmitEvent) {
    e.preventDefault();
    await updateName(ownerName).then(() => toast(t().saved), () => {});
  }

  // The demo prototype under /demo reports these two goals
  function demo() {
    create({
      product: 'Pebble Wallet',
      name: 'Onboarding',
      prototypeUrl: `${location.origin}/demo/pebble.html`,
      goals: ['Back up your wallet', 'Receive your first sats'],
    });
  }
</script>

<div class="page">
  <section>
    <h1>{t().roundsTitle}</h1>
    {#if rounds?.length}
      <ul>
        {#each rounds as round (round.id)}
          <li>
            <a href="/rounds/{round.id}">
              <strong>{round.product}</strong> <span>{round.name}</span>
              <small>{t().sessionsCount(round.sessions)}, {t().findingsCount(round.findings)}</small>
            </a>
          </li>
        {/each}
      </ul>
    {:else if rounds}
      <p class="muted">{t().roundsEmpty}</p>
      <Button variant="secondary" onclick={demo} loading={saving}>{t().tryDemo}</Button>
    {/if}
  </section>

  <div class="side">
  <form onsubmit={submit}>
    <h2>{t().newRound}</h2>
    <Input label={t().productLabel} placeholder="Pebble Wallet" bind:value={product} required />
    <Input label={t().roundNameLabel} placeholder="Onboarding v0.3" bind:value={name} required />
    <Input type="url" label={t().prototypeUrlLabel} placeholder="https://" bind:value={prototypeUrl} required />
    <label>
      <span>{t().goalsLabel}</span>
      <textarea rows="3" bind:value={goals}></textarea>
    </label>
    <Button type="submit" loading={saving}>{t().createRound}</Button>
  </form>
  <form onsubmit={saveName}>
    <Input label={t().ownerName} bind:value={ownerName} required />
    <Button type="submit" variant="secondary">{t().save}</Button>
  </form>
  </div>
</div>

<style>
  .page {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 3rem;
    align-items: start;
  }
  h1 {
    margin: 0 0 1.5rem;
    font-size: 2.4rem;
  }
  h2 {
    margin: 0;
    font-size: 1.5rem;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--border);
  }
  li a {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    align-items: baseline;
    padding: 1rem 0.25rem;
    border-bottom: 1px solid var(--border);
    text-decoration: none;
  }
  li a:hover strong {
    text-decoration: underline;
  }
  li span {
    color: var(--muted);
  }
  small {
    margin-left: auto;
    color: var(--muted);
  }
  .muted {
    margin: 0 0 1rem;
    color: var(--muted);
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  label span {
    font-size: 0.85rem;
    font-weight: 600;
  }
  textarea {
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    resize: vertical;
  }
  textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  @media (max-width: 800px) {
    .page {
      grid-template-columns: 1fr;
    }
  }
</style>
