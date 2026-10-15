// Builds the GitHub Pages site into _site/: copies site/, bundles the demo
// and docs scripts with Sightline from src/, and writes the bookmarklet into
// index.html. `node scripts/site.mjs --serve` also serves it on port 4173.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'site');
const out = path.join(root, '_site');

rmSync(out, { recursive: true, force: true });
cpSync(source, out, {
  recursive: true,
  filter: (file) => !file.startsWith(path.join(source, 'src')),
});

await build({
  entryPoints: {
    'assets/demo': path.join(source, 'src/demo.ts'),
    'assets/docs': path.join(source, 'src/docs.ts'),
  },
  outdir: out,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: 'linked',
});

// A javascript: URL is percent-decoded before it runs, and this one sits in
// an HTML attribute, so escape the few characters either would misread.
const bookmarklet = await build({
  entryPoints: [path.join(source, 'src/bookmarklet.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  charset: 'ascii',
  write: false,
});
const code = `${bookmarklet.outputFiles[0].text.trim()}void 0`;
const href = `javascript:${code.replace(/[%#"&<>\n\r\t]/g, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`)}`;
const indexPath = path.join(out, 'index.html');
const index = readFileSync(indexPath, 'utf8');
const placeholder = 'href="#sightline-bookmarklet"';
if (!index.includes(placeholder))
  throw new Error(`site/index.html has no ${placeholder} placeholder.`);
writeFileSync(indexPath, index.replaceAll(placeholder, `href="${href}"`));

console.log(`_site/ built. Bookmarklet: ${(href.length / 1024).toFixed(1)} KB.`);

if (process.argv.includes('--serve')) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.map': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };
  const port = Number(process.env.PORT ?? 4173);
  createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    if (pathname === '/' || pathname === '/sightline') {
      response.writeHead(302, { location: '/sightline/' }).end();
      return;
    }
    // Serve under /sightline/ as GitHub Pages does, so relative paths match.
    const local = pathname.replace(/^\/sightline(?=\/|$)/, '') || '/';
    let file = path.join(out, decodeURIComponent(local));
    if (!file.startsWith(out)) {
      response.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(readFileSync(file));
  }).listen(port, () => {
    console.log(`Serving http://localhost:${port}/sightline/`);
  });
}
