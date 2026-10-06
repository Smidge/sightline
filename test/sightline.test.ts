/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { createSightline, type Interaction } from '../src';
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

it('captures with stable refs, resolves and finds by ref or normalized name', () => {
  document.body.innerHTML =
    '<button>Save details</button><button>Save</button><aside><button>Ignored</button></aside>';
  const instance = createSightline({ document, header: false, skip: 'aside' });
  const first = instance.capture()!;
  const save = document.querySelectorAll('button')[1];
  const ref = [...first.refs].find(([, element]) => element === save)![0];
  expect(instance.find('SAVE')).toBe(save);
  expect(instance.find(ref)).toBe(save);
  expect(instance.find(`ref=${ref}`)).toBe(save);
  expect(instance.find('Save', 'switch')).toBeNull();
  expect(instance.find('Ignored')).toBeNull();
  for (let i = 0; i < 51; i++)
    expect(instance.capture()!.refs.get(ref)).toBe(save);
  expect(instance.capture({ refs: false })!.refs.size).toBe(0);
  save.remove();
  expect(instance.resolve(ref)).toBeNull();
  expect(instance.find(ref)).toBeNull();
});

it('highlights by name, ref and element and reports failed lookup', () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button>Save</button>';
  const instance = createSightline({ document });
  const ref = [...instance.capture()!.refs.keys()][0];
  for (const target of ['Save', ref, document.querySelector('button')!])
    expect(
      instance.highlight(target, { scroll: false, reducedMotion: true }),
    ).toBe(true);
  expect(instance.highlight('Missing')).toBe(false);
  expect(document.querySelectorAll('[data-sightline-ring]')).toHaveLength(1);
});

it('shares refs with tracking and propagates skip and hint settings', () => {
  document.body.innerHTML =
    '<button data-action="save">Save</button><aside><button>Ignored</button></aside>';
  const instance = createSightline({
    document,
    skip: 'aside',
    hintAttribute: 'data-action',
  });
  const events: (Interaction & { ref: string })[] = [];
  const stop = instance.track((event) => events.push(event));
  document.querySelector('button')!.click();
  document.querySelector<HTMLButtonElement>('aside button')!.click();
  stop();
  expect(events).toHaveLength(1);
  expect(events[0].hint).toBe('save');
  expect(instance.resolve(events[0].ref)).toBe(events[0].element);
  expect(instance.capture()!.refs.get(events[0].ref)).toBe(events[0].element);
});

it('watches using the same capture configuration and registry', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button>Save</button>';
  const instance = createSightline({ document, header: false });
  const callback = vi.fn();
  const stop = instance.watch(callback, { path: () => '/x' });
  const first = instance.capture()!;
  document.querySelector('button')!.setAttribute('disabled', '');
  await vi.advanceTimersByTimeAsync(500);
  stop();
  expect(callback.mock.calls.map(([event]) => event.kind)).toEqual([
    'initial',
    'update',
  ]);
  expect([...callback.mock.calls[1][0].outline.refs.keys()]).toEqual([
    ...first.refs.keys(),
  ]);
});
