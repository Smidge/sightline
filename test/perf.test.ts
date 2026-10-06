/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import { outline } from '../src';
afterEach(() => {
  document.body.innerHTML = '';
});
it('outlines over 5,000 elements without pathological work and samples a 1,000-row table', () => {
  document.body.innerHTML = `<main><table aria-label="Accounts"><thead><tr><th>Name</th><th>Actions</th></tr></thead><tbody>${Array.from({ length: 1000 }, (_, i) => `<tr><td>Account ${i}</td><td><button>Edit ${i}</button></td></tr>`).join('')}</tbody></table><ul>${Array.from({ length: 1000 }, (_, i) => `<li><span>Card ${i}</span><button>Open ${i}</button></li>`).join('')}</ul>${Array.from({ length: 200 }, (_, i) => `<button>Action ${i}</button>`).join('')}</main>`;
  expect(document.querySelectorAll('*').length).toBeGreaterThan(5000);
  const start = performance.now();
  const result = outline(document, {
    maxChars: 2000,
    refs: true,
    viewport: true,
    location: { pathname: '/x', origin: 'https://example.test' },
  })!;
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(1500);
  expect(result.text.length).toBeLessThanOrEqual(2000);
  expect(result.text).toContain(
    'table "Accounts": columns Name | Actions; 1000 rows',
  );
  expect(result.text).toContain('… 997 more similar items');
  expect(result.text).toContain('button "Edit 2"');
  expect(result.text).not.toContain('Edit 3');
  expect(result.stats.visited).toBeLessThan(500);
});
