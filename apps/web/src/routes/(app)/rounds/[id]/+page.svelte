<script lang="ts">
  import { type ClaimStatus, type FindingStatus, SEVERITIES, type Severity } from '@app/shared';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import SeverityBadge from '$lib/components/Severity.svelte';
  import { clock, sats, t } from '$lib/i18n';
  import { loadRound } from '$lib/round.svelte';
  import { toast } from '$lib/toast.svelte';

  type Finding = {
    id: string;
    number: number;
    severity: Severity | null;
    status: FindingStatus;
    title: string;
    screen: string;
    summary: string;
    fix: string;
    reporters: number;
    sessions: number;
    firstReporter: string | null;
    createdAt: string;
  };
  type Detail = {
    finding: Finding;
    reports: { id: string; type: 'bug' | 'confusing' | 'idea'; text: string; label: string; screen: string; auto: string | null; tester: string; seconds: number }[];
    evidence: { kind: 'screen' | 'goal' | 'friction' | 'error'; label: string; screen: string; seconds: number }[];
    payouts: { id: string; kind: 'live' | 'finding' | 'confirm'; amount: number; status: ClaimStatus; tester: string }[];
  };

  const id = $derived(page.params.id!);
  let findings = $state<Finding[] | null>(null);
  let sort = $state<'impact' | 'new'>('impact');
  let selected = $state<string | null>(null);
  let detail = $state<Detail | null>(null);
  let showDetail = $state(false);
  let summary = $state('');
  let fix = $state('');
  let exporting = $state<'agent' | 'issue' | null>(null);

  const sorted = $derived(
    findings ? (sort === 'impact' ? findings : [...findings].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) : [],
  );

  async function loadList() {
    findings = (await api.get<{ findings: Finding[] }>(`/rounds/${id}/findings`)).findings;
    if (!selected || !findings.some((f) => f.id === selected)) selected = findings[0]?.id ?? null;
  }

  async function loadDetail(findingId: string) {
    const next = await api.get<Detail>(`/rounds/${id}/findings/${findingId}`);
    if (selected !== findingId) return;
    detail = next;
    summary = next.finding.summary;
    fix = next.finding.fix;
  }

  $effect(() => {
    loadList().catch(() => {});
  });
  $effect(() => {
    if (selected) loadDetail(selected).catch(() => {});
    else detail = null;
  });

  function open(findingId: string) {
    selected = findingId;
    showDetail = true;
    exporting = null;
  }

  async function update(changes: Record<string, string>, message = t().saved) {
    if (!detail) return;
    await api.patch(`/rounds/${id}/findings/${detail.finding.id}`, changes);
    toast(message);
    await Promise.all([loadList(), loadDetail(detail.finding.id), loadRound(id)]);
  }

  async function merge(e: Event) {
    const into = (e.currentTarget as HTMLSelectElement).value;
    if (!detail || !into) return;
    await api.post(`/rounds/${id}/findings/${detail.finding.id}/merge`, { into });
    toast(t().merged);
    selected = into;
    await Promise.all([loadList(), loadRound(id)]);
  }

  const steps = (d: Detail) =>
    d.evidence.map((e) => `- ${clock(e.seconds)} ${t().evidence[e.kind](e.label || e.screen)}`).join('\n');

  const exportText = $derived.by(() => {
    if (!detail || !exporting) return '';
    const f = detail.finding;
    const severity = f.severity ? t().severityNames[f.severity] : t().unrated;
    return exporting === 'agent'
      ? t().agentTask(f.title, summary || detail.reports[0]?.text || '', fix, steps(detail))
      : t().issueBody(f.title, severity, f.sessions, summary || detail.reports[0]?.text || '', fix);
  });

  async function copyExport() {
    await navigator.clipboard.writeText(exportText);
    toast(t().copied);
    if (detail?.finding.status === 'accepted') await update({ status: 'exported' }, t().copied);
    exporting = null;
  }
</script>

{#if findings && !findings.length}
  <p class="empty">{t().noFindings}</p>
{:else if findings}
  <div class="split" class:show-detail={showDetail}>
    <div class="list">
      <div class="list-head">
        <div class="sort">
          <button type="button" aria-pressed={sort === 'impact'} onclick={() => (sort = 'impact')}>{t().sortImpact}</button>
          <button type="button" aria-pressed={sort === 'new'} onclick={() => (sort = 'new')}>{t().sortNewest}</button>
        </div>
      </div>
      {#each sorted as f (f.id)}
        <button type="button" class="item" class:dismissed={f.status === 'dismissed'} aria-current={f.id === selected} onclick={() => open(f.id)}>
          <SeverityBadge severity={f.severity} />
          <span class="title">{f.title}<small>{f.screen ? `${f.screen}, ` : ''}{t().impact(f.reporters, f.sessions)}</small></span>
          <span class="state">{t().statusNames[f.status]}</span>
        </button>
      {/each}
    </div>

    {#if detail}
      {@const f = detail.finding}
      <article class="detail">
        <button type="button" class="back" onclick={() => (showDetail = false)}>{t().backToList}</button>
        <div class="meta">
          <span>F-{f.number}</span>
          <label>
            {t().severityLabel}
            <select value={f.severity ?? ''} onchange={(e) => update({ severity: e.currentTarget.value }, t().severitySaved)}>
              {#if !f.severity}<option value="">{t().unrated}</option>{/if}
              {#each SEVERITIES as s (s)}<option value={s}>{t().severityNames[s]}</option>{/each}
            </select>
          </label>
          {#if f.screen}<span>{f.screen}</span>{/if}
          {#if detail.reports[0]}<span>{t().firstReportedBy(detail.reports[0].tester)}</span>{/if}
        </div>
        <h2>{f.title}</h2>

        <section>
          <h3>{t().whatTestersSaid}</h3>
          <ul class="reports">
            {#each detail.reports as r (r.id)}
              <li>
                <p>{r.text}</p>
                <small>{t().feedbackTypes[r.type]}, {r.tester}, {clock(r.seconds)}{r.auto ? `, ${r.auto}` : ''}</small>
              </li>
            {/each}
          </ul>
        </section>

        {#if detail.evidence.length && detail.reports[0]}
          <section>
            <h3>{t().evidenceFrom(detail.reports[0].tester)}</h3>
            <ol class="timeline">
              {#each detail.evidence as e, i (i)}
                <li class={e.kind}><time>{clock(e.seconds)}</time><span>{t().evidence[e.kind](e.label || e.screen)}</span></li>
              {/each}
            </ol>
          </section>
        {/if}

        <section class="texts">
          <label>
            <span>{t().summaryLabel}</span>
            <textarea rows="3" bind:value={summary} placeholder={t().summaryPlaceholder}></textarea>
          </label>
          <label>
            <span>{t().fixLabel}</span>
            <textarea rows="3" bind:value={fix} placeholder={t().fixPlaceholder}></textarea>
          </label>
          {#if summary !== f.summary || fix !== f.fix}
            <div><Button variant="secondary" onclick={() => update({ summary, fix })}>{t().saveText}</Button></div>
          {/if}
        </section>

        <div class="actions">
          <Button onclick={() => (exporting = 'agent')}>{t().sendToAgent}</Button>
          <Button variant="secondary" onclick={() => (exporting = 'issue')}>{t().createIssue}</Button>
          {#if f.status === 'dismissed'}
            <Button variant="secondary" onclick={() => update({ status: f.severity ? 'accepted' : 'new' })}>{t().restore}</Button>
          {:else}
            <Button variant="secondary" onclick={() => update({ status: 'dismissed' })}>{t().dismiss}</Button>
          {/if}
          <select class="merge" aria-label={t().mergeInto} onchange={merge}>
            <option value="">{t().mergeInto} …</option>
            {#each findings.filter((x) => x.id !== f.id) as other (other.id)}
              <option value={other.id}>F-{other.number}: {other.title}</option>
            {/each}
          </select>
        </div>

        {#if exporting}
          <section class="export">
            <p>{exporting === 'agent' ? t().exportAgentHint : t().exportIssueHint}</p>
            <pre>{exportText}</pre>
            <div class="actions">
              <Button onclick={copyExport}>{t().copyText}</Button>
              <Button variant="secondary" onclick={() => (exporting = null)}>{t().cancel}</Button>
            </div>
          </section>
        {/if}

        <section>
          <h3>{t().payoutsForFinding}</h3>
          {#if detail.payouts.length}
            <table>
              <tbody>
                {#each detail.payouts as p (p.id)}
                  <tr>
                    <td>{p.tester}</td>
                    <td>{t().claimKinds[p.kind]}</td>
                    <td class="num">{sats(p.amount)}</td>
                    <td><span class="claim {p.status}">{t().claimStatuses[p.status]}</span></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="muted">{t().noPayoutsYet}</p>
          {/if}
        </section>
      </article>
    {/if}
  </div>
{/if}

<style>
  .empty {
    color: var(--muted);
  }
  .split {
    display: grid;
    grid-template-columns: minmax(300px, 40%) 1fr;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    overflow: hidden;
  }
  .list {
    max-height: calc(100dvh - 15rem);
    overflow: auto;
    border-right: 1px solid var(--border);
    background: var(--bg);
  }
  .list-head {
    position: sticky;
    top: 0;
    display: flex;
    justify-content: flex-end;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .sort {
    display: flex;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .sort button {
    padding: 0.3rem 0.7rem;
    border: 0;
    background: var(--surface);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .sort button[aria-pressed='true'] {
    background: var(--text);
    color: var(--bg);
  }
  .item {
    display: grid;
    grid-template-columns: 6.5rem 1fr auto;
    gap: 0.75rem;
    width: 100%;
    padding: 0.8rem 1rem;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .item:hover {
    background: rgb(23 23 26 / 0.04);
  }
  .item[aria-current='true'] {
    background: var(--surface);
    box-shadow: inset 3px 0 0 var(--text);
  }
  .item.dismissed {
    opacity: 0.55;
  }
  .title {
    font-weight: 500;
    line-height: 1.35;
  }
  .title small,
  .state {
    display: block;
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 400;
  }
  .detail {
    max-height: calc(100dvh - 15rem);
    overflow: auto;
    padding: 1.25rem 1.75rem 2rem;
  }
  .back {
    display: none;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: center;
    color: var(--muted);
    font-size: 0.9rem;
  }
  select {
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  h2 {
    max-width: 30ch;
    margin: 0.5rem 0 0;
    font-size: 1.6rem;
  }
  section {
    max-width: 68ch;
    margin-top: 1.5rem;
  }
  h3 {
    margin: 0 0 0.5rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .reports {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .reports li {
    padding: 0.5rem 0;
    border-top: 1px solid var(--border);
  }
  .reports li:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .reports p {
    margin: 0;
  }
  .reports small,
  .muted {
    color: var(--muted);
  }
  .timeline {
    margin: 0;
    padding: 0 0 0 0.75rem;
    border-left: 2px solid var(--border);
    list-style: none;
    font-size: 0.9rem;
  }
  .timeline li {
    display: grid;
    grid-template-columns: 3.5rem 1fr;
    padding: 0.15rem 0;
  }
  .timeline time {
    color: var(--muted);
  }
  .timeline .friction,
  .timeline .error {
    color: #b3262d;
    font-weight: 600;
  }
  .texts label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.75rem;
  }
  .texts span {
    color: var(--muted);
    font-size: 0.85rem;
    font-weight: 600;
  }
  textarea {
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    resize: vertical;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1.25rem;
  }
  .merge {
    height: 40px;
  }
  .export p {
    margin: 0;
    color: var(--muted);
  }
  pre {
    padding: 0.9rem 1rem;
    border-radius: var(--radius);
    background: #17171a;
    color: #f2f0ea;
    font-size: 0.82rem;
    white-space: pre-wrap;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  td {
    padding: 0.4rem 0.5rem 0.4rem 0;
    border-bottom: 1px solid var(--border);
  }
  .num {
    text-align: right;
  }
  .claim {
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: rgb(23 23 26 / 0.07);
    font-size: 0.8rem;
  }
  .claim.review {
    background: #f6ebc8;
  }
  .claim.paid {
    background: #dcebdf;
  }
  @media (max-width: 860px) {
    .split {
      grid-template-columns: 1fr;
    }
    .list,
    .detail {
      max-height: none;
      border-right: 0;
    }
    .detail {
      padding: 1rem;
    }
    .split.show-detail .list,
    .split:not(.show-detail) .detail {
      display: none;
    }
    .back {
      display: block;
      margin-bottom: 0.75rem;
      padding: 0;
      border: 0;
      background: none;
      color: var(--muted);
      font: inherit;
      cursor: pointer;
    }
  }
</style>
