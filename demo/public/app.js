const form = document.getElementById('reader');
const input = document.getElementById('url');
const submit = document.getElementById('submit');
const status = document.getElementById('status');
const results = document.getElementById('results');
const empty = document.getElementById('empty');
const summary = document.getElementById('summary');
const notice = document.getElementById('notice');
const shot = document.getElementById('shot');
const outlines = { plain: '', inferred: '' };

const STEPS = [
  [0, 'Opening the page in Chrome…'],
  [4000, 'Waiting for it to finish drawing…'],
  [9000, 'Reading the page…'],
  [20000, 'Still loading. Heavy pages can take up to 30 seconds.'],
];

/** Lines compared without refs, which differ between the two runs. */
const bare = (line) => line.replace(/ \[ref=e\d+\]/, '').trim();

function render(pane, outline, compareWith) {
  const root = document.getElementById(pane);
  const pre = root.querySelector('.outline');
  const stats = root.querySelector('.stats');
  pre.replaceChildren();
  if (!outline) {
    pre.textContent = 'Nothing readable on this page.';
    stats.textContent = '';
    return;
  }
  outlines[pane] = outline.text;
  const known = compareWith ? new Set(compareWith.text.split('\n').map(bare)) : null;
  for (const line of outline.text.split('\n')) {
    const span = document.createElement('span');
    span.className = 'line';
    if (known && !known.has(bare(line))) span.classList.add('added');
    // Wrapped lines hang under their own indent so the tree stays readable.
    const indent = line.length - line.trimStart().length;
    span.style.setProperty('--indent', `${indent}ch`);
    span.textContent = line.trimStart();
    pre.append(span);
  }
  const tokens = Math.round(outline.stats.chars / 4);
  stats.textContent = `${outline.stats.controls} controls · ~${tokens.toLocaleString()} tokens · ${outline.stats.ms} ms`;
}

function setBusy(busy) {
  submit.disabled = busy;
  submit.classList.toggle('busy', busy);
  form.setAttribute('aria-busy', String(busy));
}

async function read(url, device) {
  setBusy(true);
  notice.hidden = true;
  const timers = STEPS.map(([delay, text]) =>
    setTimeout(() => (status.textContent = text), delay),
  );
  const started = performance.now();
  try {
    const response = await fetch('/api/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, device }),
    });
    const data = await response.json().catch(() => ({
      error: 'The reader stopped before it finished. Try again.',
    }));
    if (!response.ok || data.error) throw new Error(data.error ?? 'Something went wrong.');

    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    status.textContent = `Read in ${seconds} s.`;
    summary.replaceChildren();
    const title = document.createElement('p');
    title.className = 'page-title';
    title.textContent = data.title || 'Untitled page';
    const meta = document.createElement('p');
    meta.className = 'page-meta';
    const link = document.createElement('a');
    link.href = data.finalUrl;
    link.textContent = data.finalUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    meta.append(link, ` · ${data.elements.toLocaleString()} elements · loaded in ${(data.loadMs / 1000).toFixed(1)} s`);
    summary.append(title, meta);

    if (data.blocked) {
      notice.hidden = false;
      notice.textContent =
        'This site blocked the automated browser, so you are seeing its bot check rather than the page. Try another site.';
    }
    shot.src = data.screenshot;
    shot.alt = `Screenshot of ${data.title || data.finalUrl}`;
    results.dataset.device = device;
    document.getElementById('shot-meta').textContent =
      device === 'phone' ? 'Phone, 390 px wide' : 'Desktop, 1440 px wide';
    render('plain', data.plain, null);
    render('inferred', data.inferred, data.plain);
    results.hidden = false;
    empty.hidden = true;
    results.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  } catch (error) {
    status.textContent = '';
    notice.hidden = false;
    notice.textContent = error.message;
    if (results.hidden) {
      results.hidden = false;
      results.classList.add('only-notice');
    }
  } finally {
    timers.forEach(clearTimeout);
    setBusy(false);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const url = input.value.trim();
  if (!url) {
    input.focus();
    status.textContent = 'Enter a web address first.';
    return;
  }
  results.classList.remove('only-notice');
  const device = new FormData(form).get('device');
  const params = new URLSearchParams({ url, device });
  history.replaceState(null, '', `?${params}`);
  read(url, device);
});

for (const button of document.querySelectorAll('.examples button')) {
  button.addEventListener('click', () => {
    input.value = button.dataset.url;
    form.requestSubmit();
  });
}

for (const button of document.querySelectorAll('.copy')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(outlines[button.dataset.copy]);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => (button.textContent = 'Copy'), 1600);
  });
}

// Shared links open with the page already read.
const initial = new URLSearchParams(location.search);
if (initial.get('url')) {
  input.value = initial.get('url');
  const device = initial.get('device') === 'phone' ? 'phone' : 'desktop';
  form.querySelector(`input[value="${device}"]`).checked = true;
  read(input.value, device);
}
