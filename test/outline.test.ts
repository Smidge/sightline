/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import { outline } from '../src';

const location = { pathname: '/x', origin: 'https://example.test' };
afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
});

it('returns ordered roles, names, states and consistent statistics', () => {
  document.title = 'Settings';
  document.body.innerHTML = `<main><h1>Settings</h1><label for="name">Name</label><input id="name" required aria-invalid="true" aria-errormessage="error"><p id="error">Required name</p><input type="checkbox" aria-label="Consent" checked><button aria-expanded="false" aria-haspopup="menu" disabled>More</button><button role="switch" aria-checked="true">Audio</button></main>`;
  const result = outline(document, { location })!;
  expect(result.lines).toEqual([
    'Page: /x',
    'Title: "Settings"',
    `Viewport: ${window.innerWidth}px wide`,
    'main',
    '  h1 "Settings"',
    '  textbox "Name" [required, empty, invalid] — "Required name"',
    '  checkbox "Consent" [checked]',
    '  button "More" [collapsed, opens menu, disabled]',
    '  switch "Audio" [on]',
  ]);
  expect(result.text).toBe(result.lines.join('\n'));
  expect(result.stats).toMatchObject({
    chars: result.text.length,
    lines: result.lines.length,
    controls: 4,
    truncated: false,
  });
  expect(result.stats.visited).toBeGreaterThan(4);
  expect(result.stats.ms).toBeGreaterThanOrEqual(0);
  expect(result.refs.size).toBe(0);
});

it('summarises navigation and tabs while retaining extra tab controls', () => {
  document.body.innerHTML = `<nav aria-label="Primary"><a href="/x" aria-current="page">Home</a><a href="/help">Help</a></nav><div role="tablist"><button role="tab">One</button><button role="tab" aria-selected="true">Two</button><button aria-label="More"></button></div>`;
  expect(outline(document, { header: false })?.lines).toEqual([
    'navigation "Primary": Home [current] · Help',
    'tabs: One | Two [selected]',
    'button "More"',
  ]);
});

it('scopes to visible modal content and reports alerts, toasts and status', () => {
  document.body.innerHTML = `<main inert><button>Background</button></main><aside aria-hidden="true"><button>Behind</button></aside><dialog><button>Closed dialog</button></dialog><dialog open aria-label="Confirm" aria-describedby="help"><p id="help">Check the details</p><button>Accept</button></dialog><div role="alert">Failed</div><li data-sonner-toast>Saved</li><div aria-live="polite">Ready</div><div role="status">Connected</div>`;
  const text = outline(document, { header: false })!.text;
  expect(text).toContain(
    'dialog "Confirm" (open)\n  text "Check the details"\n  button "Accept"',
  );
  expect(text).toContain('alert "Failed"');
  expect(text).toContain('toast "Saved"');
  expect(text).toContain('status "Ready"');
  expect(text).toContain('status "Connected"');
  expect(text).not.toMatch(/Background|Behind|Closed dialog/);
});

it('omits hidden, skipped and non-content subtrees', () => {
  document.body.innerHTML = `<button>Visible</button><div hidden><button>Hidden</button></div><div style="display:none"><button>CSS hidden</button></div><section class="agent"><button>Assistant</button></section><script>secret()</script><div role="log" aria-label="Chat">Private transcript</div>`;
  // happy-dom has no layout or checkVisibility; supply the browser result.
  for (const element of document.body.querySelectorAll('*')) {
    Object.defineProperty(element, 'checkVisibility', {
      value: () => !element.closest('[style="display:none"]'),
    });
  }
  expect(outline(document, { header: false, skip: '.agent' })?.text).toBe(
    'button "Visible"\nlog "Chat"',
  );
});

it('honours skip inside navigation and tab summaries', () => {
  document.body.innerHTML = `<nav><a href="/">Home</a><span class="skip"><a href="/secret">Secret</a></span></nav><div role="tablist"><button role="tab">Public</button><span class="skip"><button role="tab">Private</button></span></div>`;
  expect(outline(document, { header: false, skip: '.skip' })?.text).toBe(
    'navigation: Home\ntabs: Public',
  );
});

it.each([7, 8, 12])(
  'shortens repeated lists only at the threshold: %i',
  (count) => {
    document.body.innerHTML = `<ul>${Array.from({ length: count }, (_, i) => `<li><button>Item ${i}</button></li>`).join('')}</ul>`;
    const text = outline(document, { header: false })!.text;
    expect(text).toContain('button "Item 2"');
    if (count >= 8) {
      expect(text).not.toContain('Item 3');
      expect(text).toContain(`… ${count - 3} more similar items`);
    } else {
      expect(text).toContain('Item 6');
      expect(text).not.toContain('more similar');
    }
  },
);

it('supports custom repetition settings and nested card controls', () => {
  document.body.innerHTML = `<div>${Array.from({ length: 4 }, (_, i) => `<article role="button">Card ${i}<button>Share ${i}</button></article>`).join('')}</div>`;
  expect(
    outline(document, { header: false, repeatMin: 4, repeatKeep: 1 })?.lines,
  ).toEqual([
    'button "Card 0"',
    '  button "Share 0"',
    '… 3 more similar items',
  ]);
});

it('summarises table columns, row count and a sample of actions', () => {
  document.body.innerHTML = `<table><caption>People</caption><thead><tr><th>Name</th><th>Action</th></tr></thead><tbody>${Array.from({ length: 10 }, (_, i) => `<tr><td>Person ${i}</td><td><button>Edit ${i}</button></td></tr>`).join('')}</tbody></table>`;
  expect(outline(document, { header: false })?.lines).toEqual([
    'table "People": columns Name | Action; 10 rows',
    '  button "Edit 0"',
    '  button "Edit 1"',
    '  button "Edit 2"',
    '  … 7 more similar items',
  ]);
});

it('reports safe link destinations without query strings or fragments', () => {
  document.body.innerHTML = `<a href="/local?q=secret#hash">Local</a><a href="https://external.test/docs?q=secret">Docs</a><a href="mailto:private@example.test">Email</a><a href="javascript:alert(1)">Script</a><a href="data:text/plain,secret">Data</a><a href="#section">Jump</a>`;
  expect(outline(document, { header: false, location })?.lines).toEqual([
    'link "Local" → /local',
    'link "Docs" → external.test/docs',
    'link "Email" → email link',
    'link "Script"',
    'link "Data"',
    'link "Jump"',
  ]);
});

it('keeps only configured query parameters and permits a custom address', () => {
  document.body.innerHTML = '<button>Go</button>';
  const opts = {
    location: {
      ...location,
      search: '?tab=hello+world&token=secret&view=grid',
    },
  };
  expect(outline(document, opts)?.lines[0]).toBe('Page: /x?tab=hello%20world');
  expect(outline(document, { ...opts, keepParams: ['view'] })?.lines[0]).toBe(
    'Page: /x?view=grid',
  );
  expect(
    outline(document, { ...opts, pageAddress: (loc) => loc.pathname })
      ?.lines[0],
  ).toBe('Page: /x');
});

it('caps output with the truncation marker and reports element-budget exhaustion', () => {
  document.body.innerHTML = Array.from(
    { length: 60 },
    (_, i) => `<button>Action ${i}</button>`,
  ).join('');
  const result = outline(document, { header: false, maxChars: 150 })!;
  expect(result.text.length).toBeLessThanOrEqual(150);
  expect(result.text.endsWith('… (outline truncated)')).toBe(true);
  expect(result.stats.truncated).toBe(true);
  expect(
    outline(document, { header: false, maxElements: 3 })?.stats.truncated,
  ).toBe(true);
});

it('returns null when there is no useful content', () => {
  document.body.innerHTML = '<main><div></div></main>';
  expect(outline(document, { location })).toBeNull();
});

it('reports fixed select, slider and progress values with mixed and pressed states', () => {
  document.body.innerHTML = `<label>Language<select><option selected>English</option></select></label><input type="range" aria-label="Volume" min="1" max="10" value="4"><div role="progressbar" aria-label="Upload" aria-valuetext="Halfway"></div><button role="checkbox" aria-checked="mixed">All</button><button aria-pressed="true">Bold</button>`;
  expect(outline(document, { header: false })?.lines).toEqual([
    'combobox "Language" = "English"',
    'slider "Volume" = "4 (range 1 to 10)"',
    'progressbar "Upload" = "Halfway"',
    'checkbox "All" [mixed]',
    'button "Bold" [pressed]',
  ]);
});

it('uses nearby labels and configured hints for otherwise unnamed controls', () => {
  document.body.innerHTML =
    '<div><span>Watermark</span><button role="switch" aria-checked="false"></button></div><div><div><div><button data-action="save"></button></div></div></div>';
  expect(
    outline(document, { header: false, hintAttribute: 'data-action' })?.lines,
  ).toEqual([
    'switch near "Watermark" [off]',
    'button (unlabelled, data-action save)',
  ]);
});
