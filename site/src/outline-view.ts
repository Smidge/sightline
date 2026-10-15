/**
 * Draws outline text with its parts marked (role, name, states, ref), so a
 * person can scan what a model reads. Built from text nodes only: page
 * content never becomes markup.
 */

export type Token = { kind: string | null; text: string };

const HEADER = /^(Page|Title|Viewport|Scroll):/;
const PART =
  /("[^"]*")|(\[ref=e\d+\])|(\[[^\]]*\])|(\((?:guessed from|unlabelled|open|another site)[^)]*\))|(→ \S+)|( — )/g;
const PART_KINDS = ['name', 'ref', 'state', 'note', 'target', 'dash'];

export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let rest = line;
  const header = HEADER.exec(rest);
  if (header) {
    tokens.push({ kind: 'key', text: header[0] });
    rest = rest.slice(header[0].length);
  } else {
    const role = /^(?:file upload|[a-z][a-z0-9]*)/.exec(rest);
    if (role) {
      tokens.push({ kind: 'role', text: role[0] });
      rest = rest.slice(role[0].length);
    }
  }
  let last = 0;
  for (const match of rest.matchAll(PART)) {
    if (match.index > last) tokens.push({ kind: null, text: rest.slice(last, match.index) });
    const group = match.slice(1).findIndex((value) => value !== undefined);
    tokens.push({ kind: PART_KINDS[group], text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < rest.length) tokens.push({ kind: null, text: rest.slice(last) });
  return tokens;
}

/** Fills an element with one line's marked-up tokens. */
export function fillLine(target: Element | DocumentFragment, line: string) {
  const doc = target.ownerDocument ?? document;
  for (const token of tokenize(line)) {
    if (!token.kind) {
      target.append(token.text);
      continue;
    }
    const span = doc.createElement('span');
    span.className = `t-${token.kind}`;
    span.textContent = token.text;
    target.append(span);
  }
}

export const refOf = (line: string) => / \[ref=(e\d+)\]/.exec(line)?.[1] ?? null;

/**
 * Renders outline lines into `pre`. Lines with a ref become buttons so they
 * can be pressed to point at the control; `added` marks lines to highlight.
 */
export function renderOutline(
  pre: HTMLElement,
  lines: string[],
  added: (line: string) => boolean = () => false,
) {
  const doc = pre.ownerDocument;
  const fragment = doc.createDocumentFragment();
  let first = true;
  for (const line of lines) {
    const ref = refOf(line);
    const row = doc.createElement(ref ? 'button' : 'span');
    row.className = 'line';
    if (ref) {
      (row as HTMLButtonElement).type = 'button';
      row.dataset.ref = ref;
      row.tabIndex = first ? 0 : -1;
      first = false;
    }
    if (added(line)) row.classList.add('added');
    const indent = line.length - line.trimStart().length;
    row.style.setProperty('--indent', `${indent}ch`);
    fillLine(row, line.trimStart());
    fragment.append(row);
  }
  pre.replaceChildren(fragment);
}

/** Arrow keys move between ref lines, so a long outline is one tab stop. */
export function roveRefs(pre: HTMLElement) {
  pre.addEventListener('keydown', (event) => {
    const rows = [...pre.querySelectorAll<HTMLElement>('button.line')];
    const index = rows.indexOf(event.target as HTMLElement);
    if (index < 0) return;
    let next = -1;
    if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    if (next < 0) return;
    event.preventDefault();
    focusRow(rows, next);
  });
}

export function focusRow(rows: HTMLElement[], index: number) {
  for (const row of rows) row.tabIndex = -1;
  const row = rows[index];
  if (!row) return;
  row.tabIndex = 0;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: 'nearest' });
}

/** Marks up every static `pre[data-outline]` example on the page. */
export function markStaticOutlines(root: ParentNode = document) {
  for (const pre of root.querySelectorAll<HTMLElement>('pre[data-outline]')) {
    const lines = (pre.textContent ?? '').replace(/^\n|\n\s*$/g, '').split('\n');
    const doc = pre.ownerDocument;
    const fragment = doc.createDocumentFragment();
    lines.forEach((line, index) => {
      const indent = line.length - line.trimStart().length;
      fragment.append(' '.repeat(indent));
      fillLine(fragment, line.trimStart());
      if (index < lines.length - 1) fragment.append('\n');
    });
    pre.replaceChildren(fragment);
  }
}
