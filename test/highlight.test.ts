/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { highlight, outline } from '../src';
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button>Go</button>';
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const ring = () => document.querySelector<HTMLElement>('[data-sightline-ring]');

it('places an aria-hidden fixed ring that is absent from the outline', () => {
  const button = document.querySelector('button')!;
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    top: 20,
    left: 30,
    width: 100,
    height: 40,
  } as DOMRect);
  const before = outline(document)?.text;
  const remove = highlight(button, { scroll: false, reducedMotion: true });
  expect(ring()?.getAttribute('aria-hidden')).toBe('true');
  expect(ring()?.style).toMatchObject({
    position: 'fixed',
    pointerEvents: 'none',
    top: '16px',
    left: '26px',
    width: '108px',
    height: '48px',
  });
  expect(outline(document)?.text).toBe(before);
  remove();
  remove();
  expect(ring()).toBeNull();
});

it('follows geometry and removes itself after the duration', async () => {
  const button = document.querySelector('button')!;
  const rect = vi
    .spyOn(button, 'getBoundingClientRect')
    .mockReturnValue({ top: 20, left: 30, width: 100, height: 40 } as DOMRect);
  highlight(button, { durationMs: 100, scroll: false, reducedMotion: true });
  rect.mockReturnValue({
    top: 50,
    left: 60,
    width: 100,
    height: 40,
  } as DOMRect);
  await vi.advanceTimersByTimeAsync(40);
  expect(ring()?.style.top).toBe('46px');
  await vi.advanceTimersByTimeAsync(100);
  expect(ring()).toBeNull();
});

it('replaces the previous ring and respects reduced-motion scrolling', () => {
  const button = document.querySelector('button')!;
  const scroll = vi
    .spyOn(button, 'scrollIntoView')
    .mockImplementation(() => {});
  const first = highlight(button, { reducedMotion: true });
  expect(scroll).toHaveBeenLastCalledWith({
    block: 'center',
    inline: 'nearest',
    behavior: 'auto',
  });
  const second = highlight(button, { reducedMotion: false });
  expect(scroll).toHaveBeenLastCalledWith({
    block: 'center',
    inline: 'nearest',
    behavior: 'smooth',
  });
  expect(document.querySelectorAll('[data-sightline-ring]')).toHaveLength(1);
  first();
  expect(ring()).not.toBeNull();
  second();
});
