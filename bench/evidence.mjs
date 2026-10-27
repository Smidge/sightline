// Measures what an agent gets from realistic pages: output size, capture time,
// whether the key evidence survives the budget, and how many times watch
// reports on busy pages. Runs in Chromium with real timers.
//
//   node bench/evidence.mjs            # table
//   node bench/evidence.mjs --json     # machine-readable results
//
// Set CHROME_PATH to use an installed Chrome instead of Playwright's Chromium.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = (name) =>
  readFileSync(path.join(root, 'test/fixtures', name), 'utf8');

const bundle = (
  await build({
    // SIGHTLINE_SRC points at another checkout's src/index.ts to compare versions.
    entryPoints: [process.env.SIGHTLINE_SRC ?? path.join(root, 'src/index.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'Sightline',
    target: 'es2022',
    write: false,
  })
).outputFiles[0].text;

const framesPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Checkout payment · Northwind Outdoor</title></head><body>
<main><h1>Payment</h1>
<iframe title="Secure card payment input frame" src="data:text/html,<input aria-label='Card number'>" width="360" height="60"></iframe>
<iframe src="data:text/html,<button>Pay later</button>" width="360" height="120"></iframe>
<iframe title="Order help" srcdoc="<button>Chat with us</button>" width="360" height="120"></iframe>
<iframe title="Receipt preview" sandbox srcdoc="<p>Receipt</p><button>Print</button>" width="360" height="120"></iframe>
<iframe title="Analytics" src="data:text/html,x" width="1" height="1"></iframe>
<button>Pay £84.00</button>
</main></body></html>`;

const PAGES = [
  {
    name: 'checkout-long',
    html: fixture('checkout-long.html'),
    evidence: ['Accept the terms and conditions', 'Place order'],
  },
  {
    name: 'basket-repeated',
    html: fixture('basket-repeated.html'),
    evidence: ['Only 2 left in stock', 'Quantity for Beanie 22'],
  },
  {
    name: 'validation',
    html: fixture('validation.html'),
    evidence: ['Enter a key name', 'You need the Admin role'],
  },
  {
    name: 'frames',
    html: framesPage,
    evidence: ['Secure card payment input frame', 'Chat with us'],
  },
];

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
let current = '';
await page.route('https://shop.test/**', (route) =>
  route.fulfill({ contentType: 'text/html; charset=utf-8', body: current }),
);
async function load(html, name) {
  current = html;
  await page.goto(`https://shop.test/${name}`);
  await page.addScriptTag({ content: bundle });
}

const captures = [];
for (const spec of PAGES) {
  await load(spec.html, spec.name);
  for (const infer of [false, true]) {
    const result = await page.evaluate((infer) => {
      const options = { refs: true, infer };
      for (let i = 0; i < 3; i++) window.Sightline.outline(document, options);
      const samples = [];
      let outline = null;
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        outline = window.Sightline.outline(document, options);
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      return {
        median: (samples[9] + samples[10]) / 2,
        chars: outline.text.length,
        lines: outline.lines.length,
        truncated: outline.stats.truncated,
        text: outline.text,
      };
    }, infer);
    captures.push({
      page: spec.name,
      infer,
      ...result,
      evidence: spec.evidence.map((needle) => result.text.includes(needle)),
      needles: spec.evidence,
    });
  }
}

// watch on busy pages: count reports and time to the one that matters.
const SCENARIOS = {
  'identical rerender every 200 ms': {
    html: '<main><h1>Orders</h1><div id="list"></div></main>',
    run: `const list = document.getElementById('list');
      const draw = () => { list.innerHTML = '<button>Export</button><button>Refresh</button>'; };
      draw(); setInterval(draw, 200);`,
    duration: 5000,
  },
  'clock ticking every second': {
    html: '<main><h1>Call</h1><h2 id="t">Call time 00:00</h2><button>Hang up</button></main>',
    run: `let s = 0; const t = document.getElementById('t');
      setInterval(() => { s++; t.textContent = 'Call time 00:' + String(s).padStart(2, '0'); }, 1000);`,
    duration: 6000,
  },
  'progress every 100 ms, then an alert and a dialog': {
    html: '<main><h1>Upload</h1><div role="status" id="p">Uploading 0%</div></main>',
    run: `let n = 0; const p = document.getElementById('p');
      setInterval(() => { n = (n + 1) % 100; p.textContent = 'Uploading ' + n + '%'; }, 100);
      setTimeout(() => { document.querySelector('main').insertAdjacentHTML('beforeend', '<div role="alert">Upload failed: file too large</div>'); window.__marks.alert = performance.now(); }, 2000);
      setTimeout(() => { document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-label="Retry upload"><button>Retry</button></div>'); window.__marks.dialog = performance.now(); }, 3500);`,
    duration: 6000,
    detect: { alert: 'Upload failed', dialog: 'Retry upload' },
  },
  'error text edited in place': {
    html: '<main><label for="e">Email</label><input id="e" aria-invalid="true" aria-errormessage="err"><p id="err">Enter an email address.</p></main>',
    run: `setTimeout(() => { document.getElementById('err').firstChild.nodeValue = 'That email is already registered.'; window.__marks.text = performance.now(); }, 1000);`,
    duration: 3500,
    detect: { text: 'already registered' },
  },
  'description switched by attribute': {
    html: '<main><label for="e">Email</label><input id="e" aria-describedby="ok"><p id="ok">Looks good.</p><p id="bad" class="error">That email is already registered.</p></main>',
    run: `setTimeout(() => { document.getElementById('e').setAttribute('aria-describedby', 'bad'); window.__marks.attr = performance.now(); }, 1000);`,
    duration: 3500,
    detect: { attr: 'already registered' },
  },
};

const watches = [];
for (const [name, scenario] of Object.entries(SCENARIOS)) {
  await load(`<!doctype html><html><head><title>Busy</title></head><body>${scenario.html}</body></html>`, 'busy');
  const result = await page.evaluate(
    async ({ run, duration, detect }) => {
      window.__marks = {};
      const events = [];
      const started = performance.now();
      const sightline = window.Sightline.createSightline({});
      const stop = sightline.watch((change) =>
        events.push({ at: performance.now(), kind: change.kind, text: change.outline.text }),
      );
      new Function(run)();
      await new Promise((resolve) => setTimeout(resolve, duration));
      stop();
      const delays = {};
      for (const [mark, needle] of Object.entries(detect ?? {})) {
        const seen = events.find((event) => event.text.includes(needle));
        delays[mark] = seen && window.__marks[mark] !== undefined
          ? Math.round(seen.at - window.__marks[mark])
          : null;
      }
      return {
        emissions: events.length,
        kinds: events.map((event) => event.kind),
        delays,
        seconds: (performance.now() - started) / 1000,
      };
    },
    { run: scenario.run, duration: scenario.duration, detect: scenario.detect },
  );
  watches.push({ scenario: name, ...result });
}
await browser.close();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ captures, watches }, null, 2));
} else {
  console.log('| Page | infer | Chars | Lines | Truncated | Median ms | Evidence kept |');
  console.log('| --- | --- | ---: | ---: | --- | ---: | --- |');
  for (const row of captures)
    console.log(
      `| ${row.page} | ${row.infer ? 'on' : 'off'} | ${row.chars} | ${row.lines} | ${row.truncated ? 'yes' : 'no'} | ${row.median.toFixed(2)} | ${row.needles.map((needle, i) => `${row.evidence[i] ? '✓' : '✗'} ${needle}`).join('; ')} |`,
    );
  console.log('\n| watch scenario | Seconds | Reports | Kinds | Delay to report (ms) |');
  console.log('| --- | ---: | ---: | --- | --- |');
  for (const row of watches)
    console.log(
      `| ${row.scenario} | ${row.seconds.toFixed(1)} | ${row.emissions} | ${row.kinds.join(', ')} | ${Object.entries(row.delays).map(([mark, ms]) => `${mark}: ${ms ?? 'never'}`).join('; ') || '–'} |`,
    );
}
