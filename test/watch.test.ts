/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { outline, watchPage, type PageChange, type WatchOptions } from '../src';
let stop = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button>Start</button>';
});
afterEach(() => {
  stop();
  document.body.innerHTML = '';
  vi.useRealTimers();
});
function watch(options: WatchOptions = {}) {
  const events: PageChange[] = [];
  const capture = vi.fn(() =>
    outline(document, { header: false, skip: '.skip' }),
  );
  stop = watchPage(document, capture, (event) => events.push(event), {
    path: () => '/x',
    ...options,
  });
  return { events, capture };
}
async function settle(ms = 500) {
  await vi.advanceTimersByTimeAsync(ms);
}

it('emits initial, then a settled update with previous outline and diff', async () => {
  const { events } = watch();
  expect(events[0]).toMatchObject({
    kind: 'initial',
    previous: null,
    path: '/x',
  });
  document.querySelector('button')!.textContent = 'Ready';
  await settle(160);
  expect(events).toHaveLength(1);
  await settle(300);
  expect(events[1]).toMatchObject({
    kind: 'update',
    diff: { added: ['button "Ready"'], removed: ['button "Start"'] },
  });
  expect(events[1].previous).toBe(events[0].outline);
  await settle(2000);
  expect(events).toHaveLength(2);
});

it('coalesces a burst and cancels changes that revert before settling', async () => {
  const { events } = watch();
  document.querySelector('button')!.textContent = 'Loading';
  await settle(160);
  document.querySelector('button')!.textContent = 'Ready';
  await settle();
  expect(events.map((event) => event.outline.text)).toEqual([
    'button "Start"',
    'button "Ready"',
  ]);
  document.querySelector('button')!.textContent = 'Temporary';
  await settle(160);
  document.querySelector('button')!.textContent = 'Ready';
  await settle();
  expect(events).toHaveLength(2);
});

it('classifies opening and closing dialogs, alerts, toasts and statuses', async () => {
  const { events } = watch();
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div role="dialog" aria-label="Confirm"><button>Close</button></div>',
  );
  await settle();
  expect(events.at(-1)).toMatchObject({
    kind: 'dialog-opened',
    dialogs: ['Confirm'],
  });
  document.querySelector('[role="dialog"]')!.remove();
  await settle();
  expect(events.at(-1)).toMatchObject({ kind: 'dialog-closed', dialogs: [] });
  for (const html of [
    '<div role="alert">Failed</div>',
    '<li data-sonner-toast>Saved</li>',
    '<div role="status">Online</div>',
  ]) {
    document.body.insertAdjacentHTML('beforeend', html);
    await settle();
    expect(events.at(-1)?.kind).toBe('alert');
  }
  expect(events.slice(-3).flatMap((event) => event.alerts)).toEqual([
    'Failed',
    'Saved',
    'Online',
  ]);
});

it('waits 700ms after navigation and detects path-only changes through polling', async () => {
  let path = '/x';
  const { events } = watch({ path: () => path });
  path = '/next';
  await settle(1600);
  expect(events).toHaveLength(1);
  await settle(700);
  expect(events[1]).toMatchObject({
    kind: 'navigation',
    path: '/next',
    diff: { added: [], removed: [] },
  });
});

it('suppresses initial and ordinary updates but advances the previous baseline', async () => {
  const { events } = watch({ initial: false, updates: false });
  expect(events).toHaveLength(0);
  document.querySelector('button')!.textContent = 'Ready';
  await settle();
  expect(events).toHaveLength(0);
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div role="alert">Error</div>',
  );
  await settle();
  expect(events[0].previous?.text).toBe('button "Ready"');
  expect(events[0].diff.added).toEqual(['alert "Error"']);
});

it('ignores mutations inside skipped subtrees and cancels pending work on stop', async () => {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<aside class="skip"><button>Agent</button></aside>',
  );
  const { events, capture } = watch({ skip: '.skip' });
  await settle(10);
  capture.mockClear();
  document.querySelector('aside button')!.textContent = 'New agent text';
  await settle();
  expect(capture).not.toHaveBeenCalled();
  document.querySelector('button')!.textContent = 'Changed';
  await settle(160);
  stop();
  await settle(3000);
  expect(events).toHaveLength(1);
});

it('uses input events and polling for property changes with no DOM mutation', async () => {
  document.body.innerHTML = '<input aria-label="Name">';
  const { events } = watch();
  const input = document.querySelector('input')!;
  input.value = 'private';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
  expect(events.at(-1)?.outline.text).toBe('textbox "Name"');
  input.value = '';
  await settle(2000);
  expect(events.at(-1)?.outline.text).toBe('textbox "Name" [empty]');
});

it('tolerates unavailable captures', async () => {
  const callback = vi.fn();
  stop = watchPage(document, () => null, callback);
  await settle(3000);
  expect(callback).not.toHaveBeenCalled();
});

it('throttles captures during repeated input events', async () => {
  const { capture } = watch();
  document
    .querySelector('button')!
    .dispatchEvent(new Event('input', { bubbles: true }));
  await settle(1);
  capture.mockClear();
  for (let i = 0; i < 10; i++) {
    document
      .querySelector('button')!
      .dispatchEvent(new Event('input', { bubbles: true }));
    await settle(10);
  }
  expect(capture).not.toHaveBeenCalled();
  await settle(60);
  expect(capture).toHaveBeenCalledTimes(1);
});
