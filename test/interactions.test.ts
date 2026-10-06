/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import {
  describeInteraction,
  trackInteractions,
  type Interaction,
} from '../src';
let stop = () => {};
afterEach(() => {
  stop();
  document.body.innerHTML = '';
  vi.useRealTimers();
});
function track(html: string, options = {}) {
  document.body.innerHTML = html;
  const events: Interaction[] = [];
  stop = trackInteractions(document, (event) => events.push(event), options);
  return events;
}

it('reports nested clicks, dedupes within 300ms and stops listening', () => {
  vi.useFakeTimers();
  const events = track('<button data-testid="save"><span>Save</span></button>');
  const target = document.querySelector('span')!;
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'click',
    role: 'button',
    name: 'Save',
    hint: 'save',
  });
  vi.advanceTimersByTime(301);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(events).toHaveLength(2);
  stop();
  vi.advanceTimersByTime(301);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(events).toHaveLength(2);
});

it('reports native checkbox toggles without duplicate clicks', () => {
  const events = track('<label>Consent<input type="checkbox"></label>');
  document.querySelector('input')!.click();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'toggle',
    role: 'checkbox',
    name: 'Consent',
    state: 'checked',
  });
});

it('reads custom switch state after its click handler flips aria-checked', () => {
  vi.useFakeTimers();
  const events = track(
    '<button role="switch" aria-checked="false">Audio</button>',
  );
  const button = document.querySelector('button')!;
  button.addEventListener('click', () =>
    button.setAttribute('aria-checked', 'true'),
  );
  button.click();
  expect(events).toHaveLength(0);
  vi.advanceTimersByTime(1);
  expect(events[0]).toMatchObject({
    type: 'toggle',
    state: 'on',
    name: 'Audio',
  });
});

it('does not report a queued toggle after cleanup', () => {
  vi.useFakeTimers();
  const events = track(
    '<button role="switch" aria-checked="false">Audio</button>',
  );
  document.querySelector('button')!.click();
  stop();
  vi.advanceTimersByTime(1);
  expect(events).toEqual([]);
});

it('reports chosen option text instead of its value', () => {
  const events = track(
    '<label>Language<select><option value="secret-code">English</option><option value="private-code">French</option></select></label>',
  );
  const select = document.querySelector('select')!;
  select.selectedIndex = 1;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(events[0]).toMatchObject({
    type: 'select',
    option: 'French',
    name: 'Language',
  });
  expect(describeInteraction(events[0])).toBe(
    'chose "French" in combobox "Language"',
  );
});

it('redacts personal emails in selected option reports', () => {
  const events = track(
    '<select aria-label="Owner"><option>ada@example.test</option></select>',
  );
  document
    .querySelector('select')!
    .dispatchEvent(new Event('change', { bubbles: true }));
  expect(events[0].option).toBe('[email]');
});

it.each([
  '<input aria-label="Notes">',
  '<textarea aria-label="Notes"></textarea>',
  '<div contenteditable="true" aria-label="Notes"></div>',
])('reports focus and edits as empty or filled: %s', (html) => {
  const events = track(html);
  const field = document.body.firstElementChild!;
  field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  const set = (value: string) => {
    if (field.hasAttribute('contenteditable')) field.textContent = value;
    else (field as HTMLInputElement).value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('private text');
  set('different private text');
  set('   ');
  expect(events.map((event) => [event.type, event.state])).toEqual([
    ['focus', undefined],
    ['edit', 'filled'],
    ['edit', 'empty'],
  ]);
  expect(events.map(describeInteraction).join('\n')).not.toContain('private');
});

it('reports submitters, honours skip and ignores unnamed controls', () => {
  const events = track(
    '<form><button type="submit">Save</button></form><aside><button>Ignore</button></aside><button aria-label=""></button>',
    { skip: 'aside' },
  );
  const button = document.querySelector('button')!;
  document
    .querySelector('form')!
    .dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, submitter: button }),
    );
  document.querySelector<HTMLButtonElement>('aside button')!.click();
  document.body.lastElementChild!.dispatchEvent(
    new MouseEvent('click', { bubbles: true }),
  );
  expect(events).toHaveLength(1);
  expect(describeInteraction(events[0])).toBe('submitted button "Save"');
});

it.each([
  ['click', undefined, 'clicked'],
  ['toggle', 'on', 'turned'],
  ['focus', undefined, 'moved into'],
  ['edit', 'filled', 'filled in'],
  ['edit', 'empty', 'cleared'],
  ['submit', undefined, 'submitted'],
] as const)('formats %s %s sentences', (type, state, verb) => {
  expect(
    describeInteraction({
      type,
      state,
      role: 'button',
      name: 'Save',
      element: document.body,
      at: 0,
      hint: null,
    }),
  ).toBe(`${verb} button "Save"${type === 'toggle' ? ' on' : ''}`);
});
