/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { outline, RefRegistry } from '../src';
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

it('keeps refs stable across insertion, reorder and renaming; removed elements resolve null', () => {
  document.body.innerHTML = '<button>First</button><button>Second</button>';
  const registry = new RefRegistry();
  const first = outline(document, { refs: true }, registry)!;
  const [ref, element] = [...first.refs][0];
  element.textContent = 'Renamed';
  document.body.append(element);
  document.body.insertAdjacentHTML('afterbegin', '<button>New</button>');
  const second = outline(document, { refs: true }, registry)!;
  expect(second.refs.get(ref)).toBe(element);
  expect(second.text).toContain(`button "Renamed" [ref=${ref}]`);
  expect(new Set(second.refs.keys()).size).toBe(3);
  expect(registry.resolve(`ref=${ref}`)).toBe(element);
  element.remove();
  expect(registry.resolve(ref)).toBeNull();
  registry.prune();
  expect(registry.resolve(ref)).toBeNull();
  expect(registry.resolve('e999')).toBeNull();
});

it('lists navigation and tab items one per line when refs are on', () => {
  // A model reading several "Name [ref=eN]" pairs on one line picked the
  // wrong ref in live testing, so each item gets its own line.
  document.body.innerHTML =
    '<nav><a href="/" aria-current="page">Home</a><a href="/docs">Docs</a></nav><div role="tablist"><button role="tab" aria-selected="true">Settings</button></div>';
  const result = outline(document, {
    refs: true,
    header: false,
    location: { pathname: '/', origin: 'https://example.test' },
  })!;
  expect(result.lines).toEqual([
    'navigation',
    '  link "Home" → / [current] [ref=e1]',
    '  link "Docs" → /docs [ref=e2]',
    'tabs',
    '  tab "Settings" [selected] [ref=e3]',
  ]);
  expect(result.refs.get('e1')).toBe(document.querySelector('a'));
  expect(result.refs.get('e3')).toBe(document.querySelector('button'));
});

it('keeps the compact one-line navigation and tabs without refs', () => {
  document.body.innerHTML =
    '<nav><a href="/">Home</a><a href="/docs">Docs</a></nav><div role="tablist"><button role="tab" aria-selected="true">Settings</button></div>';
  expect(outline(document, { header: false })!.lines).toEqual([
    'navigation: Home · Docs',
    'tabs: Settings [selected]',
  ]);
});

it.each([
  [0, 0, 100, 20, false],
  [0, -20, 100, 20, true],
  [0, 600, 100, 20, true],
  [-100, 0, 100, 20, true],
  [800, 0, 100, 20, true],
  [0, 0, 0, 0, false],
  [0, 590, 100, 20, false],
])(
  'marks viewport intersection at (%i,%i,%i,%i)',
  (x, y, width, height, offscreen) => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    document.body.innerHTML = '<h1>Heading</h1><button>Go</button>';
    for (const element of document.body.children)
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        x,
        y,
        left: x,
        top: y,
        right: x + width,
        bottom: y + height,
        width,
        height,
        toJSON: () => ({}),
      });
    const result = outline(document, { header: false, viewport: true })!;
    expect(
      result.lines.every((line) => line.includes('[offscreen]') === offscreen),
    ).toBe(true);
    expect(outline(document, { header: false })!.text).not.toContain(
      'offscreen',
    );
  },
);

it.each([
  [0, 'top, more below'],
  [700, '50% down'],
  [1400, 'bottom'],
])('reports scroll position %i', (top, expected) => {
  document.body.innerHTML = '<button>Go</button>';
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
  vi.spyOn(document, 'scrollingElement', 'get').mockReturnValue(
    document.documentElement,
  );
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(
    2000,
  );
  vi.spyOn(document.documentElement, 'scrollTop', 'get').mockReturnValue(top);
  expect(outline(document, { viewport: true })!.lines).toContain(
    `Scroll: ${expected}`,
  );
});
