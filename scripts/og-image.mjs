// Renders the social preview card, site/assets/og.png (1200 × 630), in
// Chromium. Run it after changing the card: `node scripts/og-image.mjs`. Set
// CHROME_PATH to use an installed Chrome instead of Playwright's Chromium.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// Real lines from the built-in sample page, read with infer on.
const LINES = [
  ['navigation "Main navigation"'],
  ['  link "API keys" → /settings/api-keys [current] [ref=e4]'],
  ['clickable "Upgrade plan" [ref=e18]', 'added'],
  ['button "bell" (guessed from icon) [ref=e6]', 'added'],
  ['button "[email]" [opens menu] [ref=e7]'],
  ['main'],
  ['  h1 "API keys"'],
  ['  searchbox "Search keys" [empty] [ref=e8]'],
  ['  button "New key" [disabled] [ref=e9]'],
  ['  table: columns Name | Key | Created | Last used; 9 rows'],
  ['    button "copy" (guessed from icon) [ref=e10]', 'added'],
];

const view = await build({
  entryPoints: [`${root}site/src/outline-view.ts`],
  bundle: true,
  format: 'iife',
  globalName: 'OutlineView',
  write: false,
});

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;650&family=Geist+Mono:wght@400;600&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #faf8f5; color: #16130f; font-family: Geist, sans-serif; -webkit-font-smoothing: antialiased; }
  .card { display: grid; grid-template-columns: 500px 1fr; gap: 48px; height: 100%; padding: 60px 0 60px 64px; }
  .left { display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 650; letter-spacing: -0.02em; }
  .brand svg { width: 46px; height: 46px; }
  h1 { margin: auto 0 0; font-size: 64px; line-height: 1; letter-spacing: -0.045em; font-weight: 650; text-wrap: balance; }
  .meta { margin: 26px 0 0; color: #4a443c; font-size: 22px; line-height: 1.4; }
  .url { margin-top: 18px; font: 500 19px 'Geist Mono', monospace; color: #b84600; }
  .panel { align-self: center; margin-right: -40px; padding: 18px 0; border: 1px solid #e7e2da; border-right: 0; border-radius: 18px 0 0 18px; background: #fff; box-shadow: 0 2px 4px rgba(22,19,15,.05), 0 18px 40px -24px rgba(22,19,15,.3); }
  .head { display: flex; align-items: center; gap: 10px; padding: 0 26px 14px; border-bottom: 1px solid #e7e2da; font-size: 17px; font-weight: 500; color: #6f675c; }
  .head b { color: #16130f; font-weight: 650; }
  .line { display: block; padding: 0 26px 0 calc(26px + var(--indent)); font: 17px/1.75 'Geist Mono', monospace; white-space: pre; }
  .added { background: #fff0e2; }
  .t-role { font-weight: 600; } .t-name { color: #2e2924; }
  .t-state, .t-note, .t-target, .t-dash, .t-key { color: #6f675c; } .t-ref { color: #b84600; }
  svg rect { fill: #ff6200; } svg path { fill: none; stroke: #fff; stroke-width: 2.2; } svg circle { fill: #fff; }
</style></head>
<body><div class="card">
  <div class="left">
    <div class="brand"><svg viewBox="0 0 32 32"><rect width="32" height="32" rx="8"/><path d="M6 16c3-5 6.5-7.5 10-7.5S23 11 26 16c-3 5-6.5 7.5-10 7.5S9 21 6 16Z"/><circle cx="16" cy="16" r="3"/></svg>Sightline</div>
    <h1>What's on screen, as text an AI agent can use</h1>
    <p class="meta">Runs in the page. Never reads what anyone typed. Try it on any URL.</p>
    <div class="url">smidge.github.io/sightline</div>
  </div>
  <div class="panel"><div class="head"><b>What the agent reads</b> · highlighted lines need infer</div><div id="lines"></div></div>
</div>
<script>${view.outputFiles[0].text}</script>
<script>
  const lines = ${JSON.stringify(LINES)};
  const target = document.getElementById('lines');
  for (const [line, mark] of lines) {
    const row = document.createElement('span');
    row.className = 'line' + (mark ? ' added' : '');
    row.style.setProperty('--indent', (line.length - line.trimStart().length) + 'ch');
    OutlineView.fillLine(row, line.trimStart());
    target.append(row);
  }
</script></body></html>`;

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${root}site/assets/og.png` });
await browser.close();
console.log('site/assets/og.png written.');
