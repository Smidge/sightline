import { createSightline, type Outline, type Sightline } from '../../src/index.js';
import { highlightCode } from './code.js';
import { showStars } from './stars.js';
import { copyButtons } from './copy.js';
import {
  focusRow,
  markStaticOutlines,
  renderOutline,
  roveRefs,
} from './outline-view.js';
import {
  ReadError,
  fetchPage,
  looksBlocked,
  looksScriptOnly,
  parseAddress,
  preparePage,
  type FetchedPage,
} from './page.js';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, label: 'Desktop, 1440 × 900' },
  phone: { width: 390, height: 844, label: 'Phone, 390 × 844' },
} as const;
type Device = keyof typeof VIEWPORTS;
type View = 'plain' | 'inferred';

const SAMPLE = new URL('samples/api-keys.html', document.baseURI).href;

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;

const form = $<HTMLFormElement>('#reader');
const input = $<HTMLInputElement>('#url');
const submit = $<HTMLButtonElement>('#submit');
const statusLine = $('#status');
const statusText = $('#status-text');
const statusAction = $<HTMLButtonElement>('#status-action');
const results = $('#results');
const notice = $('#notice');
const pageTitle = $('#page-title');
const pageMeta = $('#page-meta');
const stage = $('#stage');
const frame = $<HTMLIFrameElement>('#frame');
const deviceLabel = $('#device-label');
const pre = $('#outline');
const outlineStats = $('#outline-stats');
const legend = $('#legend');
const pasteForm = $<HTMLFormElement>('#paste');

let device: Device = 'desktop';
let view: View = 'inferred';
let page: FetchedPage | null = null;
let sightline: Sightline | null = null;
let outlines: Record<View, Outline | null> = { plain: null, inferred: null };
let controller: AbortController | null = null;
let fetchMs = 0;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;

function setStatus(text: string, action?: { label: string; run: () => void }) {
  statusText.textContent = text;
  statusAction.hidden = !action;
  statusAction.onclick = action ? action.run : null;
  if (action) statusAction.textContent = action.label;
  statusLine.dataset.empty = String(!text && !action);
}

function showNotice(text: string | null) {
  notice.hidden = !text;
  notice.textContent = text ?? '';
}

function setBusy(busy: boolean) {
  submit.disabled = busy;
  submit.classList.toggle('busy', busy);
  form.setAttribute('aria-busy', String(busy));
  results.classList.toggle('loading', busy);
}

/** Fits the full-size frame into the stage, keeping its real viewport. */
function fitFrame() {
  const { width, height } = VIEWPORTS[device];
  const room = stage.parentElement!.clientWidth;
  const maxHeight = Math.min(window.innerHeight * 0.72, device === 'phone' ? 680 : 760);
  const scale = Math.min(room / width, maxHeight / height, 1);
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.transform = `scale(${scale})`;
  stage.style.width = `${Math.floor(width * scale)}px`;
  stage.style.height = `${Math.floor(height * scale)}px`;
  results.dataset.device = device;
  deviceLabel.textContent = VIEWPORTS[device].label;
}

function mount(html: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (complete: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(complete);
    };
    // Slow images shouldn't hold the outline back for long.
    const timer = setTimeout(() => done(false), 8_000);
    frame.addEventListener('load', () => done(true), { once: true });
    frame.srcdoc = html;
  });
}

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function capture() {
  const doc = frame.contentDocument;
  if (!doc || !sightline || !page) return;
  outlines = {
    plain: sightline.capture({ infer: false }),
    inferred: sightline.capture({ infer: true }),
  };
  draw();
}

function draw() {
  const outline = outlines[view];
  const scrollTop = pre.scrollTop;
  if (!outline) {
    pre.replaceChildren('Nothing readable on this page.');
    outlineStats.textContent = '';
    return;
  }
  const known = view === 'inferred' && outlines.plain ? new Set(outlines.plain.lines) : null;
  renderOutline(pre, outline.lines, (line) => Boolean(known && !known.has(line)));
  pre.scrollTop = scrollTop;
  const tokens = Math.round(outline.stats.chars / 4);
  outlineStats.textContent = `${outline.stats.controls} controls · ~${tokens.toLocaleString()} tokens · ${outline.stats.ms.toFixed(1)} ms`;
  const plainCount = outlines.plain?.stats.controls ?? 0;
  const extra = (outlines.inferred?.stats.controls ?? 0) - plainCount;
  legend.textContent =
    view === 'inferred'
      ? extra > 0
        ? `Highlighted lines need infer: true. It found ${extra} more control${extra === 1 ? '' : 's'} here.`
        : 'Highlighted lines need infer: true. This page is semantic enough that it adds little.'
      : 'Roles, names and states, as a screen reader gets them.';
}

/** The ref an element has in the outline on show, from it or its parents. */
function refFor(target: Element): string | null {
  const outline = outlines[view];
  if (!outline) return null;
  const byElement = new Map<Element, string>();
  for (const [ref, element] of outline.refs) byElement.set(element, ref);
  for (let node: Element | null = target; node; node = node.parentElement) {
    const ref = byElement.get(node);
    if (ref) return ref;
  }
  return null;
}

function pointAt(ref: string) {
  sightline?.highlight(ref, { color: '#ff6200', durationMs: 2_000 });
}

function locate(ref: string) {
  const rows = [...pre.querySelectorAll<HTMLElement>('button.line')];
  const index = rows.findIndex((row) => row.dataset.ref === ref);
  if (index < 0) return;
  focusRow(rows, index);
  rows[index].classList.remove('flash');
  void rows[index].offsetWidth;
  rows[index].classList.add('flash');
}

function wireFrame(doc: Document) {
  // Clicks find the control in the outline; nothing navigates the frame.
  doc.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      const target = event.target as Element | null;
      if (!target?.closest) return;
      const ref = refFor(target);
      const link = target.closest('a[href]') as HTMLAnchorElement | null;
      const readable = link && /^https?:/.test(link.href) && page?.via !== 'sample';
      const follow = readable
        ? { label: 'Read that page', run: () => readAddress(link.href) }
        : undefined;
      if (ref) {
        locate(ref);
        pointAt(ref);
        setStatus(`That's ${ref} in the outline.`, follow);
      } else {
        setStatus(
          view === 'plain'
            ? "That isn't a control the semantic outline lists. Switch to With inference to see if it's found."
            : "That isn't a control in the outline.",
          follow,
        );
      }
    },
    true,
  );
  doc.addEventListener('submit', (event) => event.preventDefault(), true);
  // Scrolling changes which controls are [offscreen], so read again.
  doc.addEventListener(
    'scroll',
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(capture, 160);
    },
    { capture: true, passive: true },
  );
}

function describeSource(fetched: FetchedPage, loadMs: number, complete: boolean) {
  const elements = frame.contentDocument?.getElementsByTagName('*').length ?? 0;
  const parts = [`${elements.toLocaleString()} elements`];
  if (fetched.via === 'reader') parts.push(`fetched by Jina Reader in ${(fetchMs / 1000).toFixed(1)} s`);
  if (fetched.via === 'direct') parts.push(`fetched directly in ${(fetchMs / 1000).toFixed(1)} s`);
  if (fetched.via === 'pasted') parts.push('pasted HTML');
  parts.push(complete ? `drawn in ${(loadMs / 1000).toFixed(1)} s` : 'some files still loading');
  return parts.join(' · ');
}

async function load(
  getPage: (signal: AbortSignal) => Promise<FetchedPage>,
  options: { scroll?: boolean } = {},
) {
  controller?.abort();
  const own = new AbortController();
  controller = own;
  setBusy(true);
  showNotice(null);
  setStatus('Fetching the page…');
  const started = performance.now();
  try {
    const fetched = await getPage(own.signal);
    if (own.signal.aborted) return;
    fetchMs = performance.now() - started;
    setStatus('Drawing it here, without its scripts…');
    // The frame needs layout before Sightline can tell what is visible.
    results.hidden = false;
    fitFrame();
    const drawStarted = performance.now();
    const complete = await mount(preparePage(fetched.html, fetched.url));
    if (own.signal.aborted) return;
    await nextFrame();
    const doc = frame.contentDocument;
    if (!doc) throw new Error('The preview frame did not load.');
    const url = new URL(fetched.url);
    page = fetched;
    sightline = createSightline({
      document: doc,
      viewport: true,
      maxChars: 12_000,
      location: { origin: url.origin, pathname: url.pathname, search: url.search, href: url.href },
    });
    wireFrame(doc);
    pre.scrollTop = 0;
    capture();

    pageTitle.textContent = doc.title.trim() || url.host;
    let origin: Node;
    if (fetched.via === 'sample') {
      origin = document.createTextNode('A made-up app, built into this site');
    } else {
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = url.href.replace(/^https?:\/\//, '').replace(/\/$/, '');
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      origin = link;
    }
    pageMeta.replaceChildren(origin, ` · ${describeSource(fetched, performance.now() - drawStarted, complete)}`);

    if (looksBlocked(doc))
      showNotice('This site answered with a bot check instead of the page, so that is what you see. Try another site.');
    else if (looksScriptOnly(doc))
      showNotice(
        "This page builds itself with JavaScript, which the demo doesn't run. To read it as your visitors see it, use the bookmarklet below on the live page.",
      );
    else if (fetched.status && fetched.status >= 400)
      showNotice(`The site answered ${fetched.status}, so this is its error page.`);

    setStatus(
      fetched.via === 'sample'
        ? 'Click a line to point at it on the page, or click the page to find a control in the outline.'
        : `Read in ${((performance.now() - started) / 1000).toFixed(1)} s. Click a line to point at it on the page.`,
    );
    if (options.scroll)
      results.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
  } catch (error) {
    if (own.signal.aborted) return;
    if (!page) results.hidden = true;
    setStatus('');
    showNotice(
      error instanceof ReadError
        ? error.message
        : "Couldn't read that page. Try another address, or paste the page's HTML.",
    );
    if (!(error instanceof ReadError)) console.error(error);
  } finally {
    if (controller === own) setBusy(false);
  }
}

function readAddress(raw: string, options: { scroll?: boolean } = { scroll: true }) {
  let url: URL;
  try {
    url = parseAddress(raw);
  } catch (error) {
    showNotice(error instanceof ReadError ? error.message : String(error));
    input.focus();
    return;
  }
  input.value = url.href;
  const params = new URLSearchParams({ url: url.href });
  if (device === 'phone') params.set('device', 'phone');
  history.replaceState(null, '', `?${params}#demo`);
  void load((signal) => fetchPage(url, signal), options);
}

function readSample(options: { scroll?: boolean } = {}) {
  input.value = '';
  history.replaceState(null, '', location.pathname + (location.hash || ''));
  void load(async (signal) => {
    const response = await fetch(SAMPLE, { signal });
    return { html: await response.text(), url: SAMPLE, status: null, via: 'sample' };
  }, options);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  readAddress(input.value);
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-example]')) {
  button.addEventListener('click', () => {
    const url = button.dataset.example!;
    if (url === 'sample') readSample({ scroll: true });
    else readAddress(url);
  });
}

pasteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(pasteForm);
  const html = String(data.get('html') ?? '');
  if (!html.trim()) {
    showNotice('Paste some HTML first.');
    return;
  }
  let base = 'https://example.com/';
  try {
    const raw = String(data.get('base') ?? '').trim();
    if (raw) base = parseAddress(raw).href;
  } catch (error) {
    showNotice(error instanceof ReadError ? error.message : String(error));
    return;
  }
  void load(async () => ({ html, url: base, status: null, via: 'pasted' }), { scroll: true });
});

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="device"]')) {
  radio.addEventListener('change', async () => {
    device = radio.value as Device;
    if (!page) return;
    fitFrame();
    await nextFrame();
    capture();
  });
}

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="view"]')) {
  radio.addEventListener('change', () => {
    view = radio.value as View;
    draw();
  });
}

pre.addEventListener('click', (event) => {
  const row = (event.target as Element).closest<HTMLElement>('button.line');
  if (!row?.dataset.ref) return;
  const rows = [...pre.querySelectorAll<HTMLElement>('button.line')];
  focusRow(rows, rows.indexOf(row));
  pointAt(row.dataset.ref);
});
roveRefs(pre);

copyButtons(document, (name) => (name === 'outline' ? (outlines[view]?.text ?? '') : null));
new ResizeObserver(() => page && fitFrame()).observe(stage.parentElement!);
markStaticOutlines();
highlightCode();
void showStars();

// Shared links open with the page already read; otherwise show the sample.
const initial = new URLSearchParams(location.search);
const deviceParam = initial.get('device') === 'phone' ? 'phone' : 'desktop';
device = deviceParam;
$<HTMLInputElement>(`input[name="device"][value="${deviceParam}"]`).checked = true;
const shared = initial.get('url');
if (shared) readAddress(shared, { scroll: true });
else readSample();
