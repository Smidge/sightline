import { diffLines, type LineDiff } from './diff';
import type { Outline } from './outline';

export type PageChangeKind =
  | 'initial'
  | 'navigation'
  | 'dialog-opened'
  | 'dialog-closed'
  | 'alert'
  | 'update';

export type PageChange = {
  kind: PageChangeKind;
  path: string;
  outline: Outline;
  previous: Outline | null;
  diff: LineDiff;
  /** Names of the dialogs open now. */
  dialogs: string[];
  /** Alert, toast and status texts that appeared with this change. */
  alerts: string[];
};

export type WatchOptions = {
  /** How long the page must hold still before a change is reported. Default 250 ms. */
  settleMs?: number;
  /** The same, after the address changed, so the new page can load. Default 700 ms. */
  navigationSettleMs?: number;
  /** Minimum gap between two captures while the page is busy. Default 150 ms. */
  throttleMs?: number;
  /** Safety poll for changes no mutation reports (typed values, history). Default 1,500 ms. */
  pollMs?: number;
  /** Report plain updates, not only navigation, dialogs and alerts. Default true. */
  updates?: boolean;
  /** Report the page as it is when watching starts. Default true. */
  initial?: boolean;
  /** Mutations inside these subtrees are ignored (the agent's own panel). */
  skip?: string;
  /** The current address. Default `location.pathname + location.search`. */
  path?: () => string;
};

const DIALOG_LINE = /^\s*(?:dialog|alertdialog)(?: "(.*)")? \(open\)/;
const ALERT_LINE = /^\s*(alert|toast|status) "(.*)"/;

function dialogsIn(outline: Outline): string[] {
  const names: string[] = [];
  for (const line of outline.lines) {
    const match = DIALOG_LINE.exec(line);
    if (match) names.push(match[1] ?? 'dialog');
  }
  return names;
}

function alertsIn(lines: string[]): string[] {
  const texts: string[] = [];
  for (const line of lines) {
    const match = ALERT_LINE.exec(line);
    if (match) texts.push(match[2]);
  }
  return texts;
}

function classify(
  pathChanged: boolean,
  dialogsBefore: string[],
  dialogsNow: string[],
  alerts: string[],
): PageChangeKind {
  if (pathChanged) return 'navigation';
  if (dialogsNow.some((name) => !dialogsBefore.includes(name)))
    return 'dialog-opened';
  if (dialogsBefore.some((name) => !dialogsNow.includes(name)))
    return 'dialog-closed';
  if (alerts.length) return 'alert';
  return 'update';
}

/**
 * Calls `onChange` when the page settles into a new state: another address,
 * a dialog opening or closing, a new alert, or (optionally) any other visible
 * change. It captures at most once per `throttleMs` while the page is busy
 * and waits for the result to hold still, so a loading page is reported once.
 */
export function watchPage(
  doc: Document,
  capture: () => Outline | null,
  onChange: (change: PageChange) => void,
  options: WatchOptions = {},
): () => void {
  const settleMs = options.settleMs ?? 250;
  const navigationSettleMs = options.navigationSettleMs ?? 700;
  const throttleMs = options.throttleMs ?? 150;
  const pollMs = options.pollMs ?? 1_500;
  const reportUpdates = options.updates ?? true;
  const view = doc.defaultView;
  const currentPath =
    options.path ??
    (() =>
      doc.location ? `${doc.location.pathname}${doc.location.search}` : '');

  let emitted: Outline | null = null;
  let emittedPath = currentPath();
  let candidate: string | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCheck = 0;
  let stopped = false;

  const emit = (outline: Outline, path: string, kind?: PageChangeKind) => {
    const previous = emitted;
    const diff = diffLines(previous?.text ?? '', outline.text);
    const dialogsBefore = previous ? dialogsIn(previous) : [];
    const dialogs = dialogsIn(outline);
    const alerts = alertsIn(diff.added);
    const resolved =
      kind ?? classify(path !== emittedPath, dialogsBefore, dialogs, alerts);
    emitted = outline;
    emittedPath = path;
    if (resolved === 'update' && !reportUpdates) return;
    onChange({
      kind: resolved,
      path,
      outline,
      previous,
      diff,
      dialogs,
      alerts,
    });
  };

  const check = () => {
    throttleTimer = null;
    if (stopped) return;
    lastCheck = Date.now();
    const outline = capture();
    if (!outline) return;
    const path = currentPath();
    const key = `${path}\n${outline.text}`;
    if (emitted && path === emittedPath && outline.text === emitted.text) {
      // Back where we were: nothing to report.
      candidate = null;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
      return;
    }
    if (key === candidate) return;
    candidate = key;
    if (settleTimer) clearTimeout(settleTimer);
    const wait = path !== emittedPath ? navigationSettleMs : settleMs;
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (stopped) return;
      const settled = capture();
      if (!settled) return;
      const settledPath = currentPath();
      if (`${settledPath}\n${settled.text}` !== candidate) {
        // Still moving: look again after another settle period.
        schedule();
        return;
      }
      candidate = null;
      emit(settled, settledPath);
    }, wait);
  };

  const schedule = () => {
    if (stopped || throttleTimer) return;
    const wait = Math.max(0, throttleMs - (Date.now() - lastCheck));
    throttleTimer = setTimeout(check, wait);
  };

  const ignored = (node: Node) => {
    if (!options.skip) return false;
    const element =
      node.nodeType === 1 ? (node as Element) : node.parentElement;
    return Boolean(element?.closest(options.skip));
  };

  const MutationObserverImpl =
    (view as (Window & typeof globalThis) | null)?.MutationObserver ??
    (typeof MutationObserver === 'undefined' ? null : MutationObserver);
  const observer = MutationObserverImpl
    ? new MutationObserverImpl((records) => {
        if (records.every((record) => ignored(record.target))) return;
        schedule();
      })
    : null;
  observer?.observe(doc.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      'aria-expanded',
      'aria-hidden',
      'aria-selected',
      'aria-checked',
      'aria-pressed',
      'aria-current',
      'aria-disabled',
      'aria-invalid',
      'disabled',
      'hidden',
      'inert',
      'open',
      'style',
      'class',
    ],
  });
  const onEvent = (event: Event) => {
    if (event.target && ignored(event.target as Node)) return;
    schedule();
  };
  doc.addEventListener('input', onEvent, true);
  doc.addEventListener('change', onEvent, true);
  view?.addEventListener('popstate', schedule);
  const poll = setInterval(schedule, pollMs);

  if (options.initial !== false) {
    const first = capture();
    if (first) emit(first, currentPath(), 'initial');
  } else {
    emitted = capture();
  }

  return () => {
    stopped = true;
    observer?.disconnect();
    doc.removeEventListener('input', onEvent, true);
    doc.removeEventListener('change', onEvent, true);
    view?.removeEventListener('popstate', schedule);
    clearInterval(poll);
    if (settleTimer) clearTimeout(settleTimer);
    if (throttleTimer) clearTimeout(throttleTimer);
  };
}
