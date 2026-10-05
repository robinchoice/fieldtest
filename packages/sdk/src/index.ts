// Fieldtest tester overlay. Owners embed it once:
//   <script src="https://<fieldtest>/api/v1/sdk/overlay.js" async></script>
// It stays invisible until a tester opens the prototype through an invite link
// (?fieldtest=<invite>). Prototypes without page URLs can name their screens
// and goals: Fieldtest.screen('Backup'), Fieldtest.goal('Back up your wallet').
import { type Locale, messages } from './messages';
import { pickStyles, styles } from './styles';

type Rewards = {
  minute: number;
  screen: number;
  goal: number;
  cap: number;
  cosmetic: number;
  blocker: number;
  idea: number;
  scale: number;
};
type Invitation = {
  product: string;
  name: string;
  owner: string;
  goals: string[];
  rewards: Rewards;
  paid: number;
  payouts: number;
  medianSeconds: number | null;
  runnerOnline: boolean;
};
type LogEntry = { kind: string; label: string; screen: string; sats: number; at: number };
type State = {
  activeSeconds: number;
  liveSats: number;
  cap: number;
  paidSats: number;
  pendingSats: number;
  goals: { goal: string; reached: boolean }[];
  feedback: number;
  ended: boolean;
  log: LogEntry[];
};
type Anchor = { label: string; screen: string; auto?: string };
type Event = { kind: 'screen' | 'goal' | 'friction' | 'error'; label: string; screen: string };

const STORE = 'fieldtest';
const WINDOW_MS = 10_000;
const IDLE_MS = 8_000;
const script = document.currentScript as HTMLScriptElement | null;
const API = `${new URL(script?.src ?? location.href).origin}/api/v1/sdk`;

let locale: Locale =
  (localStorage.getItem('fieldtest-locale') as Locale | null) ?? (navigator.language.startsWith('de') ? 'de' : 'en');
let m = messages[locale];

const saved: { invite?: string; token?: string } = JSON.parse(sessionStorage.getItem(STORE) || '{}');
const invite = new URLSearchParams(location.search).get('fieldtest');
if (invite) {
  if (invite !== saved.invite) delete saved.token;
  saved.invite = invite;
  sessionStorage.setItem(STORE, JSON.stringify(saved));
  const url = new URL(location.href);
  url.searchParams.delete('fieldtest');
  history.replaceState(history.state, '', url);
}

const ui = {
  phase: 'off' as 'off' | 'invite' | 'testing' | 'summary',
  invitation: null as Invitation | null,
  state: null as State | null,
  open: false,
  composing: false,
  type: 'bug' as 'bug' | 'confusing' | 'idea',
  prompt: null as Anchor | null,
  anchor: null as Anchor | null,
  picking: false,
  chips: [] as { id: number; html: string; paid: boolean }[],
  flash: false,
  idle: false,
  busy: false,
  error: '',
  lightningAddress: localStorage.getItem('fieldtest-ln') ?? '',
  draft: '',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const fmt = (n: number) => n.toLocaleString(locale === 'de' ? 'de-DE' : 'en-US');
const clock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
const scaled = (r: Rewards, sats: number) => Math.round((sats * r.scale) / 100);

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'accept-language': locale };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (saved.token) headers.authorization = `Bearer ${saved.token}`;
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && saved.token) stop();
  if (!res.ok) throw new Error(data.error || m.failed);
  return data as T;
}

function stop() {
  sessionStorage.removeItem(STORE);
  saved.token = undefined;
  saved.invite = undefined;
  ui.phase = 'off';
  render();
}

// Shadow root, so neither side's CSS leaks into the other
const host = document.createElement('fieldtest-overlay');
const shadow = host.attachShadow({ mode: 'open' });
const fromOverlay = (e: globalThis.Event) => e.composedPath().includes(host);

// What the tester did, collected for the next report

let inputs = 0;
let lastInput = Date.now();
let mutations = 0;
let errors = 0;
let customScreen: string | null = null;
let screen = '';
const queue: Event[] = [];

const urlScreen = () => location.pathname + location.hash;
const describe = (el: Element) =>
  (
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    el.textContent?.trim().replace(/\s+/g, ' ') ||
    (el as HTMLInputElement).placeholder ||
    el.tagName.toLowerCase()
  ).slice(0, 80);

function checkScreen() {
  const next = customScreen ?? urlScreen();
  if (next === screen) return;
  screen = next;
  queue.push({ kind: 'screen', screen, label: customScreen ?? (document.title || screen) });
  soon();
}

let lastUrl = urlScreen();
setInterval(() => {
  if (urlScreen() !== lastUrl) {
    lastUrl = urlScreen();
    customScreen = null;
  }
  if (ui.phase === 'testing') checkScreen();
  const idle = Date.now() - lastInput > IDLE_MS;
  if (idle !== ui.idle) {
    ui.idle = idle;
    render();
  }
}, 1000);

for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
  addEventListener(
    type,
    (e) => {
      if (fromOverlay(e)) return;
      inputs++;
      lastInput = Date.now();
    },
    { capture: true, passive: true },
  );
}

new MutationObserver(() => mutations++).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true,
});

// Three clicks on the same element within 1.5 s while the page doesn't change count as being stuck
let clicks: { el: Element; at: number; mutations: number }[] = [];
const prompted = new WeakSet<Element>();
addEventListener(
  'click',
  (e) => {
    if (fromOverlay(e) || ui.phase !== 'testing') return;
    const target = e.target as Element;
    if (ui.picking) {
      e.preventDefault();
      e.stopPropagation();
      pick(target);
      return;
    }
    const el = target.closest('button, a, [role="button"], input, select, label, summary') ?? target;
    const now = Date.now();
    clicks = clicks.filter((c) => c.el === el && now - c.at < 1500).concat({ el, at: now, mutations });
    if (clicks.length >= 3 && clicks[0]!.mutations === mutations && !prompted.has(el)) {
      prompted.add(el);
      const label = describe(el);
      queue.push({ kind: 'friction', label, screen });
      ui.prompt = { label, screen, auto: m.autoTaps };
      soon();
      render();
    }
  },
  true,
);

addEventListener('error', (e) => reportError(e.message));
addEventListener('unhandledrejection', (e) => reportError(String(e.reason)));
function reportError(message: string) {
  if (ui.phase !== 'testing' || errors++ >= 5) return;
  queue.push({ kind: 'error', label: message.slice(0, 300), screen });
  soon();
}

function pick(el: Element) {
  document.documentElement.classList.remove('fieldtest-picking');
  for (const old of document.querySelectorAll('.fieldtest-anchored')) old.classList.remove('fieldtest-anchored');
  el.classList.add('fieldtest-anchored');
  ui.picking = false;
  ui.anchor = { label: describe(el), screen };
  render();
}

// One report per 10-second window says whether the tester was active, events go along

let flushing = false;
let soonTimer: ReturnType<typeof setTimeout> | undefined;
function soon() {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => flush(0), 1500);
}

async function flush(active: 0 | 1) {
  if (ui.phase !== 'testing' || flushing) return;
  flushing = true;
  const events = queue.splice(0, 50);
  try {
    update(await call<State>('POST', '/session/events', { active, events }));
  } catch {
    queue.unshift(...events);
  } finally {
    flushing = false;
  }
}

setInterval(() => {
  const active = inputs >= 3 && document.visibilityState === 'visible' ? 1 : 0;
  inputs = 0;
  flush(active);
}, WINDOW_MS);

// New rewards and payments since the last state show up as chips
const seen = new Set<string>();
const entryKey = (e: LogEntry) => `${e.kind}|${e.at}|${e.label}|${e.sats}`;

function update(state: State) {
  const first = !ui.state;
  for (const entry of state.log) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    if (first) continue;
    if (entry.kind === 'paid') chip(esc(m.paidChip(fmt(entry.sats))), true);
    else if (entry.sats > 0) chip(`<b>+${fmt(entry.sats)}</b> ${esc(logText(entry))}`, false);
  }
  if (ui.state && state.liveSats >= state.cap && ui.state.liveSats < state.cap) chip(esc(m.capReached), false);
  ui.state = state;
  render();
}

function chip(html: string, paid: boolean) {
  const id = Math.random();
  ui.chips.push({ id, html, paid });
  ui.flash = true;
  setTimeout(() => {
    ui.chips = ui.chips.filter((c) => c.id !== id);
    render();
  }, 2800);
}

function logText(e: LogEntry) {
  const l = m.log;
  if (e.kind === 'minute') return l.minute;
  if (e.kind === 'paid') return l.paid(e.label);
  const fn = { screen: l.screen, goal: l.goal, friction: l.friction, error: l.error, feedback: l.feedback }[e.kind];
  return fn ? fn(e.label || e.screen) : e.label;
}

// Views

const languageButton = () => `<button class="link" data-act="lang">${m.otherLanguage}</button>`;

function inviteView(i: Invitation) {
  const r = i.rewards;
  const trust = i.payouts ? m.trustPaid(i.owner, i.paid, i.payouts, i.medianSeconds) : m.trustNew(i.owner);
  return `<div class="scrim"><div class="sheet" role="dialog" aria-labelledby="ft-h">
    <div class="head-row"><span class="muted">${esc(m.invites(i.owner))}</span>${languageButton()}</div>
    <h2 id="ft-h">${esc(i.product)}: ${esc(i.name)}</h2>
    <p class="muted">${esc(m.explore(i.goals.join(', ')))}</p>
    <div class="rates">
      <div class="head"><span>${m.liveHead}</span><span>${m.upTo(fmt(r.cap))}</span></div>
      <div><span>${m.perMinute}</span><strong>${m.sats(fmt(scaled(r, r.minute)))}</strong></div>
      <div><span>${m.perScreen}</span><strong>${m.sats(fmt(scaled(r, r.screen)))}</strong></div>
      ${i.goals.length ? `<div><span>${m.perGoal}</span><strong>${m.sats(fmt(scaled(r, r.goal)))}</strong></div>` : ''}
      <div class="head"><span>${m.reviewHead}</span><span></span></div>
      <div><span>${m.perFinding}</span><strong>${m.sats(`${fmt(scaled(r, r.cosmetic))}–${fmt(scaled(r, r.blocker))}`)}</strong></div>
      <div><span>${m.perIdea}</span><strong>${m.sats(fmt(scaled(r, r.idea)))}</strong></div>
    </div>
    <p class="trust">${esc(trust)}</p>
    ${i.runnerOnline ? '' : `<p class="warn">${m.runnerOffline}</p>`}
    <label class="field">${m.lightningAddress}<input data-keep="ln" type="email" autocomplete="email" value="${esc(ui.lightningAddress)}" placeholder="name@wallet.com"></label>
    <p class="fine">${m.recording}</p>
    ${ui.error ? `<p class="error" role="alert">${esc(ui.error)}</p>` : ''}
    <button class="primary" data-act="start" ${ui.busy ? 'disabled' : ''}>${m.start}</button>
  </div></div>`;
}

function pillView(s: State) {
  return `<button class="pill ${ui.idle ? 'idle' : ''} ${ui.flash ? 'flash' : ''}" data-act="toggle" aria-expanded="${ui.open}">
    <span class="bolt" aria-hidden="true">⚡</span><span class="num">${m.sats(fmt(s.paidSats + s.pendingSats))}</span>
    <span class="time">${ui.idle ? m.idle : clock(s.activeSeconds)}</span><span class="rec" title="REC"></span></button>`;
}

function panelView(s: State) {
  const recent = s.log.slice().reverse();
  return `<div class="panel" role="dialog" aria-label="${m.thisSession}">
    <div class="head-row"><h3>${m.thisSession}</h3>${languageButton()}</div>
    <div><div class="row"><span>${m.liveRewards}</span><strong>${m.ofCap(fmt(s.liveSats), fmt(s.cap))}</strong></div>
      <div class="meter"><i style="width:${Math.min(100, (s.liveSats / Math.max(1, s.cap)) * 100)}%"></i></div></div>
    <div class="row"><span>${m.paidTo}</span><strong>${m.sats(fmt(s.paidSats))}</strong></div>
    <div class="row"><span>${m.inReview}</span><strong>${s.feedback}</strong></div>
    ${s.goals.length ? `<ul class="goals">${s.goals.map((g) => `<li class="${g.reached ? 'done' : ''}">${esc(g.goal)}</li>`).join('')}</ul>` : ''}
    <div><div class="row"><span>${m.recorded}</span></div>
      <div class="log">${recent
        .map(
          (e) =>
            `<div class="${e.sats > 0 && e.kind !== 'paid' ? 'reward' : e.kind}"><time>${clock(e.at)}</time><span>${esc(logText(e))}</span></div>`,
        )
        .join('')}</div></div>
    <div class="btns"><button class="primary" data-act="compose">${m.report}</button><button class="ghost" data-act="end">${m.end}</button></div>
  </div>`;
}

function promptView(p: Anchor) {
  const r = ui.invitation?.rewards;
  const range = r ? `${fmt(scaled(r, r.cosmetic))}–${fmt(scaled(r, r.blocker))}` : '';
  return `<div class="prompt" role="alertdialog"><strong>${esc(m.stuck(p.label))}</strong><span>${esc(m.stuckBody(range))}</span>
    <div class="btns"><button class="primary" data-act="prompt-yes">${m.reportIt}</button><button class="ghost" data-act="prompt-no">${m.notNow}</button></div></div>`;
}

function composerView() {
  const a = ui.anchor;
  const types = (['bug', 'confusing', 'idea'] as const)
    .map((t) => `<button data-type="${t}" aria-pressed="${ui.type === t}">${m.types[t]}</button>`)
    .join('');
  const anchor = ui.picking
    ? `<div class="anchor"><span>${m.pointHint}</span></div>`
    : a
      ? `<div class="anchor"><span>${esc(m.anchorText(a.label, a.screen))}${a.auto ? `<br>${esc(a.auto)}` : ''}</span><button class="link" data-act="pick">${m.change}</button></div>`
      : `<div class="anchor"><span>${m.wholeScreen}</span><button class="link" data-act="pick">${m.pointAt}</button></div>`;
  return `<div class="panel" role="dialog" aria-label="${m.report}">
    <h3>${m.report}</h3>
    <div class="seg" role="group">${types}</div>
    ${anchor}
    <label class="field">${m.question}<textarea data-keep="draft" rows="3">${esc(ui.draft)}</textarea></label>
    <p class="fine">${m.reviewNote}</p>
    ${ui.error ? `<p class="error" role="alert">${esc(ui.error)}</p>` : ''}
    <div class="btns"><button class="primary" data-act="send" ${ui.busy ? 'disabled' : ''}>${m.send}</button><button class="ghost" data-act="cancel">${m.cancel}</button></div>
  </div>`;
}

function summaryView(s: State) {
  return `<div class="scrim"><div class="sheet" role="dialog" aria-labelledby="ft-sum">
    <h2 id="ft-sum">${m.thanks}</h2>
    <div class="list">
      <div><span>${m.activeTime}</span><strong>${clock(s.activeSeconds)}</strong></div>
      <div><span>${m.paidWhileTesting}</span><strong>${m.sats(fmt(s.paidSats))}</strong></div>
      <div><span>${m.pending}</span><strong>${m.sats(fmt(s.pendingSats))}</strong></div>
      <div><span>${m.inReview}</span><strong>${s.feedback}</strong></div>
    </div>
    <p class="fine">${m.thanksNote}</p>
    <button class="primary" data-act="close">${m.close}</button>
  </div></div>`;
}

function render() {
  const s = ui.state;
  let html = '';
  if (ui.phase === 'invite' && ui.invitation) html = inviteView(ui.invitation);
  if (ui.phase === 'summary' && s) html = summaryView(s);
  if (ui.phase === 'testing' && s) {
    html = `<div class="dock">
      <div class="chips" aria-live="polite">${ui.chips.map((c) => `<div class="chip ${c.paid ? 'paid' : ''}">${c.html}</div>`).join('')}</div>
      ${ui.prompt && !ui.composing ? promptView(ui.prompt) : ''}
      ${ui.composing ? composerView() : ui.open ? panelView(s) : ''}
      ${pillView(s)}
    </div>`;
  }
  // Keep focus and cursor of the field being typed in across renders
  const focused = shadow.activeElement as HTMLInputElement | null;
  const keep = focused?.dataset.keep;
  const selection = keep ? ([focused!.selectionStart, focused!.selectionEnd] as const) : null;
  shadow.innerHTML = `<style>${styles}</style><div class="root">${html}</div>`;
  if (keep) {
    const el = shadow.querySelector<HTMLInputElement>(`[data-keep="${keep}"]`);
    el?.focus();
    if (el && selection && selection[0] !== null) el.setSelectionRange(selection[0], selection[1]);
  }
  ui.flash = false;
}

shadow.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.keep === 'ln') ui.lightningAddress = el.value;
  if (el.dataset.keep === 'draft') ui.draft = el.value;
});

shadow.addEventListener('click', async (e) => {
  const button = (e.target as Element).closest('button');
  if (!button) return;
  const type = button.dataset.type as typeof ui.type | undefined;
  if (type) {
    ui.type = type;
    render();
    return;
  }
  const act = button.dataset.act;
  ui.error = '';
  if (act === 'lang') {
    locale = locale === 'de' ? 'en' : 'de';
    m = messages[locale];
    localStorage.setItem('fieldtest-locale', locale);
  } else if (act === 'start') {
    await start();
  } else if (act === 'toggle') {
    ui.open = !ui.open;
  } else if (act === 'compose') {
    ui.composing = true;
    ui.open = false;
  } else if (act === 'prompt-yes') {
    ui.anchor = ui.prompt;
    ui.prompt = null;
    ui.type = 'bug';
    ui.composing = true;
  } else if (act === 'prompt-no') {
    ui.prompt = null;
  } else if (act === 'pick') {
    ui.picking = true;
    document.documentElement.classList.add('fieldtest-picking');
  } else if (act === 'cancel') {
    ui.composing = false;
    ui.anchor = null;
  } else if (act === 'send') {
    await send();
  } else if (act === 'end') {
    await end();
  } else if (act === 'close') {
    ui.phase = 'off';
    host.remove();
  }
  render();
});

async function start() {
  ui.busy = true;
  render();
  try {
    const result = await call<{ token: string; state: State }>('POST', '/sessions', {
      invite: saved.invite,
      lightningAddress: ui.lightningAddress,
    });
    saved.token = result.token;
    sessionStorage.setItem(STORE, JSON.stringify(saved));
    localStorage.setItem('fieldtest-ln', ui.lightningAddress);
    update(result.state);
    ui.phase = 'testing';
    lastInput = Date.now();
    checkScreen();
  } catch (err) {
    ui.error = (err as Error).message;
  } finally {
    ui.busy = false;
  }
}

async function send() {
  const anchor = ui.anchor ?? { label: document.title || screen, screen };
  ui.busy = true;
  render();
  // Events first, so the log shows the friction before the report about it
  await flush(0);
  try {
    update(await call<State>('POST', '/session/feedback', { type: ui.type, text: ui.draft, anchor }));
    ui.composing = false;
    ui.anchor = null;
    ui.draft = '';
    for (const old of document.querySelectorAll('.fieldtest-anchored')) old.classList.remove('fieldtest-anchored');
    chip(esc(m.sent), false);
  } catch (err) {
    ui.error = (err as Error).message;
  } finally {
    ui.busy = false;
  }
}

async function end() {
  await flush(0);
  try {
    ui.state = await call<State>('POST', '/session/end');
  } catch {
    // Show what we have, the server stops counting after three hours anyway
  }
  sessionStorage.removeItem(STORE);
  saved.token = undefined;
  ui.phase = 'summary';
}

// For prototypes whose screens don't have their own URL
const api = {
  screen(name: string) {
    customScreen = String(name).slice(0, 200);
    if (ui.phase === 'testing') checkScreen();
  },
  goal(name: string) {
    if (ui.phase !== 'testing') return;
    queue.push({ kind: 'goal', label: String(name).slice(0, 300), screen });
    soon();
  },
};
(window as unknown as { Fieldtest: typeof api }).Fieldtest = api;

async function boot() {
  if (!saved.invite && !saved.token) return;
  const style = document.createElement('style');
  style.textContent = pickStyles;
  document.head.append(style);
  document.body.append(host);
  try {
    if (saved.invite) ui.invitation = await call<Invitation>('GET', `/rounds/${encodeURIComponent(saved.invite)}`);
    if (saved.token) {
      update(await call<State>('GET', '/session'));
      ui.phase = 'testing';
      screen = customScreen ?? urlScreen();
    } else {
      ui.phase = 'invite';
    }
  } catch {
    stop();
  }
  render();
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
else boot();
