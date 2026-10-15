/**
 * Colours TypeScript examples: comments, strings, keywords and numbers. Small
 * on purpose; the examples are short and use a narrow slice of the language.
 */
const CODE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*")|\b(import|from|export|const|let|await|async|function|return|new|type|if|else|for|of|true|false|null|undefined)\b|\b(\d[\d_]*(?:\.\d+)?)\b/g;
const KINDS = ['comment', 'string', 'keyword', 'number'];

function highlight(code: HTMLElement) {
  const text = code.textContent ?? '';
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of text.matchAll(CODE)) {
    if (match.index > last) fragment.append(text.slice(last, match.index));
    const group = match.slice(1).findIndex((value) => value !== undefined);
    const span = document.createElement('span');
    span.className = `c-${KINDS[group]}`;
    span.textContent = match[0];
    fragment.append(span);
    last = match.index + match[0].length;
  }
  if (last < text.length) fragment.append(text.slice(last));
  code.replaceChildren(fragment);
}

/** Colours every `pre > code.ts` block on the page. */
export function highlightCode(root: ParentNode = document) {
  for (const code of root.querySelectorAll<HTMLElement>('pre > code.ts')) highlight(code);
}
