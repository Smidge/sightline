/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSightline, outline } from '../src';
import basket from './fixtures/basket-repeated.html?raw';
import checkout from './fixtures/checkout-long.html?raw';
import validation from './fixtures/validation.html?raw';

const FIXTURES = {
  'basket-repeated.html': basket,
  'checkout-long.html': checkout,
  'validation.html': validation,
};

function load(name: keyof typeof FIXTURES) {
  const parsed = new DOMParser().parseFromString(FIXTURES[name], 'text/html');
  document.title = parsed.title;
  document.body.innerHTML = parsed.body.innerHTML;
}

afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
});

describe('validation evidence', () => {
  it('keeps descriptions and explicit errors apart without inventing causes', () => {
    load('validation.html');
    expect(outline(document, { header: false })?.lines).toEqual([
      'main',
      '  h1 "Create API key"',
      '  form "New key"',
      '    textbox "Key name" [required, empty, invalid] — "Shown in your audit log." — error "Enter a key name."',
      '    textbox "Scope" — "Comma-separated scopes. 1 of 10 scopes used."',
      '    textbox "Note" [empty] — "Only you can see this."',
      '    textbox "Expires" [empty]',
      '    textbox "Allowed IPs" [empty, invalid] — error "Enter IP addresses as 203.0.113.7 or 203.0.113.0/24."',
      '    textbox "Owner email" [empty, invalid] — error "[email] is not a member of this team."',
      // Disabled with no stated reason: the empty required field above is
      // evidence, not an explanation, so nothing links the two.
      '    button "Create key" [disabled]',
      '    button "Rotate key" [disabled] — "You need the Admin role to rotate keys."',
    ]);
  });

  it('reads aria-errormessage only while the field is invalid', () => {
    document.body.innerHTML =
      '<input aria-label="Code" aria-errormessage="e"><p id="e">Enter the 6 digit code.</p>';
    const input = document.querySelector('input')!;
    expect(outline(document, { header: false })?.text).toBe('textbox "Code" [empty]');
    input.setAttribute('aria-invalid', 'false');
    expect(outline(document, { header: false })?.text).toBe('textbox "Code" [empty]');
    input.setAttribute('aria-invalid', 'true');
    expect(outline(document, { header: false })?.text).toBe(
      'textbox "Code" [empty, invalid] — error "Enter the 6 digit code."',
    );
    // A validation message that changes is read afresh on the next capture.
    document.getElementById('e')!.textContent = 'That code has expired.';
    expect(outline(document, { header: false })?.text).toBe(
      'textbox "Code" [empty, invalid] — error "That code has expired."',
    );
  });

  it('reads each referenced ID once, in order, and ignores missing ones', () => {
    document.body.innerHTML =
      '<input aria-label="Name" aria-describedby="b missing a b"><p id="a">First.</p><p id="b">Second.</p>';
    expect(outline(document, { header: false })?.text).toBe(
      'textbox "Name" [empty] — "Second. First."',
    );
  });

  it('falls back to aria-description', () => {
    document.body.innerHTML =
      '<button aria-description="Sends the invoice to the customer">Send</button>';
    expect(outline(document, { header: false })?.text).toBe(
      'button "Send" — "Sends the invoice to the customer"',
    );
  });

  it('never reads typed values or skipped subtrees through a reference', () => {
    document.body.innerHTML = `
      <input aria-label="Card" aria-describedby="typed edit panel hint" aria-invalid="true" aria-errormessage="panel">
      <input id="typed" value="4242 4242 4242 4242">
      <div id="edit" contenteditable>private draft</div>
      <aside class="agent"><p id="panel">Assistant: the card number is 4242</p></aside>
      <p id="hint">Visa or Mastercard.</p>`;
    const result = outline(document, { header: false, skip: '.agent' })!;
    expect(result.lines[0]).toBe(
      'textbox "Card" [empty, invalid] — "Visa or Mastercard."',
    );
    expect(result.text).not.toMatch(/4242|draft|Assistant/);
  });

  it('applies redaction and length limits to descriptions, errors and notes', () => {
    const long = 'x'.repeat(400);
    document.body.innerHTML = `<input aria-label="Email" aria-invalid="true" aria-describedby="d" aria-errormessage="e"><p id="d">Contact sam@example.com or ACC-123456 ${long}</p><p id="e">ACC-123456 is locked</p>`;
    const result = outline(document, {
      header: false,
      redact: (text) => text.replace(/ACC-\d+/g, '[account]'),
      annotate: () => `Ask ops@example.com about ACC-999999 ${long}`,
    })!;
    expect(result.text).not.toMatch(/@example|ACC-/);
    const [, description, error, note] = /— "(.*)" — error "(.*)" — note "(.*)"$/.exec(
      result.text,
    )!;
    expect(description.startsWith('Contact [email] or [account]')).toBe(true);
    expect(description.length).toBeLessThanOrEqual(240);
    expect(error).toBe('[account] is locked');
    expect(note.length).toBeLessThanOrEqual(240);
  });
});

describe('annotate', () => {
  it('adds a product note to listed controls only', () => {
    document.body.innerHTML = `
      <button disabled id="place">Place order</button>
      <button hidden>Hidden</button>
      <aside class="agent"><button>Agent action</button></aside>`;
    const annotate = vi.fn((element: Element, role: string) =>
      element.id === 'place' ? `${role}: add a delivery address first` : null,
    );
    expect(outline(document, { header: false, skip: '.agent', annotate })?.text).toBe(
      'button "Place order" [disabled] — note "button: add a delivery address first"',
    );
    expect(annotate.mock.calls.map(([element]) => element.textContent)).toEqual([
      'Place order',
    ]);
  });

  it('ignores a failing or non-text hook', () => {
    document.body.innerHTML = '<button>Save</button><button>Cancel</button>';
    let calls = 0;
    const text = outline(document, {
      header: false,
      annotate: () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return 42 as unknown as string;
      },
    })?.text;
    expect(text).toBe('button "Save"\nbutton "Cancel"');
  });

  it('flows through createSightline captures', () => {
    document.body.innerHTML = '<button disabled>Export</button>';
    const sightline = createSightline({
      header: false,
      annotate: () => 'Exports need a paid plan',
    });
    expect(sightline.capture()?.text).toBe(
      'button "Export" [disabled] [ref=e1] — note "Exports need a paid plan"',
    );
  });
});

describe('frames', () => {
  function frames(html: string) {
    document.body.innerHTML = `<button>Pay</button>${html}`;
    return [...document.querySelectorAll('iframe')];
  }
  const unreadable = (frame: HTMLIFrameElement) =>
    Object.defineProperty(frame, 'contentDocument', { get: () => null });
  const failing = (frame: HTMLIFrameElement) =>
    Object.defineProperty(frame, 'contentDocument', {
      get: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });

  it('mentions frames without infer instead of dropping them', () => {
    frames('<iframe title="Card number"></iframe><iframe></iframe>');
    const result = outline(document, { header: false })!;
    expect(result.lines).toEqual([
      'button "Pay"',
      'frame "Card number" (contents not included)',
      'frame (unnamed, contents not included)',
    ]);
    expect(result.stats.framesNotRead).toBe(2);
  });

  it('reads reachable frames with infer and says when others are not readable', () => {
    const [same, other, blocked, unnamed] = frames(
      '<iframe title="Help"></iframe><iframe title="Card number"></iframe><iframe title="Receipt"></iframe><iframe></iframe>',
    );
    same.contentDocument!.body.innerHTML = '<button>Chat</button>';
    unreadable(other);
    failing(blocked);
    unreadable(unnamed);
    const result = outline(document, { header: false, infer: true })!;
    expect(result.lines).toEqual([
      'button "Pay"',
      'frame "Help"',
      '  button "Chat"',
      'frame "Card number" (contents not readable)',
      'frame "Receipt" (contents not readable)',
      'frame (unnamed, contents not readable)',
    ]);
    expect(result.text).not.toMatch(/another site/);
    expect(result.stats.framesNotRead).toBe(3);
  });

  it('leaves out tracking-sized, hidden and skipped frames', () => {
    const [pixel] = frames(
      '<iframe title="Pixel"></iframe><iframe title="Hidden" hidden></iframe><iframe title="Agent" class="agent"></iframe>',
    );
    pixel.getBoundingClientRect = () => ({ width: 1, height: 1 }) as DOMRect;
    const result = outline(document, { header: false, skip: '.agent' })!;
    expect(result.text).toBe('button "Pay"');
    expect(result.stats.framesNotRead).toBe(0);
  });

  it('lists a bounded number of frames and counts the rest', () => {
    frames(Array.from({ length: 11 }, (_, i) => `<iframe title="Ad ${i}"></iframe>`).join(''));
    const result = outline(document, { header: false })!;
    expect(result.lines.filter((line) => line.startsWith('frame'))).toHaveLength(8);
    expect(result.lines.at(-1)).toBe('… (3 more frames not listed)');
    expect(result.stats.framesNotRead).toBe(11);
  });
});

describe('evidence within the budget', () => {
  it('keeps an error found after the cut in a long form', () => {
    load('checkout-long.html');
    const sightline = createSightline({ location: { pathname: '/checkout', origin: 'https://shop.test' } });
    const result = sightline.capture()!;
    expect(result.text.length).toBeLessThanOrEqual(6000);
    expect(result.stats.truncatedBy).toBe('characters');
    const cut = result.lines.indexOf('… (outline truncated: character limit)');
    expect(cut).toBeGreaterThan(0);
    expect(result.lines[cut + 1]).toBe('Errors and alerts after the cut:');
    const [line] = result.lines.slice(cut + 2);
    expect(line).toMatch(
      /^ {2}checkbox "I accept the terms and conditions" \[unchecked, required, invalid\] \[ref=e\d+\] — error "Accept the terms and conditions to place your order."$/,
    );
    // The reported control can be acted on.
    const ref = /ref=(e\d+)/.exec(line)![1];
    expect(sightline.resolve(ref)).toBe(document.getElementById('terms'));
    // Every ref in the text resolves, and no ref is kept for a dropped line.
    const refs = [...result.text.matchAll(/ref=(e\d+)/g)].map((match) => match[1]);
    expect([...result.refs.keys()].sort()).toEqual([...new Set(refs)].sort());
  });

  it('keeps the one exceptional row a repeated list would hide', () => {
    load('basket-repeated.html');
    const lines = outline(document, { header: false })!.lines;
    expect(lines).toContain(
      '    spinbutton "Quantity for Beanie 22" [invalid] — error "Only 2 left in stock. Reduce the quantity to continue."',
    );
    expect(lines).toContain('    button "Remove Beanie 22"');
    expect(lines).toContain('    … 26 more similar items');
    expect(lines.at(-1)).toBe(
      '  button "Checkout" [disabled] — "Fix the highlighted items to continue."',
    );
  });

  it('does not keep a row for a hidden alert inside it', () => {
    const rows = Array.from(
      { length: 10 },
      (_, i) =>
        `<li><button>Item ${i}</button>${i === 7 ? '<div role="alert" hidden>Out of stock</div>' : ''}</li>`,
    ).join('');
    document.body.innerHTML = `<ul>${rows}</ul>`;
    expect(outline(document, { header: false })?.lines).toEqual([
      'button "Item 0"',
      'button "Item 1"',
      'button "Item 2"',
      '… 7 more similar items',
    ]);
  });

  it('does not bring back skipped, hidden or background evidence after a cut', () => {
    const filler = Array.from({ length: 80 }, (_, i) => `<button>Action ${i}</button>`).join('');
    document.body.innerHTML = `<main>${filler}
      <aside class="agent"><input aria-label="Agent field" aria-invalid="true"></aside>
      <div role="alert" hidden>Old alert</div>
      <div aria-hidden="true"><input aria-label="Behind modal" aria-invalid="true"></div>
      <input aria-label="Postcode" aria-invalid="true" aria-errormessage="pc"><p id="pc">Enter a postcode.</p>
      <div role="alert">Payment failed</div></main>`;
    const result = outline(document, { header: false, skip: '.agent', maxChars: 800 })!;
    expect(result.text.length).toBeLessThanOrEqual(800);
    expect(result.lines.slice(-3)).toEqual([
      'Errors and alerts after the cut:',
      '  textbox "Postcode" [empty, invalid] — error "Enter a postcode."',
      '  alert "Payment failed"',
    ]);
    expect(result.text).not.toMatch(/Agent field|Old alert|Behind modal/);
  });

  it('keeps late evidence when the element budget runs out, within bounds', () => {
    const filler = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i}</p>`).join('');
    const errors = Array.from(
      { length: 30 },
      (_, i) => `<input aria-label="Field ${i}" aria-invalid="true">`,
    ).join('');
    document.body.innerHTML = `<main><button>Start</button>${filler}${errors}</main>`;
    const result = outline(document, { header: false, maxElements: 20, maxChars: 2000 })!;
    expect(result.stats.truncatedBy).toBe('elements');
    expect(result.text.length).toBeLessThanOrEqual(2000);
    const late = result.lines.slice(result.lines.indexOf('Errors and alerts after the cut:') + 1);
    expect(late.length).toBeGreaterThan(0);
    expect(late.length).toBeLessThanOrEqual(8);
    expect(late[0]).toBe('  textbox "Field 0" [empty, invalid]');
  });

  it('says nothing about errors it did not find', () => {
    document.body.innerHTML = Array.from({ length: 60 }, (_, i) => `<button>Action ${i}</button>`).join('');
    const result = outline(document, { header: false, maxChars: 300 })!;
    expect(result.lines.at(-1)).toBe('… (outline truncated: character limit)');
    expect(result.text).not.toMatch(/Errors and alerts/);
  });
});
