import chromium from '@sparticuz/chromium';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import puppeteer, { type Browser, type HTTPRequest } from 'puppeteer-core';

import { SIGHTLINE_SOURCE } from './_sightline.js';

/**
 * Opens a public web page in headless Chrome, runs Sightline on it with and
 * without inference, and returns both outlines with a screenshot.
 */

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
} as const;

const USER_AGENTS = {
  desktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  phone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
} as const;

const BLOCKED_NAMES = /(^localhost$|\.localhost$|\.local$|\.internal$|^metadata\.)/i;

/** Loopback, private, link-local, carrier-grade NAT and other non-public ranges. */
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80')
  );
}

class InputError extends Error {}

async function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new InputError('Only http and https addresses can be read.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_NAMES.test(host))
    throw new InputError('That address is not on the public internet.');
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
        throw new InputError(`Couldn't find ${host}. Check the address.`);
      });
  if (addresses.some(({ address }) => isPrivateAddress(address)))
    throw new InputError('That address is not on the public internet.');
}

function parseUrl(raw: unknown): URL {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new InputError('Enter a web address.');
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new InputError(`"${text}" isn't a web address.`);
  }
}

/** Subresources are checked by name; page navigations also by DNS. */
async function guardRequest(request: HTTPRequest, mainFrameUrlCheck: boolean) {
  try {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:')
      return request.continue();
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return request.abort('blockedbyclient');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (BLOCKED_NAMES.test(host) || (isIP(host) && isPrivateAddress(host)))
      return request.abort('blockedbyclient');
    if (mainFrameUrlCheck) await assertPublic(url);
    return request.continue();
  } catch {
    return request.abort('blockedbyclient').catch(() => {});
  }
}

const BLOCK_SIGNS =
  /just a moment|attention required|access denied|are you a robot|verify you are human|security verification|captcha|blocked by network security|request blocked|pardon our interruption/i;

type OutlineResult = {
  text: string;
  stats: { chars: number; lines: number; controls: number; ms: number };
} | null;

type PageResult = {
  title: string;
  finalUrl: string;
  elements: number;
  plain: OutlineResult;
  inferred: OutlineResult;
  bodyText: string;
};

async function readPage(url: URL, device: keyof typeof VIEWPORTS) {
  let browser: Browser | null = null;
  try {
    const local = process.env.CHROME_PATH;
    browser = await puppeteer.launch({
      args: local ? ['--no-first-run'] : chromium.args,
      executablePath: local ?? (await chromium.executablePath()),
      headless: true,
      defaultViewport: { ...VIEWPORTS[device], deviceScaleFactor: 1 },
    });
    const page = await browser.newPage();
    await page.setUserAgent({ userAgent: USER_AGENTS[device] });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-GB,en;q=0.9' });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const navigation =
        request.isNavigationRequest() && request.frame() === page.mainFrame();
      void guardRequest(request, navigation);
    });

    const started = Date.now();
    await page.goto(url.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    // Let client-rendered pages draw: quiet network, or a few seconds at most.
    await page
      .waitForNetworkIdle({ idleTime: 700, timeout: 7_000 })
      .catch(() => {});
    const loadMs = Date.now() - started;

    await page.evaluate(SIGHTLINE_SOURCE);
    const result = (await page.evaluate(() => {
      type Sightline = {
        outline: (
          doc: Document,
          options: Record<string, unknown>,
        ) => { text: string; stats: Record<string, number> } | null;
      };
      const sightline = (globalThis as unknown as { __sightline: Sightline })
        .__sightline;
      const run = (infer: boolean) => {
        const outline = sightline.outline(document, {
          refs: true,
          viewport: true,
          infer,
          maxChars: 12_000,
        });
        return outline
          ? {
              text: outline.text,
              stats: {
                chars: outline.stats.chars,
                lines: outline.stats.lines,
                controls: outline.stats.controls,
                ms: Math.round(outline.stats.ms * 10) / 10,
              },
            }
          : null;
      };
      return {
        title: document.title,
        finalUrl: location.href,
        elements: document.getElementsByTagName('*').length,
        plain: run(false),
        inferred: run(true),
        bodyText: (document.body?.innerText ?? '').slice(0, 600),
      };
    })) as PageResult;

    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: 62,
      encoding: 'base64',
    });
    const blocked =
      BLOCK_SIGNS.test(result.title) ||
      (result.elements < 60 && BLOCK_SIGNS.test(result.bodyText));
    const { bodyText: _bodyText, ...rest } = result;
    return { ...rest, loadMs, blocked, screenshot: `data:image/jpeg;base64,${screenshot}` };
  } finally {
    await browser?.close().catch(() => {});
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: { url?: unknown; device?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send JSON with a url.' }, 400);
  }
  const device = body.device === 'phone' ? 'phone' : 'desktop';
  try {
    const url = parseUrl(body.url);
    await assertPublic(url);
    return json(await readPage(url, device));
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, 400);
    const message = error instanceof Error ? error.message : String(error);
    console.error('[sightline-demo] read failed', message);
    if (/timeout/i.test(message))
      return json(
        { error: "The page didn't finish loading within 25 seconds." },
        504,
      );
    if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_ADDRESS/i.test(message))
      return json({ error: "Couldn't connect to that site." }, 502);
    return json({ error: "Couldn't read that page. Try another address." }, 500);
  }
}
