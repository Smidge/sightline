import { describe, expect, it } from 'vitest';

import { tokenize } from './outline-view.js';
import { ReadError, looksBlocked, parseAddress, preparePage } from './page.js';

function prepared(html: string, address = 'https://shop.example/sale/') {
  return new DOMParser().parseFromString(preparePage(html, address), 'text/html');
}

describe('parseAddress', () => {
  it('adds https to a bare host', () => {
    expect(parseAddress(' gov.uk ').href).toBe('https://gov.uk/');
  });

  it('keeps an explicit http address', () => {
    expect(parseAddress('http://example.com/a?b=1').href).toBe('http://example.com/a?b=1');
  });

  it('refuses other schemes and non-addresses', () => {
    expect(() => parseAddress('ftp://example.com')).toThrow(ReadError);
    expect(() => parseAddress('javascript:alert(1)')).toThrow(ReadError);
    expect(() => parseAddress('hello')).toThrow(ReadError);
    expect(() => parseAddress('')).toThrow('Enter a web address first.');
  });
});

describe('preparePage', () => {
  it('removes scripts, refreshes, preloads and policies', () => {
    const doc = prepared(`<!doctype html><html><head>
      <meta http-equiv="refresh" content="0;url=/elsewhere">
      <meta http-equiv="Content-Security-Policy" content="img-src 'self'">
      <link rel="modulepreload" href="/app.js"><link rel="preload" as="script" href="/a.js">
      <script src="/app.js"></script></head>
      <body><script>alert(1)</script><button onclick="buy()">Buy</button></body></html>`);
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('meta[http-equiv]')).toBeNull();
    expect(doc.querySelector('link[rel="modulepreload"], link[as="script"]')).toBeNull();
    // Inline handlers stay: scripts can't run in the frame, and infer reads them.
    expect(doc.querySelector('button')?.getAttribute('onclick')).toBe('buy()');
  });

  it('points relative URLs at the original site and sends no referrer', () => {
    const doc = prepared('<html><head><title>Sale</title></head><body><img src="a.png"></body></html>');
    const [base, referrer] = doc.head.children;
    expect(base.getAttribute('href')).toBe('https://shop.example/sale/');
    expect(referrer.getAttribute('name')).toBe('referrer');
    expect(referrer.getAttribute('content')).toBe('no-referrer');
  });

  it('resolves a base the page declared against its address', () => {
    const doc = prepared('<html><head><base href="/assets/"></head><body></body></html>');
    const bases = doc.querySelectorAll('base');
    expect(bases).toHaveLength(1);
    expect(bases[0].getAttribute('href')).toBe('https://shop.example/assets/');
  });

  it('keeps stylesheets from noscript and drops the rest of it', () => {
    const doc = prepared(`<html><head><noscript><link rel="stylesheet" href="/no-js.css"></noscript></head>
      <body><noscript><p>Please enable JavaScript</p></noscript><p>Hello</p></body></html>`);
    expect(doc.querySelector('noscript')).toBeNull();
    expect(doc.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe('/no-js.css');
    expect(doc.body.textContent).not.toContain('enable JavaScript');
  });

  it('applies stylesheets that were waiting for an onload handler', () => {
    const doc = prepared(`<html><head>
      <link rel="preload" as="style" href="/late.css" onload="this.rel='stylesheet'">
      <link rel="stylesheet" media="print" href="/print-trick.css" onload="this.media='all'">
      <link rel="stylesheet" href="/cdn.css" integrity="sha384-x" crossorigin="anonymous">
      </head><body></body></html>`);
    const links = [...doc.querySelectorAll('link')];
    expect(links[0].getAttribute('rel')).toBe('stylesheet');
    expect(links[1].getAttribute('media')).toBe('all');
    expect(links[2].hasAttribute('integrity')).toBe(false);
    expect(links[2].hasAttribute('crossorigin')).toBe(false);
  });

  it('empties and isolates embedded frames but keeps their titles', () => {
    const doc = prepared(
      '<html><body><iframe src="about:blank" srcdoc="<p>Ad</p>" title="Product video"></iframe></body></html>',
    );
    const frame = doc.querySelector('iframe')!;
    expect(frame.hasAttribute('src')).toBe(false);
    expect(frame.hasAttribute('srcdoc')).toBe(false);
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('title')).toBe('Product video');
  });

  it('swaps in lazy-loaded images', () => {
    const doc = prepared('<html><body><img src="data:image/gif;base64,R0lG" data-src="/real.jpg" alt="Shoes"></body></html>');
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('/real.jpg');
  });

  it('keeps quirks mode for pages without a doctype', () => {
    expect(preparePage('<html><body>Old</body></html>', 'https://a.example/')).not.toMatch(/^<!doctype/i);
    expect(preparePage('<!doctype html><html><body>New</body></html>', 'https://a.example/')).toMatch(/^<!doctype html>/);
  });
});

describe('looksBlocked', () => {
  it('spots a bot check by its title', () => {
    const doc = new DOMParser().parseFromString('<title>Just a moment...</title><body></body>', 'text/html');
    expect(looksBlocked(doc)).toBe(true);
  });

  it('leaves an ordinary page alone', () => {
    const doc = new DOMParser().parseFromString('<title>Shoes</title><body><h1>Shoes</h1></body>', 'text/html');
    expect(looksBlocked(doc)).toBe(false);
  });
});

describe('tokenize', () => {
  const kinds = (line: string) =>
    tokenize(line)
      .filter((token) => token.kind)
      .map((token) => `${token.kind}:${token.text}`);

  it('marks the parts of a control line', () => {
    expect(
      kinds('link "API keys" → /settings/api-keys [current] [ref=e2] — "Your keys"'),
    ).toEqual([
      'role:link',
      'name:"API keys"',
      'target:→ /settings/api-keys',
      'state:[current]',
      'ref:[ref=e2]',
      'dash: — ',
      'name:"Your keys"',
    ]);
  });

  it('marks header keys and guesses', () => {
    expect(kinds('Scroll: top, more below')).toEqual(['key:Scroll:']);
    expect(kinds('clickable "close" (guessed from ×) [ref=e2]')).toEqual([
      'role:clickable',
      'name:"close"',
      'note:(guessed from ×)',
      'ref:[ref=e2]',
    ]);
  });

  it('marks errors, notes and coverage notes', () => {
    expect(kinds('textbox "Key" [invalid] — "Hint." — error "Enter a key."')).toEqual([
      'role:textbox',
      'name:"Key"',
      'state:[invalid]',
      'dash: — ',
      'name:"Hint."',
      'dash: — error ',
      'name:"Enter a key."',
    ]);
    expect(kinds('frame (unnamed, contents not readable)')).toEqual([
      'role:frame',
      'note:(unnamed, contents not readable)',
    ]);
    expect(kinds('… (outline truncated: character limit)')).toEqual([
      'note:(outline truncated: character limit)',
    ]);
  });

  it('keeps every character', () => {
    const line = 'table: columns Name | Key; 9 rows';
    expect(tokenize(line).map((token) => token.text).join('')).toBe(line);
  });
});
