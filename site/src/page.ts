/**
 * Gets another site's HTML into this page so Sightline can read it. Browsers
 * can't fetch most sites directly, so the HTML comes through Jina Reader, a
 * free service that answers with CORS headers. The page is then rendered in a
 * sandboxed frame with its scripts off, and Sightline runs from here.
 */

export type FetchedPage = {
  html: string;
  /** The address the HTML came from, after any redirect we can see. */
  url: string;
  /** The site's HTTP status, when the route reports it. */
  status: number | null;
  via: 'reader' | 'direct' | 'sample' | 'pasted';
};

/** A failure worth showing to the visitor as it is. */
export class ReadError extends Error {}

const READER = 'https://r.jina.ai/';

export function parseAddress(raw: string): URL {
  const text = raw.trim();
  if (!text) throw new ReadError('Enter a web address first.');
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new ReadError(`"${text}" isn't a web address.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new ReadError('Only http and https addresses can be read.');
  if (!url.hostname.includes('.') && url.hostname !== 'localhost')
    throw new ReadError(`"${text}" isn't a web address.`);
  return url;
}

type ReaderBody = {
  code?: number;
  readableMessage?: string;
  data?: { html?: string; url?: string; httpStatus?: number } | null;
};

async function viaReader(url: URL, signal: AbortSignal): Promise<FetchedPage> {
  const response = await fetch(`${READER}${url.href}`, {
    headers: { accept: 'application/json', 'x-return-format': 'html' },
    credentials: 'omit',
    signal,
  });
  const body = (await response.json().catch(() => null)) as ReaderBody | null;
  const html = body?.data?.html;
  if (response.ok && html)
    return {
      html,
      url: body.data?.url || url.href,
      status: body.data?.httpStatus ?? null,
      via: 'reader',
    };
  const message = body?.readableMessage ?? '';
  if (response.status === 429)
    throw new ReadError(
      "The free page reader allows 20 pages a minute from each visitor. Wait a minute, or paste the page's HTML instead.",
    );
  if (/could not be resolved/i.test(message))
    throw new ReadError(`Couldn't find ${url.hostname}. Check the address.`);
  if (/localhost|non-public/i.test(message))
    throw new ReadError(
      'The reader only fetches public pages. For a local or signed-in app, use the bookmarklet below.',
    );
  throw new Error(`Reader answered ${response.status}: ${message}`);
}

/** The charset a response declares, so non-UTF-8 pages decode correctly. */
function charsetOf(contentType: string | null, bytes: Uint8Array): string {
  const header = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (header) return header;
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 2048));
  return /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8';
}

async function direct(url: URL, signal: AbortSignal): Promise<FetchedPage> {
  const response = await fetch(url.href, { credentials: 'omit', signal });
  const bytes = new Uint8Array(await response.arrayBuffer());
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charsetOf(response.headers.get('content-type'), bytes));
  } catch {
    decoder = new TextDecoder();
  }
  return {
    html: decoder.decode(bytes),
    url: response.url || url.href,
    status: response.status,
    via: 'direct',
  };
}

/**
 * The page's HTML: through the reader first, then directly for the sites
 * that allow it. Each route gets 25 seconds.
 */
export async function fetchPage(url: URL, signal: AbortSignal): Promise<FetchedPage> {
  const attempt = <T>(run: (signal: AbortSignal) => Promise<T>) =>
    run(AbortSignal.any([signal, AbortSignal.timeout(25_000)]));
  let readerError: unknown;
  try {
    return await attempt((s) => viaReader(url, s));
  } catch (error) {
    if (signal.aborted) throw error;
    readerError = error;
  }
  try {
    return await attempt((s) => direct(url, s));
  } catch (error) {
    if (signal.aborted) throw error;
  }
  if (readerError instanceof ReadError) throw readerError;
  throw new ReadError(
    "Couldn't fetch that page. The site may block the reader, or the reader may be down. Try another address, or paste the page's HTML.",
  );
}

/** Elements that run or fetch things a preview without scripts never needs. */
const DROPPED =
  'script, base, meta[http-equiv], meta[name="referrer"], object, embed, applet, portal, link[rel~="modulepreload"], link[rel~="prefetch"], link[rel~="prerender"], link[rel~="preconnect"], link[rel~="dns-prefetch"], link[rel~="manifest"], link[rel~="serviceworker"], link[rel~="preload"][as="script"], link[rel~="preload"][as="fetch"]';

/**
 * Turns fetched HTML into a document for a sandboxed frame without scripts:
 * styles and images load from the original site, while scripts, refreshes,
 * frames and preloads are removed.
 */
export function preparePage(html: string, address: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const head = doc.head;

  // A frame with scripts off would show <noscript> content that users with
  // scripts never see. Keep only the stylesheets sites put there.
  for (const noscript of doc.querySelectorAll('noscript')) {
    for (const style of noscript.querySelectorAll('link[rel~="stylesheet"], style'))
      noscript.before(style);
    noscript.remove();
  }

  let base = address;
  const declared = doc.querySelector('base[href]')?.getAttribute('href');
  if (declared) {
    try {
      base = new URL(declared, address).href;
    } catch {
      // Keep the page address.
    }
  }
  for (const element of doc.querySelectorAll(DROPPED)) element.remove();

  for (const link of doc.querySelectorAll('link')) {
    const onload = link.getAttribute('onload') ?? '';
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    // Stylesheets loaded late by an onload handler, which won't run here.
    if (rel.includes('preload') && link.getAttribute('as') === 'style' && /stylesheet/.test(onload))
      link.setAttribute('rel', 'stylesheet');
    else if (rel.includes('stylesheet') && link.getAttribute('media') === 'print' && /media/.test(onload))
      link.setAttribute('media', 'all');
    // Integrity and CORS checks fail for many sites once the page is moved.
    link.removeAttribute('integrity');
    link.removeAttribute('crossorigin');
  }

  // Lazy-loading scripts won't swap in real images; do it for them.
  for (const media of doc.querySelectorAll('img[data-src], img[data-srcset], source[data-srcset]')) {
    const src = media.getAttribute('data-src');
    const current = media.getAttribute('src') ?? '';
    if (src && (!current || current.startsWith('data:'))) media.setAttribute('src', src);
    const srcset = media.getAttribute('data-srcset');
    if (srcset && !media.getAttribute('srcset')) media.setAttribute('srcset', srcset);
  }

  // Embedded frames would load whole other sites. An empty, isolated frame
  // keeps its size and title, and reads as another site's frame.
  for (const frame of doc.querySelectorAll('iframe, frame')) {
    frame.removeAttribute('src');
    frame.removeAttribute('srcdoc');
    frame.setAttribute('sandbox', '');
  }

  for (const media of doc.querySelectorAll('video, audio')) {
    media.removeAttribute('autoplay');
    media.setAttribute('preload', 'none');
  }

  const baseElement = doc.createElement('base');
  baseElement.setAttribute('href', base);
  const referrer = doc.createElement('meta');
  referrer.setAttribute('name', 'referrer');
  referrer.setAttribute('content', 'no-referrer');
  head.prepend(baseElement, referrer);

  return `${doc.doctype ? '<!doctype html>' : ''}${doc.documentElement.outerHTML}`;
}

const BLOCK_SIGNS =
  /just a moment|attention required|access denied|are you a robot|verify you are human|security verification|captcha|blocked by network security|request blocked|pardon our interruption|enable javascript and cookies/i;

/** True when the page is a bot check rather than the site. */
export function looksBlocked(doc: Document): boolean {
  const text = (doc.body?.textContent ?? '').slice(0, 2000);
  return (
    BLOCK_SIGNS.test(doc.title) ||
    (doc.getElementsByTagName('*').length < 80 && BLOCK_SIGNS.test(text))
  );
}

/** True when the page shows almost nothing without its scripts. */
export function looksScriptOnly(doc: Document): boolean {
  const body = doc.body;
  if (!body) return true;
  const text = (body.innerText ?? body.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length < 60 && body.querySelectorAll('a[href], button, input').length < 3;
}
