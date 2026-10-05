// Lives in a shadow root, so the prototype's CSS can't reach it and it can't reach the prototype.
// Product gradient and dark tile from DESIGN.md, band section 3.20–3.85.
export const styles = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --ink: #17171a; --muted: #5e5e66; --paper: #f4f4f1; --line: rgb(23 23 26 / 0.16); --tile: #121117;
  --gradient: linear-gradient(45deg, #d7c45b, #acc870, #80cd84); --accent: #4f6527; --warn: #b42318; --ok: #2d693b;
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); font-variant-numeric: tabular-nums;
}
button, input, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
h2, h3 { margin: 0; line-height: 1.25; }
h2 { font-size: 20px; }
h3 { font-size: 15px; }
p { margin: 0; }

.scrim { position: fixed; inset: 0; z-index: 2147483646; background: rgb(23 23 26 / 0.45); display: grid; place-items: end center; padding: 16px; }
@media (min-width: 700px) { .scrim { place-items: center; } }
.sheet { background: var(--paper); width: min(440px, 100%); border-radius: 18px; padding: 22px; display: flex; flex-direction: column; gap: 16px; max-height: calc(100vh - 32px); overflow: auto; }
.sheet > *, .panel > * { flex-shrink: 0; }
.muted { color: var(--muted); font-size: 14px; }
.fine { color: var(--muted); font-size: 12.5px; }
.rates { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; font-size: 14px; background: #fff; }
.rates div { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px; border-top: 1px solid var(--line); }
.rates div:first-child { border-top: 0; }
.rates .head { background: #ecece7; color: var(--muted); font-size: 13px; }
.trust { padding: 12px; border-radius: 12px; background: #e7efe2; font-size: 14px; }
.warn { padding: 10px 12px; border-radius: 12px; background: #fbe9e7; color: var(--warn); font-size: 13.5px; }
label.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); }
input, textarea { font-size: 15px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--ink); width: 100%; }
textarea { resize: vertical; min-height: 76px; }
.primary { border: 0; border-radius: 10px; padding: 12px 16px; background: var(--gradient); color: var(--ink); font-weight: 650; }
.ghost { border: 1px solid var(--line); border-radius: 10px; padding: 11px 14px; background: #fff; font-weight: 500; }
.link { border: 0; background: none; padding: 0; color: var(--accent); font-weight: 600; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
.btns { display: flex; gap: 8px; }
.btns > * { flex: 1; }
.error { color: var(--warn); font-size: 13.5px; }

.dock { position: fixed; right: 20px; bottom: 20px; z-index: 2147483645; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
@media (max-width: 600px) { .dock { right: 12px; left: 12px; bottom: 12px; align-items: center; } }
.pill { display: flex; align-items: center; gap: 12px; border: 0; background: var(--tile); color: #f2f0ea; border-radius: 999px; padding: 9px 16px 9px 10px; box-shadow: 0 6px 20px rgb(23 23 26 / 0.3); }
.bolt { width: 28px; height: 28px; border-radius: 50%; background: var(--gradient); color: var(--ink); display: grid; place-items: center; font-weight: 700; }
.pill .num { font-weight: 650; font-size: 16px; }
.pill .time { color: #9a98a3; font-size: 13px; }
.rec { width: 8px; height: 8px; border-radius: 50%; background: #f2545b; }
.pill.idle .rec { background: #9a98a3; }
.pill.flash .bolt { animation: zap 0.6s ease-out; }
@keyframes zap { from { box-shadow: 0 0 0 0 rgb(172 200 112 / 0.9); } to { box-shadow: 0 0 0 14px rgb(172 200 112 / 0); } }
@media (prefers-reduced-motion: reduce) { .pill.flash .bolt { animation: none; } }

.chips { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
@media (max-width: 600px) { .chips { align-items: center; } }
.chip { background: #fff; border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; font-size: 13px; box-shadow: 0 2px 8px rgb(23 23 26 / 0.12); }
.chip b { color: var(--accent); }
.chip.paid { background: #e7efe2; }

.panel { width: min(350px, calc(100vw - 24px)); max-height: calc(100vh - 110px); overflow: auto; background: var(--paper); border: 1px solid var(--line); border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 13px; box-shadow: 0 10px 30px rgb(23 23 26 / 0.2); }
.row { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.row span:first-child { color: var(--muted); }
.meter { height: 6px; background: #e3e3dd; border-radius: 3px; overflow: hidden; margin-top: 6px; }
.meter i { display: block; height: 100%; background: var(--gradient); }
.goals { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.goals li::before { content: '○'; margin-right: 8px; color: var(--muted); }
.goals li.done::before { content: '●'; color: var(--ok); }
.log { max-height: 170px; overflow: auto; display: flex; flex-direction: column; gap: 3px; font-size: 13px; border-top: 1px solid var(--line); padding-top: 8px; margin-top: 4px; }
.log div { display: grid; grid-template-columns: 44px 1fr; gap: 4px; }
.log time { color: var(--muted); }
.log .reward span, .log .paid span { color: var(--accent); }
.log .friction span, .log .error span { color: var(--warn); font-weight: 600; }
.log .feedback span { font-style: italic; }
.head-row { display: flex; justify-content: space-between; align-items: baseline; }

.prompt { width: min(330px, calc(100vw - 24px)); background: #fff; border: 2px solid #acc870; border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px; font-size: 14px; }
.seg { display: flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.seg button { flex: 1; border: 0; background: #fff; padding: 8px; font-size: 14px; }
.seg button[aria-pressed="true"] { background: var(--tile); color: #f2f0ea; }
.anchor { display: flex; justify-content: space-between; gap: 8px; align-items: center; font-size: 13px; background: #f6f1d9; border: 1px solid #e3d79a; border-radius: 8px; padding: 8px 10px; }
.list { display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
.list div { display: flex; justify-content: space-between; gap: 12px; border-top: 1px solid var(--line); padding-top: 8px; }
.list span { color: var(--muted); }
`;

// Outline for picking an element on the prototype. Lives outside the shadow root.
export const pickStyles = `
.fieldtest-picking, .fieldtest-picking * { cursor: crosshair !important; }
.fieldtest-picking *:hover { outline: 2px dashed #acc870 !important; outline-offset: 2px !important; }
.fieldtest-anchored { outline: 3px solid #acc870 !important; outline-offset: 2px !important; }
`;
