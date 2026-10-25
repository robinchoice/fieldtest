<script lang="ts">
  import { tick } from 'svelte';
  import { z } from 'zod';
  import { auth } from '$lib/auth.svelte';
  import Button from '$lib/components/Button.svelte';
  import {
    closeFeedback,
    feedback,
    markScreenshot,
    openFeedback,
    type Rect,
    sendFeedback,
    takeScreenshot,
    testMode,
  } from '$lib/feedback.svelte';
  import { t } from '$lib/i18n';
  import { toast } from '$lib/toast.svelte';

  const SIZE = 44;
  const STORAGE_KEY = 'feedback-button';
  // zod's numbers are finite
  const positionSchema = z.object({ x: z.number(), y: z.number() });

  function savedPosition() {
    try {
      return positionSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).data ?? null;
    } catch {
      return null;
    }
  }

  let width = $state(0);
  let height = $state(0);
  let saved = $state<{ x: number; y: number } | null>(savedPosition());
  let capturing = $state(false);
  let flash = $state(false);
  let message = $state('');
  let sending = $state(false);
  let marking = $state(false);
  let textarea = $state<HTMLTextAreaElement>();

  // Stays on screen when the window shrinks
  const x = $derived(Math.min(Math.max(0, saved?.x ?? width - SIZE - 16), width - SIZE));
  const y = $derived(Math.min(Math.max(0, saved?.y ?? height * 0.62), height - SIZE));

  let drag: { startX: number; startY: number; x: number; y: number; moved: boolean } | null = null;

  function down(e: PointerEvent) {
    drag = { startX: e.clientX, startY: e.clientY, x, y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) saved = { x: drag.x + dx, y: drag.y + dy };
  }

  function up() {
    if (drag?.moved) localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y }));
    else if (drag) report();
    drag = null;
  }

  // The screenshot is taken before the panel opens, so it shows the problem.
  async function report() {
    capturing = true;
    const screenshot = await takeScreenshot().catch(() => null);
    flash = true;
    setTimeout(() => (flash = false), 350);
    openFeedback('bug', screenshot);
    capturing = false;
  }

  $effect(() => {
    if (!feedback.kind) return;
    message = '';
    tick().then(() => textarea?.focus());
  });

  async function send(e: SubmitEvent) {
    e.preventDefault();
    sending = true;
    try {
      await sendFeedback(message.trim());
      closeFeedback();
      toast(t().feedbackThanks);
    } catch {
      // The API client already shows the error as a toast
    } finally {
      sending = false;
    }
  }

  // Marking: a frame dragged over the screenshot, relative to the image
  let rect = $state<Rect | null>(null);
  let markImage = $state<HTMLImageElement>();
  let markStart: { x: number; y: number } | null = null;

  function relative(e: PointerEvent) {
    const box = markImage!.getBoundingClientRect();
    return {
      x: Math.min(Math.max(0, (e.clientX - box.left) / box.width), 1),
      y: Math.min(Math.max(0, (e.clientY - box.top) / box.height), 1),
    };
  }

  function markDown(e: PointerEvent) {
    markStart = relative(e);
    rect = null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function markMove(e: PointerEvent) {
    if (!markStart) return;
    const p = relative(e);
    rect = {
      x: Math.min(p.x, markStart.x),
      y: Math.min(p.y, markStart.y),
      width: Math.abs(p.x - markStart.x),
      height: Math.abs(p.y - markStart.y),
    };
  }

  function markUp() {
    markStart = null;
    if (rect && (rect.width < 0.01 || rect.height < 0.01)) rect = null;
  }

  async function finishMark() {
    feedback.screenshot = await markScreenshot(feedback.screenshot!, rect!);
    marking = false;
    rect = null;
  }

  function keydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (marking) marking = false;
    else if (feedback.kind) closeFeedback();
  }

  const contextRows = $derived(
    feedback.context
      ? [
          [t().contextPage, feedback.context.page],
          [t().contextDevice, feedback.context.device],
          [t().contextWindow, feedback.context.viewport],
          [t().contextLanguage, feedback.context.locale],
          [t().contextErrors, feedback.context.errors.join(', ') || '–'],
        ]
      : [],
  );
</script>

<svelte:window bind:innerWidth={width} bind:innerHeight={height} onkeydown={keydown} />

{#if auth.user && testMode.on && !feedback.kind && !capturing && width}
  <button
    type="button"
    class="bug"
    data-feedback-ignore
    style:left="{x}px"
    style:top="{y}px"
    aria-label={t().reportBug}
    title={t().reportBug}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 7.1V6a3 3 0 1 1 6 0v1.1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z" />
      <path d="M12 20v-9M6 13H2M22 13h-4M6.5 9C4.6 8.8 3 7.1 3 5M21 5c0 2.1-1.6 3.8-3.5 4M3 21c0-2.1 1.7-3.9 3.8-4M21 21c0-2.1-1.7-3.9-3.8-4" />
    </svg>
  </button>
{/if}

{#if flash}<div class="flash" data-feedback-ignore></div>{/if}

{#if feedback.kind && auth.user}
  <button type="button" class="scrim" data-feedback-ignore tabindex="-1" aria-label={t().close} onclick={closeFeedback}
  ></button>
  <div class="panel" data-feedback-ignore role="dialog" aria-modal="true" aria-labelledby="feedback-title">
    <button type="button" class="close" aria-label={t().close} onclick={closeFeedback}>×</button>
    <h2 id="feedback-title">{feedback.kind === 'bug' ? t().reportBug : t().giveFeedback}</h2>
    <form onsubmit={send}>
      <textarea
        bind:this={textarea}
        bind:value={message}
        aria-labelledby="feedback-title"
        placeholder={feedback.kind === 'bug' ? t().bugPlaceholder : t().ideaPlaceholder}
        maxlength="5000"
      ></textarea>
      {#if feedback.screenshot}
        <img class="shot" src={feedback.screenshot} alt="Screenshot" />
        <div class="links">
          <button type="button" onclick={() => (feedback.screenshot = null)}>{t().removeScreenshot}</button>
          <span aria-hidden="true">·</span>
          <button type="button" onclick={() => (marking = true)}>{t().markSpot}</button>
        </div>
      {/if}
      <details>
        <summary>{t().sentAlong}</summary>
        <dl>
          {#each contextRows as [label, value] (label)}
            <dt>{label}</dt>
            <dd>{value}</dd>
          {/each}
        </dl>
      </details>
      <p class="hint">{t().repliesTo(auth.user.email)}</p>
      <Button type="submit" loading={sending} disabled={message.trim().length < 5}>{t().send}</Button>
    </form>
  </div>
{/if}

{#if marking && feedback.screenshot}
  <div class="mark" data-feedback-ignore>
    <div class="toolbar">
      <span>{t().markHint}</span>
      <Button variant="secondary" onclick={() => (marking = false)}>{t().cancel}</Button>
      <Button disabled={!rect} onclick={finishMark}>{t().done}</Button>
    </div>
    <div
      class="canvas"
      role="presentation"
      onpointerdown={markDown}
      onpointermove={markMove}
      onpointerup={markUp}
    >
      <img bind:this={markImage} src={feedback.screenshot} alt="Screenshot" draggable="false" />
      {#if rect && markImage}
        <div
          class="frame"
          style:left="{markImage.offsetLeft + rect.x * markImage.width}px"
          style:top="{markImage.offsetTop + rect.y * markImage.height}px"
          style:width="{rect.width * markImage.width}px"
          style:height="{rect.height * markImage.height}px"
        ></div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .bug {
    position: fixed;
    z-index: 40;
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 3px solid transparent;
    border-radius: 50%;
    background: linear-gradient(var(--text), var(--text)) padding-box, var(--gradient) border-box;
    box-shadow: 0 3px 12px rgb(0 0 0 / 0.25);
    color: var(--bg);
    cursor: grab;
    opacity: 0.9;
    touch-action: none;
  }
  .bug:hover {
    opacity: 1;
  }
  .bug svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .flash {
    position: fixed;
    z-index: 60;
    inset: 0;
    background: #fff;
    pointer-events: none;
    animation: flash 0.35s ease-out forwards;
  }
  @keyframes flash {
    from {
      opacity: 0.7;
    }
    to {
      opacity: 0;
    }
  }
  .scrim {
    position: fixed;
    z-index: 40;
    inset: 0;
    padding: 0;
    border: none;
    background: rgb(14 13 18 / 0.35);
    cursor: default;
  }
  .panel {
    position: fixed;
    z-index: 41;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    width: min(420px, 100%);
    flex-direction: column;
    gap: 0.8rem;
    padding: 1.25rem 1.5rem;
    overflow: auto;
    background: var(--surface);
    box-shadow: -8px 0 30px rgb(0 0 0 / 0.15);
  }
  @media (max-width: 640px) {
    .panel {
      top: auto;
      left: 0;
      width: auto;
      max-height: 90dvh;
      border-radius: 20px 20px 0 0;
    }
  }
  h2 {
    margin: 0;
    font-size: 1.5rem;
  }
  .close {
    position: absolute;
    top: 0.75rem;
    right: 1rem;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 1.5rem;
    cursor: pointer;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  textarea {
    min-height: 130px;
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
  .shot {
    max-height: 220px;
    border: 1px solid var(--border);
    border-radius: 10px;
    object-fit: contain;
    object-position: left top;
  }
  .links {
    display: flex;
    gap: 0.5rem;
    color: var(--muted);
    font-size: 0.875rem;
  }
  .links button {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }
  details {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 0.85rem;
  }
  summary {
    cursor: pointer;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2rem 0.8rem;
    margin: 0.5rem 0 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    word-break: break-word;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .mark {
    position: fixed;
    z-index: 50;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: rgb(14 13 18 / 0.85);
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    justify-content: center;
    padding: 0.75rem 1rem;
    color: #f2f0ea;
  }
  .canvas {
    position: relative;
    display: grid;
    flex: 1;
    min-height: 0;
    padding: 0 1rem 1rem;
    place-items: center;
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }
  .canvas img {
    max-width: 100%;
    max-height: 100%;
    border-radius: 6px;
  }
  .frame {
    position: absolute;
    border: 3px solid #f2545b;
    border-radius: 4px;
    pointer-events: none;
  }
</style>
