/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { describeElement, findControl, outline } from '../src';

afterEach(() => {
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
  document.body.removeAttribute('onclick');
  document.title = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['attribute', 'property', 'React', 'Vue', 'jQuery'])(
  'recognises a %s click handler without invoking it',
  (kind) => {
    const element = document.createElement('div');
    element.textContent = 'Open account';
    document.body.append(element);
    const handler = vi.fn();
    if (kind === 'attribute') element.setAttribute('onclick', 'openAccount()');
    if (kind === 'property') element.onclick = handler;
    if (kind === 'React')
      Object.assign(element, { __reactProps$test: { onClick: handler } });
    if (kind === 'Vue') Object.assign(element, { _vei: { onClick: handler } });
    if (kind === 'jQuery') {
      vi.stubGlobal('jQuery', {
        _data: (target: Element, key: string) =>
          target === element && key === 'events'
            ? { click: [handler] }
            : undefined,
      });
    }
    expect(outline(document, { header: false, infer: true })?.lines).toEqual([
      'clickable "Open account"',
    ]);
    expect(handler).not.toHaveBeenCalled();
    expect(outline(document, { header: false })).toBeNull();
  },
);

it('does not mistake non-function React props for handlers', () => {
  const element = document.createElement('div');
  element.textContent = 'Static';
  Object.assign(element, { __reactProps$test: { onClick: null } });
  document.body.append(element);
  expect(outline(document, { header: false, infer: true })).toBeNull();
});

it('lists only the start of an inherited pointer cursor', () => {
  document.body.innerHTML =
    '<div style="cursor:pointer"><span><span>Open account</span></span></div>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'clickable "Open account"',
  ]);
});

it('recognises a fresh pointer cursor after a default-cursor boundary', () => {
  document.body.innerHTML =
    '<div style="cursor:pointer" aria-label="Card"><div style="cursor:default"><span style="cursor:pointer">Share</span></div></div>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'clickable "Card"',
    '  clickable "Share"',
  ]);
});

it('retains explicit nested handlers even under an inherited pointer', () => {
  document.body.innerHTML =
    '<div style="cursor:pointer" aria-label="Card"><span onclick="share()">Share</span></div>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'clickable "Card"',
    '  clickable "Share"',
  ]);
});

it('does not turn pointer-styled input labels into controls', () => {
  document.body.innerHTML =
    '<label for="email" onclick="track()" style="cursor:pointer">Email</label><input id="email"><label style="cursor:pointer" onclick="track()">Consent<input type="checkbox"></label>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'textbox "Email" [empty]',
    'checkbox "Consent" [unchecked]',
  ]);
});

it('does not turn pointer wrappers around real buttons into controls', () => {
  document.body.innerHTML =
    '<div style="cursor:pointer"><span><button>Save</button></span></div>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'button "Save"',
  ]);
});

it('does not turn modal containers holding fields into controls', () => {
  document.body.innerHTML =
    '<div style="position:fixed;cursor:pointer" onclick="event.stopPropagation()"><input aria-label="Email"><button>Save</button></div>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'textbox "Email" [empty]',
    'button "Save"',
  ]);
});

it('does not infer body or main as click targets', () => {
  document.body.setAttribute('onclick', 'dismiss()');
  document.body.style.cursor = 'pointer';
  document.body.innerHTML =
    '<main onclick="dismiss()" style="cursor:pointer"><button>Save</button></main>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'main',
    '  button "Save"',
  ]);
});

it.each([
  ['data-tooltip="Close window"', '', 'Close window', 'tooltip'],
  ['', '<i class="fa-solid fa-magnifying-glass"></i>', 'search', 'icon'],
  ['', '<i class="lucide lucide-x"></i>', 'close', 'icon'],
  ['', '<svg><use href="#icon-x"></use></svg>', 'close', 'icon'],
  ['', '<svg data-testid="DeleteOutlineIcon"></svg>', 'delete', 'icon'],
  [
    '',
    '<img src="/assets/download@2x.png?token=secret#hash">',
    'download',
    'image file name',
  ],
  ['data-testid="saveChangesButton"', '', 'save changes', 'test id'],
  ['name="submitOrder"', '', 'submit order', 'name attribute'],
  ['id="open-settings"', '', 'open settings', 'id'],
  ['class="css-1x2y3z-CloseButton"', '', 'close', 'class name'],
])('guesses %s %s as %s from %s', (attributes, content, name, source) => {
  document.body.innerHTML = `<button ${attributes}>${content}</button>`;
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    `button "${name}" (guessed from ${source})`,
  ]);
});

it('ignores Tailwind utilities and opaque hashes when guessing names', () => {
  document.body.innerHTML =
    '<button class="flex items-center justify-between p-2 w-full text-sm font-bold bg-blue-500 rounded-lg hover:bg-blue-600 md:inline-flex sr-only shadow-sm transition-all duration-150 [&>svg]:size-4 css-1x2y3z"></button>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'button',
  ]);
});

it('keeps explicit names ahead of tooltip and icon guesses', () => {
  document.body.innerHTML =
    '<button aria-label="Dismiss preview" data-tooltip="Close"><i class="fa-times"></i></button><button data-tooltip="Delete">Keep</button>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'button "Dismiss preview"',
    'button "Keep"',
  ]);
});

it('maps symbol-only names without changing ordinary text containing symbols', () => {
  document.body.innerHTML = '<button>×</button><button>Next →</button>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'button "close" (guessed from ×)',
    'button "Next →"',
  ]);
});

it('infers heading levels from inline font sizes and weight', () => {
  document.body.style.fontSize = '16px';
  document.body.innerHTML =
    '<div style="font-size:32px;font-weight:700">Overview</div><div style="font-size:24px;font-weight:700">Details</div><div style="font-size:20px;font-weight:600">Notes</div><div style="font-size:20px;font-weight:400">Ordinary text</div>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'h1 "Overview"',
    'h2 "Details"',
    'h3 "Notes"',
  ]);
});

it('keeps large buttons as buttons and does not infer headings around controls', () => {
  document.body.innerHTML =
    '<div style="font-size:32px;font-weight:700"><input aria-label="Query"></div><button style="font-size:32px;font-weight:700">Search</button>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'textbox "Query" [empty]',
    'button "Search"',
  ]);
});

it('uses preceding field text ahead of weak identifier guesses', () => {
  document.body.innerHTML =
    '<div>Email</div><input id="account-input"><div>Password</div><div><input type="password" id="credential-input"></div>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'textbox near "Email" [empty]',
    'textbox near "Password" [empty]',
  ]);
});

it('never exposes typed values through guesses, preceding text or clickable names', () => {
  document.body.innerHTML =
    '<input type="password"><textarea>private-draft</textarea><input><div contenteditable="true">private-edit</div><input><button data-tooltip="Save draft"></button>';
  const inputs = document.querySelectorAll('input');
  inputs[0].value = 'private-password';
  inputs[1].value = 'private-email';
  inputs[2].value = 'private-query';
  document.querySelector('textarea')!.value = 'private-updated-draft';
  const result = outline(document, { header: false, infer: true })!;
  expect(result.lines).toEqual([
    'textbox',
    'textbox',
    'textbox',
    'textbox',
    'textbox',
    'button "Save draft" (guessed from tooltip)',
  ]);
  for (const field of document.querySelectorAll(
    'input, textarea, [contenteditable]',
  )) {
    expect(describeElement(field, { infer: true })?.name).toBe('');
  }
  expect(findControl('private', { infer: true })).toBeNull();
});

it('preserves the exact legacy outline with infer omitted or false', () => {
  document.body.innerHTML =
    '<main><div style="font-size:32px;font-weight:700">Dashboard</div><div onclick="open()">Open account</div><div style="cursor:pointer">Settings</div><button><i class="fa-times"></i></button><input aria-label="Email"><button>×</button></main>';
  const expected =
    'main\n  button near "Dashboard Open account Settings"\n  textbox "Email" [empty]\n  button "×"';
  const implicit = outline(document, { header: false })!;
  const explicit = outline(document, { header: false, infer: false })!;
  expect(implicit.text).toBe(expected);
  expect(explicit.text).toBe(expected);
  expect(explicit.lines).toEqual(implicit.lines);
  expect(outline(document, { header: false, infer: true })?.text).not.toBe(
    expected,
  );
});

it('describes a click on a descendant of an inferred control', () => {
  document.body.innerHTML =
    '<div style="cursor:pointer" data-action="open"><span>Open account</span></div>';
  const target = document.querySelector('span')!;
  expect(describeElement(target)).toBeNull();
  expect(
    describeElement(target, { infer: true, hintAttribute: 'data-action' }),
  ).toEqual({
    role: 'clickable',
    name: 'Open account',
    hint: 'open',
    element: target.parentElement,
  });
});

it('describes an inferred icon-only clickable by its guessed name', () => {
  document.body.innerHTML =
    '<div onclick="close()"><i class="fa-times"></i></div>';
  const target = document.querySelector('i')!;
  expect(describeElement(target, { infer: true })).toMatchObject({
    role: 'clickable',
    name: 'close',
    element: target.parentElement,
  });
});

it('describes a semantic icon button by the name shown in the inferred outline', () => {
  document.body.innerHTML = '<button><i class="fa-times"></i></button>';
  expect(outline(document, { header: false, infer: true })?.text).toBe(
    'button "close" (guessed from icon)',
  );
  expect(
    describeElement(document.querySelector('i'), { infer: true })?.name,
  ).toBe('close');
});

it('finds clickable text and guessed clickable names only with infer enabled', () => {
  document.body.innerHTML =
    '<div onclick="open()">Open account</div><div style="cursor:pointer"><i class="fa-times"></i></div>';
  const [open, close] = document.querySelectorAll('div');
  expect(findControl('Open account')).toBeNull();
  expect(findControl('close')).toBeNull();
  expect(findControl('  OPEN   account ', { infer: true })).toBe(open);
  expect(findControl('close', { infer: true })).toBe(close);
});

it('finds a semantic button by its guessed icon name', () => {
  document.body.innerHTML =
    '<button><svg data-testid="DeleteOutlineIcon"></svg></button>';
  expect(findControl('delete', { infer: true, role: 'button' })).toBe(
    document.querySelector('button'),
  );
});

it('finds a symbol-only clickable by the mapped name shown in the outline', () => {
  document.body.innerHTML = '<div onclick="close()">×</div>';
  expect(outline(document, { header: false, infer: true })?.text).toBe(
    'clickable "close" (guessed from ×)',
  );
  expect(findControl('close', { infer: true })).toBe(
    document.querySelector('div'),
  );
});

it('honours a clickable role filter for inferred controls', () => {
  document.body.innerHTML = '<div onclick="open()">Open</div>';
  expect(findControl('Open', { infer: true, role: 'clickable' })).toBe(
    document.querySelector('div'),
  );
});

it('prefers an exact clickable name over a partial semantic name', () => {
  document.body.innerHTML =
    '<button>Open settings</button><div onclick="open()">Open</div>';
  expect(findControl('Open', { infer: true })).toBe(
    document.querySelector('div'),
  );
});

it('omits hidden and skipped inferred controls from outline and lookup', () => {
  document.body.innerHTML =
    '<div hidden onclick="hide()">Hidden</div><div class="agent"><div onclick="skip()">Assistant</div></div><div onclick="open()">Open</div>';
  expect(
    outline(document, { header: false, infer: true, skip: '.agent' })?.lines,
  ).toEqual(['clickable "Open"']);
  expect(findControl('Hidden', { infer: true })).toBeNull();
  expect(findControl('Assistant', { infer: true, skip: '.agent' })).toBeNull();
});

it('reads shadow controls and assigned slot text once, excluding unused light DOM', () => {
  const host = document.createElement('div');
  host.innerHTML =
    '<span slot="label">Launch</span><button slot="unused">Unused</button>';
  host.attachShadow({ mode: 'open' }).innerHTML =
    '<button><slot name="label">Fallback</slot></button><div onclick="close()">Close</div>';
  document.body.append(host);
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'button "Launch"',
    'clickable "Close"',
  ]);
});

it('uses fallback slot text when no content is assigned', () => {
  const host = document.createElement('div');
  host.attachShadow({ mode: 'open' }).innerHTML =
    '<button><slot>Fallback</slot></button>';
  document.body.append(host);
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'button "Fallback"',
  ]);
});

it('resolves shadow-local label references rather than colliding document ids', () => {
  document.body.innerHTML = '<span id="label">Wrong</span><div></div>';
  document.querySelector('div')!.attachShadow({ mode: 'open' }).innerHTML =
    '<span id="label">Right</span><input aria-labelledby="label">';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'textbox "Right" [empty]',
  ]);
});

it('finds controls exposed by the inferred shadow outline', () => {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<button>Launch</button>';
  document.body.append(host);
  expect(outline(document, { header: false, infer: true })?.text).toBe(
    'button "Launch"',
  );
  expect(findControl('Launch', { infer: true })).toBe(
    shadow.querySelector('button'),
  );
});

it('reads same-origin iframe controls only with infer enabled', () => {
  document.body.innerHTML =
    '<button>Outside</button><iframe title="Editor"></iframe>';
  const frame = document.querySelector('iframe')!;
  expect(frame.contentDocument).not.toBeNull();
  frame.contentDocument!.body.innerHTML =
    '<div onclick="save()">Save document</div>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'button "Outside"',
    'frame "Editor"',
    '  clickable "Save document"',
  ]);
  // Without infer the frame is still mentioned, so its absence is visible.
  expect(outline(document, { header: false, infer: false })?.lines).toEqual([
    'button "Outside"',
    'frame "Editor" (contents not included)',
  ]);
});

it('honours skip on an iframe before reading its content', () => {
  document.body.innerHTML =
    '<button>Outside</button><iframe class="agent" title="Assistant"></iframe>';
  document.querySelector('iframe')!.contentDocument!.body.innerHTML =
    '<button>Private assistant action</button>';
  expect(
    outline(document, { header: false, infer: true, skip: '.agent' })?.lines,
  ).toEqual(['button "Outside"']);
});

it('does not read a large bold price as a heading', () => {
  document.body.innerHTML =
    '<div style="font-size:32px;font-weight:700">Price £ 49</div><div style="font-size:32px;font-weight:700">Summer sale</div>';
  expect(outline(document, { header: false, infer: true })?.lines).toEqual([
    'h1 "Summer sale"',
  ]);
});
