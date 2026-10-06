import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Works inside the Anam Lab monorepo (packages/sightline) and as its own repo.
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const root = existsSync(path.join(packageRoot, 'node_modules')) ? packageRoot : fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const modules = path.join(root, 'node_modules');
const direct = path.join(modules, '.bin/esbuild');
const pnpm = path.join(modules, '.pnpm');
const esbuild = existsSync(direct)
  ? direct
  : readdirSync(pnpm)
      .filter((name) => name.startsWith('esbuild@'))
      .map((name) => path.join(pnpm, name, 'node_modules/esbuild/bin/esbuild'))
      .find((candidate) => existsSync(candidate));
if (!esbuild)
  throw new Error(
    'No local esbuild binary found. Install repository dependencies first.',
  );

let chromium;
for (const name of ['playwright', '@playwright/test']) {
  try {
    ({ chromium } = require(name));
    break;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
}
if (!chromium) throw new Error('No local Playwright installation found.');

function pageHtml(target) {
  // Each block has 100 elements: a labelled form, table, cards and a list.
  const block = (index) => `<section aria-label="Workspace ${index}">
    <h2>Workspace ${index}</h2>
    <form aria-label="Preferences ${index}">${Array.from({ length: 4 }, (_, i) => `<label for="field-${index}-${i}">Setting ${i}</label><input id="field-${index}-${i}" value="private typed value">`).join('')}<button>Save preferences</button></form>
    <table aria-label="Accounts ${index}"><thead><tr><th>Name</th><th>Actions</th></tr></thead><tbody>${Array.from({ length: 10 }, (_, i) => `<tr><td>Account ${i}</td><td><button>Edit account ${i}</button></td></tr>`).join('')}</tbody></table>
    <div class="cards">${Array.from({ length: 6 }, (_, i) => `<article><h3>Project ${i}</h3><p>Project description</p><a href="/projects/${i}">Open project</a><button>Project actions</button></article>`).join('')}</div>
    <ul>${Array.from({ length: 5 }, (_, i) => `<li><a href="/task/${i}">Task ${i}</a></li>`).join('')}</ul>
  </section>`;
  return `<!doctype html><html><head><title>Sightline benchmark</title><style>body{font:16px system-ui;margin:24px}section{padding:16px}.cards{display:grid;grid-template-columns:repeat(3,1fr)}article{padding:12px}input{display:block}</style></head><body>
    <nav aria-label="Main"><a href="/">Home</a><a href="/projects">Projects</a><a href="https://docs.example.test/guide">Documentation</a></nav>
    <main><h1>Workspaces</h1>${Array.from({ length: Math.max(1, Math.round((target - 20) / 100)) }, (_, i) => block(i)).join('')}</main>
    <dialog open aria-label="Help"><p>Choose a workspace to begin.</p><button>Dismiss</button></dialog>
  </body></html>`;
}

const temporary = mkdtempSync(path.join(tmpdir(), 'sightline-bench-'));
let browser;
try {
  const bundle = path.join(temporary, 'sightline.js');
  execFileSync(
    esbuild,
    [
      path.join(root, 'packages/sightline/src/index.ts'),
      '--bundle',
      '--format=iife',
      '--global-name=Sightline',
      '--target=es2022',
      `--outfile=${bundle}`,
    ],
    { stdio: 'pipe' },
  );
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (/Executable doesn't exist|browser.*not found/i.test(error.message)) {
      throw new Error(
        'Chromium is missing. Install it with node_modules/.bin/playwright install chromium, then rerun.',
        { cause: error },
      );
    }
    throw error;
  }
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const rows = [];
  // BENCH_MAX_CHARS=1e9 measures a full walk instead of the default 6,000-char budget.
  const maxChars = Number(process.env.BENCH_MAX_CHARS ?? 6000);
  for (const target of [500, 2000, 10000, 50000]) {
    await page.setContent(pageHtml(target));
    await page.addScriptTag({ path: bundle });
    const result = await page.evaluate((maxChars) => {
      for (let i = 0; i < 3; i++)
        window.Sightline.outline(document, { refs: true, viewport: true, maxChars });
      const samples = [];
      let chars = 0;
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        const result = window.Sightline.outline(document, {
          refs: true,
          viewport: true,
          maxChars,
        });
        samples.push(performance.now() - start);
        chars = result?.text.length ?? 0;
      }
      samples.sort((a, b) => a - b);
      return {
        elements: document.querySelectorAll('*').length,
        median: (samples[9] + samples[10]) / 2,
        p95: samples[18],
        chars,
      };
    }, maxChars);
    rows.push(result);
  }
  console.log(
    `Chromium ${browser.version()}; 1280×800; 3 warmups + 20 measured runs; p95 nearest rank`,
  );
  console.log('| Elements | Median ms | p95 ms | Output chars |');
  console.log('| ---: | ---: | ---: | ---: |');
  for (const row of rows)
    console.log(
      `| ${row.elements.toLocaleString('en-US')} | ${row.median.toFixed(2)} | ${row.p95.toFixed(2)} | ${row.chars} |`,
    );
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true });
}
