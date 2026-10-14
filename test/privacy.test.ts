/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import {
  describeElement,
  describeInteraction,
  outline,
  trackInteractions,
  type Interaction,
} from '../src';
import { clip, createContext } from '../src/outline';
afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
});

it.each(['text', 'password', 'search', 'number'])(
  'never exposes typed %s values through outline or event descriptions',
  (type) => {
    document.body.innerHTML = `<label>Account<input type="${type}"></label>`;
    const input = document.querySelector('input')!;
    input.value = type === 'number' ? '918273645' : 'private-token-918273645';
    const events: Interaction[] = [];
    const stop = trackInteractions(document, (event) => events.push(event));
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    stop();
    const described = describeElement(input)!;
    expect(described.name).toBe('Account');
    expect(events.map((event) => event.state)).toEqual([undefined, 'filled']);
    const reported = [
      outline(document)?.text,
      described.name,
      ...events.map(describeInteraction),
      ...events.map(({ element: _element, ...event }) => JSON.stringify(event)),
    ].join('\n');
    expect(reported).not.toContain('918273645');
  },
);

it('omits textarea and nested editable contents even when named from another element', () => {
  document.body.innerHTML = `<label>Prompt<textarea>private textarea</textarea></label><div contenteditable="true" aria-label="Notes"><button>private nested button</button><span>private notes</span></div><button aria-labelledby="source">Fallback</button><span id="source">Public <span contenteditable="true">private label</span></span>`;
  const text = outline(document, { header: false })!.text;
  expect(text).toContain('textbox "Prompt"');
  expect(text).toContain('textbox "Notes"');
  expect(text).toContain('button "Public"');
  expect(text).not.toContain('private');
  expect(
    describeElement(document.querySelector('[contenteditable]'))?.name,
  ).toBe('Notes');
  expect(
    describeElement(document.querySelector('[contenteditable] button'))?.name,
  ).toBe('Notes');
});

it('redacts emails from titles, names, descriptions, alerts and selected options', () => {
  document.title = 'ada@example.test';
  document.body.innerHTML = `<button aria-describedby="help">Invite ada@example.test</button><p id="help">Ask bob@example.test</p><div role="alert">Contact cat@example.test</div><label>Owner<select><option>dan@example.test</option></select></label>`;
  const text = outline(document)!.text;
  expect(text).not.toContain('@example.test');
  expect(text.match(/\[email\]/g)).toHaveLength(5);
});

it('keeps matching public emails consistently even with a global regex', () => {
  document.body.innerHTML =
    '<button>support@example.test support@example.test ada@example.test</button>';
  expect(
    outline(document, { header: false, keepEmail: /^support@example\.test$/gi })
      ?.text,
  ).toBe('button "support@example.test support@example.test [email]"');
});

it('redacts complete addresses with punctuation and long local parts before clipping', () => {
  const ctx = createContext(document);
  expect(
    clip(ctx, '(ada.name+tag%route_1-test@example.test), bob@example.test!'),
  ).toBe('([email]), [email]!');
  expect(clip(ctx, `${'%'.repeat(100_000)}@example.test`)).toBe('[email]');
});

it('handles long non-email runs without repeatedly scanning their suffixes', () => {
  const ctx = createContext(document);
  const input = '%'.repeat(100_000);
  const start = performance.now();
  expect(clip(ctx, input)).toBe(`${'%'.repeat(99)}…`);
  expect(performance.now() - start).toBeLessThan(1000);
});

it('applies caller redaction to names and excerpts', () => {
  document.body.innerHTML =
    '<button>Project Falcon</button><div role="alert">Falcon failed</div>';
  expect(
    outline(document, {
      header: false,
      redact: (text) => text.replaceAll('Falcon', '[project]'),
    })?.text,
  ).toBe('button "Project [project]"\nalert "[project] failed"');
});
