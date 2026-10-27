/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createSightline,
  outline,
  watchPage,
  type PageChange,
  type WatchOptions,
} from '../src';

let stops: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** Calls `step` every `every` ms for `duration` ms of fake time. */
async function churn(every: number, duration: number, step: (tick: number) => void) {
  for (let tick = 1; tick * every <= duration; tick += 1) {
    await vi.advanceTimersByTimeAsync(every);
    step(tick);
  }
}

function watchPlain(options: WatchOptions = {}) {
  const events: (PageChange & { at: number })[] = [];
  const capture = vi.fn(() => outline(document, { header: false, skip: '.skip' }));
  stops.push(
    watchPage(document, capture, (change) => events.push({ ...change, at: Date.now() }), {
      path: () => '/x',
      skip: '.skip',
      ...options,
    }),
  );
  return { events, capture };
}

it('stays quiet when a list re-renders without changing', async () => {
  document.body.innerHTML = '<main><div id="list"></div></main>';
  const draw = () => {
    document.getElementById('list')!.innerHTML = '<button>Export</button><button>Refresh</button>';
  };
  draw();
  const { events, capture } = watchPlain();
  await churn(200, 6000, draw);
  expect(events.map((event) => event.kind)).toEqual(['initial']);
  // Captures are throttled, not one per mutation.
  expect(capture.mock.calls.length).toBeLessThan(45);
});

it('reports remounted controls with refs that resolve, and keeps reporting bounded', async () => {
  document.body.innerHTML = '<main><div id="list"><button>Export</button></div></main>';
  const sightline = createSightline({ header: false });
  const events: PageChange[] = [];
  const resolved: boolean[] = [];
  stops.push(
    sightline.watch((change) => {
      events.push(change);
      for (const [, ref] of change.outline.text.matchAll(/ref=(e\d+)/g))
        resolved.push(sightline.resolve(ref) !== null);
    }),
  );
  const first = document.querySelector('button')!;
  expect(events[0].outline.text).toBe('main\n  button "Export" [ref=e1]');

  // One remount: the old element is gone, so the old ref must not survive.
  document.getElementById('list')!.innerHTML = '<button>Export</button>';
  await vi.advanceTimersByTimeAsync(600);
  expect(events).toHaveLength(2);
  expect(events[1].outline.text).toBe('main\n  button "Export" [ref=e2]');
  expect(sightline.resolve('e1')).toBeNull();
  expect(first.isConnected).toBe(false);

  // Constant remounting never holds still; it is reported at most every 2 s.
  await churn(200, 6000, () => {
    document.getElementById('list')!.innerHTML = '<button>Export</button>';
  });
  expect(events.length - 2).toBeGreaterThanOrEqual(2);
  expect(events.length - 2).toBeLessThanOrEqual(3);
  expect(resolved.every(Boolean)).toBe(true);
});

it('reports a page that never settles, and an alert or dialog during the churn', async () => {
  document.body.innerHTML = '<main><div role="status" id="p">Uploading 0%</div></main>';
  const { events } = watchPlain();
  let alertAt = 0;
  let dialogAt = 0;
  await churn(100, 6000, (tick) => {
    document.getElementById('p')!.textContent = `Uploading ${tick % 100}%`;
    if (tick === 20) {
      document.querySelector('main')!.insertAdjacentHTML('beforeend', '<div role="alert">Upload failed: file too large</div>');
      alertAt = Date.now();
    }
    if (tick === 35) {
      document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-label="Retry upload"><button>Retry</button></div>');
      dialogAt = Date.now();
    }
  });
  const alert = events.find((event) => event.outline.text.includes('Upload failed'))!;
  const dialog = events.find((event) => event.outline.text.includes('Retry upload'))!;
  expect(alert.kind).toBe('alert');
  expect(alert.at - alertAt).toBeLessThanOrEqual(500);
  expect(dialog.kind).toBe('dialog-opened');
  expect(dialog.at - dialogAt).toBeLessThanOrEqual(500);
  // About one report per 2 s of churn, plus the two urgent ones; never one per tick.
  expect(events.length).toBeLessThanOrEqual(6);
});

it('reports a ticking clock each tick unless it is skipped or updates are off', async () => {
  const page = () => {
    document.body.innerHTML = '<main><h2 id="t">Call time 00:00</h2><button>Hang up</button></main>';
  };
  const tick = (n: number) => {
    document.getElementById('t')!.textContent = `Call time 00:0${n}`;
  };
  page();
  const all = watchPlain();
  await churn(1000, 6000, tick);
  await vi.advanceTimersByTimeAsync(600);
  // The initial report plus one per tick: each tick settles before the next.
  expect(all.events).toHaveLength(7);
  stops.forEach((stop) => stop());
  stops = [];

  page();
  document.getElementById('t')!.className = 'skip';
  const skipped = watchPlain();
  await churn(1000, 6000, tick);
  expect(skipped.events.map((event) => event.kind)).toEqual(['initial']);
  stops.forEach((stop) => stop());
  stops = [];

  page();
  const quiet = watchPlain({ updates: false, initial: false });
  await churn(1000, 6000, tick);
  expect(quiet.events).toHaveLength(0);
});

it('does not treat an error on a remounted control as new each time', async () => {
  document.body.innerHTML = '<form id="f"></form><p id="err">Enter an email address.</p>';
  const draw = () => {
    document.getElementById('f')!.innerHTML =
      '<input aria-label="Email" aria-invalid="true" aria-errormessage="err">';
  };
  draw();
  const sightline = createSightline({ header: false });
  const events: PageChange[] = [];
  stops.push(sightline.watch((change) => events.push(change)));
  await churn(200, 6000, draw);
  // Bounded by the 2 s wait, not reported as urgent on every remount.
  expect(events.length - 1).toBeLessThanOrEqual(3);
});

it('sees validation text edited in place and descriptions switched by attribute', async () => {
  document.body.innerHTML =
    '<label for="e">Email</label><input id="e" aria-invalid="true" aria-errormessage="err" aria-describedby="ok"><p id="err">Enter an email address.</p><p id="ok">We never share it.</p><p id="other">Use your work address.</p>';
  const { events } = watchPlain();
  // React updates text by setting a text node's value: a characterData mutation.
  document.getElementById('err')!.firstChild!.nodeValue = 'That email is already registered.';
  const edited = Date.now();
  await vi.advanceTimersByTimeAsync(600);
  expect(events.at(-1)!.outline.text).toBe(
    'textbox "Email" [empty, invalid] — "We never share it." — error "That email is already registered."',
  );
  expect(events.at(-1)!.at - edited).toBeLessThan(1000);

  document.getElementById('e')!.setAttribute('aria-describedby', 'other');
  const switched = Date.now();
  await vi.advanceTimersByTimeAsync(600);
  expect(events.at(-1)!.outline.text).toContain('— "Use your work address."');
  expect(events.at(-1)!.at - switched).toBeLessThan(1000);
});

it('ignores text edits inside skipped subtrees', async () => {
  document.body.innerHTML = '<button>Save</button><aside class="skip"><p>Agent says hello</p></aside>';
  const { capture } = watchPlain();
  await vi.advanceTimersByTimeAsync(10);
  capture.mockClear();
  document.querySelector('aside p')!.firstChild!.nodeValue = 'Agent says goodbye';
  await vi.advanceTimersByTimeAsync(600);
  expect(capture).not.toHaveBeenCalled();
});

it('lets the longest wait be configured', async () => {
  document.body.innerHTML = '<div role="status" id="p">0</div>';
  const { events } = watchPlain({ maxWaitMs: 500 });
  await churn(100, 3000, (tick) => {
    document.getElementById('p')!.textContent = String(tick);
  });
  // Roughly every 500 ms plus the capture throttle, instead of never.
  expect(events.length - 1).toBeGreaterThanOrEqual(3);
});
