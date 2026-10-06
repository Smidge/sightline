/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import { diffLines } from '../src';
afterEach(() => {
  document.body.innerHTML = '';
});
it.each([
  ['', '', { added: [], removed: [] }],
  ['', 'a\nb', { added: ['a', 'b'], removed: [] }],
  ['a\nb', '', { added: [], removed: ['a', 'b'] }],
  ['a\nb', 'b\na', { added: [], removed: [] }],
  ['a\na\nb\nc', 'b\nd\na\nd', { added: ['d', 'd'], removed: ['a', 'c'] }],
  [
    'main\n  button "Go"',
    'main\nbutton "Go"',
    { added: ['button "Go"'], removed: ['  button "Go"'] },
  ],
])('diffs %j to %j with multiplicity and order', (before, after, expected) => {
  expect(diffLines(before as string, after as string)).toEqual(expected);
});
