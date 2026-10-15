/**
 * The bookmarklet: runs Sightline inside whatever page is open and shows the
 * outline in a panel that follows the page as it changes. Everything stays in
 * the page. Running it again closes the panel.
 */
import { createSightline, type Outline } from '../../src/index.js';
import { focusRow, renderOutline, roveRefs } from './outline-view.js';

const KEY = '__sightlinePanel';
const SKIP = '[data-sightline-panel]';

const CSS = `
:host { all: initial; }
.panel {
  position: fixed; top: 12px; right: 12px; z-index: 2147483647;
  display: flex; flex-direction: column;
  width: min(460px, calc(100vw - 24px)); height: min(72vh, 700px);
  background: #fffdfa; color: #16130f; border: 1px solid #d6cfc4; border-radius: 14px;
  box-shadow: 0 2px 4px rgba(22,19,15,.06), 0 24px 48px -18px rgba(22,19,15,.35);
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  overflow: hidden;
}
.panel.left { right: auto; left: 12px; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 14px; border-bottom: 1px solid #e7e2da; }
.mark { width: 20px; height: 20px; flex: none; }
.mark rect { fill: #ff6200; } .mark path { fill: none; stroke: #fff; stroke-width: 2.2; } .mark circle { fill: #fff; }
strong { font-weight: 650; font-size: 14px; letter-spacing: -0.01em; }
.live { display: inline-flex; align-items: center; gap: 5px; margin-right: auto; color: #6f675c; font-size: 12px; }
.live::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #2f9e44; }
label { display: inline-flex; align-items: center; gap: 6px; color: #4a443c; cursor: pointer; user-select: none; }
input { accent-color: #ff6200; margin: 0; }
button { font: inherit; color: inherit; cursor: pointer; }
.tool { border: 1px solid #e7e2da; background: #fff; border-radius: 8px; padding: 3px 9px; color: #4a443c; }
.tool:hover { border-color: #d6cfc4; color: #16130f; }
.icon { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; }
.icon svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
.meta { margin: 0; padding: 7px 14px; border-bottom: 1px solid #e7e2da; color: #6f675c; font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
pre { flex: 1; margin: 0; padding: 8px 0; overflow: auto; font: 12px/1.6 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; scrollbar-width: thin; scrollbar-color: #d6cfc4 transparent; }
.line { display: block; width: 100%; box-sizing: border-box; margin: 0; padding: 0 14px 0 calc(14px + var(--indent, 0ch)); border: 0; background: none; text-align: left; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; text-indent: 0; }
button.line:hover { background: #fff1e6; }
button.line:focus-visible { outline: 2px solid #ff6200; outline-offset: -2px; }
.added { animation: changed 2.4s ease-out; }
@keyframes changed { from { background: #ffe1c7; } to { background: transparent; } }
.t-role { color: #16130f; font-weight: 600; }
.t-name { color: #3b3630; }
.t-state, .t-note, .t-target, .t-dash { color: #7a7166; }
.t-ref { color: #b84600; }
.t-key { color: #7a7166; }
footer { padding: 8px 14px; border-top: 1px solid #e7e2da; color: #6f675c; font-size: 12px; }
:focus-visible { outline: 2px solid #ff6200; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .added { animation: none; } }
`;

const SVG = 'http://www.w3.org/2000/svg';
function svg(viewBox: string, children: Array<[string, Record<string, string>]>, className?: string) {
  const root = document.createElementNS(SVG, 'svg');
  root.setAttribute('viewBox', viewBox);
  root.setAttribute('aria-hidden', 'true');
  if (className) root.setAttribute('class', className);
  for (const [tag, attributes] of children) {
    const child = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) child.setAttribute(name, value);
    root.append(child);
  }
  return root;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: Array<Node | string>
) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function open() {
  const host = document.createElement('div');
  host.setAttribute('data-sightline-panel', '');
  const shadow = host.attachShadow({ mode: 'open' });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    shadow.append(element('style', { textContent: CSS }));
  }

  const mark = svg('0 0 32 32', [
    ['rect', { width: '32', height: '32', rx: '8' }],
    ['path', { d: 'M6 16c3-5 6.5-7.5 10-7.5S23 11 26 16c-3 5-6.5 7.5-10 7.5S9 21 6 16Z' }],
    ['circle', { cx: '16', cy: '16', r: '3' }],
  ], 'mark');
  const infer = element('input', { type: 'checkbox', checked: true });
  const copy = element('button', { type: 'button', className: 'tool' }, 'Copy');
  const side = element(
    'button',
    { type: 'button', className: 'tool icon', title: 'Move to the other side' },
    svg('0 0 16 16', [['path', { d: 'M2 5h11m-3-3 3 3-3 3M14 11H3m3-3-3 3 3 3' }]]),
  );
  side.setAttribute('aria-label', 'Move to the other side');
  const close = element(
    'button',
    { type: 'button', className: 'tool icon', title: 'Close' },
    svg('0 0 16 16', [['path', { d: 'm4 4 8 8m0-8-8 8' }]]),
  );
  close.setAttribute('aria-label', 'Close Sightline');
  const meta = element('p', { className: 'meta' }, 'Reading the page…');
  const pre = element('pre', { tabIndex: -1 });
  pre.setAttribute('aria-label', 'Outline of this page');
  const panel = element(
    'aside',
    { className: 'panel' },
    element(
      'header',
      {},
      mark,
      element('strong', {}, 'Sightline'),
      element('span', { className: 'live' }, 'Live'),
      element('label', {}, infer, 'infer'),
      copy,
      side,
      close,
    ),
    meta,
    pre,
    element('footer', {}, 'Runs in this page; nothing is sent anywhere. Press a line to point at its control.'),
  );
  panel.setAttribute('aria-label', 'Sightline outline');
  shadow.append(panel);
  document.documentElement.append(host);

  let latest: Outline | null = null;
  let sightline = createSightline({ skip: SKIP, viewport: true, infer: true });
  let stop = () => {};

  const show = (outline: Outline, changed: string[]) => {
    latest = outline;
    const fresh = new Set(changed);
    const scrollTop = pre.scrollTop;
    renderOutline(pre, outline.lines, (line) => fresh.has(line));
    pre.scrollTop = scrollTop;
    const tokens = Math.round(outline.stats.chars / 4);
    meta.textContent = `${outline.stats.controls} controls · ~${tokens.toLocaleString()} tokens · ${outline.stats.ms.toFixed(1)} ms · updated ${new Date().toLocaleTimeString()}`;
  };

  const start = () => {
    stop();
    sightline = createSightline({ skip: SKIP, viewport: true, infer: infer.checked });
    let first = true;
    stop = sightline.watch((change) => {
      show(change.outline, first ? [] : change.diff.added);
      first = false;
    });
  };

  pre.addEventListener('click', (event) => {
    const row = (event.target as Element).closest<HTMLElement>('button.line');
    if (!row?.dataset.ref) return;
    const rows = [...pre.querySelectorAll<HTMLElement>('button.line')];
    focusRow(rows, rows.indexOf(row));
    sightline.highlight(row.dataset.ref, { color: '#ff6200' });
  });
  roveRefs(pre);
  infer.addEventListener('change', start);
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(latest?.text ?? '');
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Copy failed';
    }
    setTimeout(() => (copy.textContent = 'Copy'), 1_600);
  });
  side.addEventListener('click', () => panel.classList.toggle('left'));

  const shut = () => {
    stop();
    host.remove();
    delete (globalThis as Record<string, unknown>)[KEY];
  };
  close.addEventListener('click', shut);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') shut();
  });
  (globalThis as Record<string, unknown>)[KEY] = { close: shut };
  start();
}

const running = (globalThis as Record<string, unknown>)[KEY] as { close(): void } | undefined;
if (running) running.close();
else open();
