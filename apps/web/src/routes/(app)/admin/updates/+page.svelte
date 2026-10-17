<script lang="ts">
  import { type Locale, type UpdateContent, type UpdateSummary, updateComplete } from '@app/shared';
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth.svelte';
  import Button from '$lib/components/Button.svelte';
  import Input from '$lib/components/Input.svelte';
  import { date, t } from '$lib/i18n';
  import { toast } from '$lib/toast.svelte';

  // Agents write drafts as updates/<slug>.md, the API imports them on start.
  // Only admins from ADMIN_EMAILS send, see README „Update-Mails“.
  let list = $state<UpdateSummary[]>([]);
  let subscribers = $state(0);
  let selectedId = $state<string | null>(null);
  let lang = $state<Locale>(page.data.locale);
  // The draft being edited, features as one text per language
  let title = $state({ de: '', en: '' });
  let features = $state({ de: '', en: '' });
  let image = $state<string | null | undefined>(undefined);
  let busy = $state('');
  let confirming = $state(false);
  let previewKey = $state(0);
  let poll: ReturnType<typeof setInterval> | undefined;

  const selected = $derived(list.find((update) => update.id === selectedId));
  const drafts = $derived(list.filter((update) => !update.sentAt));
  const sent = $derived(list.filter((update) => update.sentAt));
  const content = $derived<UpdateContent>({
    de: { title: title.de, features: features.de.split('\n').map((line) => line.trim()).filter(Boolean) },
    en: { title: title.en, features: features.en.split('\n').map((line) => line.trim()).filter(Boolean) },
  });

  async function load() {
    const res = await api.get<{ updates: UpdateSummary[]; subscribers: number }>('/updates');
    list = res.updates;
    subscribers = res.subscribers;
    if (!selected && list[0]) select(list[0]);
    // The worker sends in the background, the numbers follow it
    if (list.some((update) => update.pending > 0)) poll ??= setInterval(refresh, 3000);
    else {
      clearInterval(poll);
      poll = undefined;
    }
  }

  async function refresh() {
    await load().catch(() => {});
  }

  function select(update: UpdateSummary) {
    selectedId = update.id;
    title = { de: update.content.de.title, en: update.content.en.title };
    features = { de: update.content.de.features.join('\n'), en: update.content.en.features.join('\n') };
    image = undefined;
    confirming = false;
  }

  async function run(name: string, action: () => Promise<void>) {
    busy = name;
    try {
      await action();
    } catch {
      // The API client already shows the error as a toast
    } finally {
      busy = '';
    }
  }

  const create = () =>
    run('create', async () => {
      const empty = { title: '', features: [] };
      const { update } = await api.post<{ update: UpdateSummary }>('/updates', { content: { de: empty, en: empty } });
      list = [update, ...list];
      select(update);
    });

  // Actions keep the id they started with, the list stays locked while they run
  async function save(id: string) {
    const { update } = await api.put<{ update: UpdateSummary }>(`/updates/${id}`, { content, image });
    list = list.map((item) => (item.id === update.id ? update : item));
    image = undefined;
    previewKey++;
  }

  const saveDraft = () =>
    run('save', async () => {
      await save(selectedId!);
      toast(t().saved);
    });
  const testMail = () =>
    run('test', async () => {
      const id = selectedId!;
      if (!selected?.sentAt) await save(id);
      await api.post(`/updates/${id}/test`);
      toast(t().testSent(auth.user!.email));
    });
  const send = () =>
    run('send', async () => {
      const id = selectedId!;
      await save(id);
      await api.post(`/updates/${id}/send`);
      confirming = false;
      await load();
    });
  const remove = () =>
    run('delete', async () => {
      const id = selectedId!;
      await api.delete(`/updates/${id}`);
      list = list.filter((item) => item.id !== id);
      selectedId = null;
      if (list[0]) select(list[0]);
    });

  function pickImage(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      image = String(reader.result).split(',')[1];
    };
    reader.readAsDataURL(file);
  }

  onMount(() => {
    if (auth.user?.admin) refresh();
  });
  onDestroy(() => clearInterval(poll));
</script>

<h1>{t().updates}</h1>
{#if !auth.user?.admin}
  <p>{t().adminOnly}</p>
{:else}
  <p class="muted">{t().updatesIntro}</p>
  <div class="layout">
    <nav>
      <Button onclick={create} loading={busy === 'create'}>{t().newUpdate}</Button>
      {#each [[t().drafts, drafts], [t().sentUpdates, sent]] as const as [heading, items]}
        {#if items.length}
          <h3>{heading}</h3>
          {#each items as update (update.id)}
            <button type="button" class="item" class:on={update.id === selectedId}
              disabled={!!busy}
              onclick={() => select(update)}>
              <strong>{update.content[page.data.locale as Locale].title || t().untitled}</strong>
              <small>{update.sentAt ? date(update.sentAt) : update.slug ? t().fromFile(update.slug) : date(update.createdAt)}</small>
            </button>
          {/each}
        {/if}
      {/each}
      {#if !list.length}<p class="muted">{t().noUpdates}</p>{/if}
    </nav>

    {#if selected}
      <section>
        <div class="tabs" role="tablist">
          {#each [['de', t().languageDe], ['en', t().languageEn]] as const as [code, name]}
            <button type="button" role="tab" aria-selected={lang === code} class:on={lang === code} onclick={() => (lang = code)}>
              {name}
            </button>
          {/each}
        </div>

        {#if selected.sentAt}
          <p>{t().sentOn(date(selected.sentAt), selected.sent + selected.failed + selected.pending, selected.failed)}</p>
          {#if selected.pending}
            <progress max={selected.sent + selected.failed + selected.pending} value={selected.sent + selected.failed}></progress>
            <p class="muted">{t().sending(selected.sent + selected.failed, selected.sent + selected.failed + selected.pending, selected.failed)}</p>
          {/if}
          <p class="muted">{t().sentReadOnly}</p>
        {:else}
          <div class="form">
            <Input label={t().title} bind:value={title[lang]} />
            <label>
              <span>{t().features}</span>
              <textarea rows="5" bind:value={features[lang]}></textarea>
            </label>
            <div class="image">
              <span>{t().image}</span>
              {#if image === undefined ? selected.hasImage : image}
                <img
                  src={image ? `data:image/png;base64,${image}` : `/api/v1/updates/${selected.id}/image?v=${previewKey}`}
                  alt=""
                />
                <Button variant="secondary" onclick={() => (image = null)}>{t().removeImage}</Button>
              {:else}
                <input type="file" accept="image/png,image/jpeg" aria-label={t().chooseImage} onchange={pickImage} />
              {/if}
            </div>
          </div>
        {/if}

        <div class="actions">
          {#if !selected.sentAt}
            <Button variant="secondary" onclick={saveDraft} loading={busy === 'save'}>{t().save}</Button>
          {/if}
          <Button variant="secondary" onclick={testMail} loading={busy === 'test'}>{t().testMail}</Button>
          {#if !selected.sentAt}
            <Button variant="secondary" onclick={remove} loading={busy === 'delete'}>{t().deleteDraft}</Button>
            <span class="spacer"></span>
            <Button onclick={() => (confirming = true)} disabled={!updateComplete(content) || !subscribers}>
              {t().sendTo(subscribers)}
            </Button>
          {/if}
        </div>
        {#if !selected.sentAt && !updateComplete(content)}
          <p class="muted">{t().updateIncomplete}</p>
        {/if}
        {#if confirming}
          <div class="confirm">
            <strong>{t().confirmSend(subscribers)}</strong>
            <p>{t().confirmSendHint}</p>
            <Button onclick={send} loading={busy === 'send'}>{t().sendNow}</Button>
            <Button variant="secondary" onclick={() => (confirming = false)}>{t().cancel}</Button>
          </div>
        {/if}

        <h3>{t().preview}</h3>
        {#key `${selected.id}-${lang}-${previewKey}`}
          <iframe title={t().preview} src="/api/v1/updates/{selected.id}/preview?locale={lang}"></iframe>
        {/key}
      </section>
    {/if}
  </div>
{/if}

<style>
  .muted {
    color: var(--muted);
  }
  .layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
  }
  @media (max-width: 760px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  h3 {
    margin: 1rem 0 0.3rem;
    color: var(--muted);
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .item {
    display: flex;
    flex-direction: column;
    padding: 0.55rem 0.7rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .item.on {
    border-color: var(--border);
    background: var(--surface);
  }
  .item small {
    color: var(--muted);
  }
  section {
    padding: 1.1rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .tabs {
    display: flex;
    gap: 1.2rem;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    padding: 0.4rem 0;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }
  .tabs button.on {
    border-image: var(--gradient) 1;
    color: var(--text);
    font-weight: 600;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  label,
  .image {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: flex-start;
  }
  label span,
  .image span {
    font-size: 0.85rem;
    font-weight: 600;
  }
  textarea {
    width: 100%;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .image img {
    max-width: 240px;
    border-radius: var(--radius);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 1.2rem;
  }
  .spacer {
    flex: 1;
  }
  .confirm {
    margin-top: 1rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--needs);
    border-radius: 10px;
  }
  .confirm p {
    margin: 0.3rem 0 0.8rem;
    color: var(--muted);
  }
  progress {
    width: 100%;
    accent-color: var(--accent);
  }
  iframe {
    width: 100%;
    height: 900px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: #f4f4f1;
  }
</style>
