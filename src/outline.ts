/**
 * A compact text outline of what a page shows, for an LLM agent. It walks the
 * DOM the way a screen reader does: roles, accessible names and states, open
 * dialogs, alerts and form errors. It never reads what the user typed, and it
 * skips anything hidden, anything behind an open modal, and any subtree the
 * host marks as its own (an agent's chat panel, for example).
 */

export type OutlineLocation = {
  pathname: string;
  search?: string;
  origin?: string;
  href?: string;
};

export type OutlineOptions = {
  /** Subtrees to leave out, such as the agent's own panel. */
  skip?: string;
  /** Character budget for the whole outline. Default 6,000 (~1,500 tokens). */
  maxChars?: number;
  /** Element budget for one walk. Default 20,000. */
  maxElements?: number;
  /** Add `Page:`, `Title:` and `Viewport:` lines. Default true. */
  header?: boolean;
  /**
   * The address to report. Defaults to `document.location`; pass one when
   * the document has no meaningful location (an iframe `srcdoc`, a test).
   */
  location?: OutlineLocation;
  /** Formats the `Page:` line. Default: path plus any `keepParams`. */
  pageAddress?: (location: OutlineLocation) => string;
  /** Query parameters worth keeping on the `Page:` line. Default `['tab']`. */
  keepParams?: string[];
  /** Give every listed control a stable `[ref=eN]` an agent can act on. */
  refs?: boolean;
  /** Mark controls outside the viewport `[offscreen]` and add a `Scroll:` line. */
  viewport?: boolean;
  /** Runs of this many similar siblings are shortened. Default 8. */
  repeatMin?: number;
  /** How many items of a shortened run to keep. Default 3. */
  repeatKeep?: number;
  /** Email addresses matching this pattern are kept, others become `[email]`. */
  keepEmail?: RegExp;
  /** Extra redaction applied to every name and text excerpt. */
  redact?: (text: string) => string;
  /** Attribute quoted for a control with no name and no nearby text. */
  hintAttribute?: string;
};

export type OutlineStats = {
  chars: number;
  lines: number;
  visited: number;
  controls: number;
  truncated: boolean;
  ms: number;
};

export type Outline = {
  text: string;
  lines: string[];
  /** `eN` → element, when `refs` is on. */
  refs: Map<string, Element>;
  stats: OutlineStats;
};

export const DEFAULT_MAX_CHARS = 6_000;
const DEFAULT_MAX_ELEMENTS = 20_000;
const NAME_MAX = 100;
const TEXT_MAX = 240;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const SKIPPED_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'iframe',
  'video',
  'audio',
  'canvas',
  'svg',
]);

const TEXT_INPUT_ROLES = new Set(['textbox', 'searchbox', 'spinbutton']);

export const CONTROL_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'textbox',
  'searchbox',
  'spinbutton',
  'combobox',
  'listbox',
  'slider',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'file',
]);

const SECTION_ROLES = new Set([
  'main',
  'region',
  'form',
  'dialog',
  'alertdialog',
  'tabpanel',
  'menu',
  'complementary',
]);

const LIST_ITEM_ROLES = new Set(['listitem', 'row', 'article', 'option']);

/** Roles whose accessible name may come from their own text. */
const NAME_FROM_CONTENT = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'heading',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'combobox',
  'tooltip',
  'label',
  'legend',
]);

/** Elements a `<label for>` or wrapping `<label>` can name (HTML "labelable"). */
const LABELABLE_TAGS = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'meter',
  'output',
  'progress',
]);

export const INTERACTIVE_SELECTOR =
  'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="slider"], [role="tab"], [role="menuitem"]';

const LABELABLE_SELECTOR =
  'input:not([type="hidden"]), select, textarea, [role="switch"], [role="checkbox"], [role="radio"], [role="slider"], [role="combobox"]';

/** Per-walk state, so helpers stay pure and caches die with the walk. */
export type Context = {
  doc: Document;
  skip: string | null;
  keepEmail: RegExp | null;
  redact: ((text: string) => string) | null;
  hintAttribute: string;
  /** label[for] targets, built on first use: one query instead of one per field. */
  labelsFor: Map<string, Element> | null;
};

export function createContext(
  doc: Document,
  options: Pick<
    OutlineOptions,
    'skip' | 'keepEmail' | 'redact' | 'hintAttribute'
  > = {},
): Context {
  return {
    doc,
    skip: options.skip ?? null,
    keepEmail: options.keepEmail ?? null,
    redact: options.redact ?? null,
    hintAttribute: options.hintAttribute ?? 'data-testid',
    labelsFor: null,
  };
}

export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function clip(ctx: Context, text: string, max = NAME_MAX): string {
  // People's addresses stay in the browser.
  let collapsed = collapse(text).replace(EMAIL_RE, (email) => {
    if (!ctx.keepEmail) return '[email]';
    const lastIndex = ctx.keepEmail.lastIndex;
    ctx.keepEmail.lastIndex = 0;
    const keep = ctx.keepEmail.test(email);
    ctx.keepEmail.lastIndex = lastIndex;
    return keep ? email : '[email]';
  });
  if (ctx.redact) collapsed = ctx.redact(collapsed);
  return collapsed.length > max
    ? `${collapsed.slice(0, max - 1).trimEnd()}…`
    : collapsed;
}

function quote(text: string): string {
  return `"${text.replaceAll('"', "'")}"`;
}

export function isAriaHidden(element: Element): boolean {
  return (
    element.hasAttribute('hidden') ||
    element.getAttribute('aria-hidden') === 'true' ||
    element.hasAttribute('inert')
  );
}

export function isRendered(element: Element): boolean {
  const check = (element as HTMLElement).checkVisibility;
  return typeof check === 'function'
    ? check.call(element, { visibilityProperty: true })
    : true;
}

export function roleOf(element: Element): string | null {
  const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit && explicit !== 'presentation' && explicit !== 'none')
    return explicit;
  switch (element.localName) {
    case 'a':
      return element.hasAttribute('href') ? 'link' : null;
    case 'button':
      return 'button';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'input': {
      const type = (element as HTMLInputElement).type;
      if (type === 'hidden') return null;
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'range') return 'slider';
      if (type === 'file') return 'file';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return 'searchbox';
      if (['button', 'submit', 'reset', 'image'].includes(type))
        return 'button';
      return 'textbox';
    }
    case 'textarea':
      return 'textbox';
    case 'select':
      return (element as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
    case 'nav':
      return 'navigation';
    case 'main':
      return 'main';
    case 'dialog':
      return (element as HTMLDialogElement).open ? 'dialog' : null;
    case 'table':
      return 'table';
    case 'progress':
      return 'progressbar';
    case 'form':
      return element.hasAttribute('aria-label') ||
        element.hasAttribute('aria-labelledby')
        ? 'form'
        : null;
    case 'section':
      return element.hasAttribute('aria-label') ||
        element.hasAttribute('aria-labelledby')
        ? 'region'
        : null;
    case 'li':
      return 'listitem';
    case 'tr':
      return 'row';
    case 'article':
      return 'article';
    case 'label':
      return 'label';
    case 'legend':
      return 'legend';
  }
  if (element.getAttribute('contenteditable') === 'true') return 'textbox';
  return null;
}

/**
 * Visible text for a name, skipping hidden parts and typed values. With
 * `ownTextOnly`, nested controls are left out so a clickable card is named by
 * its own text and its inner buttons are listed separately.
 */
export function textOf(
  node: Node,
  skip?: Element,
  root = true,
  ownTextOnly = false,
): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1) return '';
  const element = node as Element;
  if (element === skip || isAriaHidden(element)) return '';
  if (ownTextOnly && !root && element.matches(INTERACTIVE_SELECTOR)) return '';
  if (element.localName === 'svg') {
    return (
      element.getAttribute('aria-label') ??
      element.querySelector('title')?.textContent ??
      ''
    );
  }
  if (SKIPPED_TAGS.has(element.localName)) return '';
  if (element.localName === 'img') return element.getAttribute('alt') ?? '';
  if (
    element.localName === 'input' ||
    element.localName === 'textarea' ||
    element.localName === 'select' ||
    element.getAttribute('contenteditable') === 'true'
  )
    return '';
  const label = element.getAttribute('aria-label');
  if (label && !root) return label;
  let text = '';
  for (const child of element.childNodes) {
    text += ` ${textOf(child, skip, false, ownTextOnly)}`;
    if (text.length > NAME_MAX * 3) break;
  }
  return text;
}

function referencedText(
  element: Element,
  attribute: string,
  ctx: Context,
): string {
  const value = element.getAttribute(attribute);
  if (!value) return '';
  let text = '';
  for (const id of value.split(/\s+/)) {
    const target = id ? ctx.doc.getElementById(id) : null;
    if (target) text += ` ${textOf(target)}`;
  }
  return collapse(text);
}

function isFormField(element: Element): boolean {
  return (
    element.localName === 'input' ||
    element.localName === 'textarea' ||
    element.localName === 'select'
  );
}

function labelFor(element: Element, ctx: Context): Element | null {
  const id = element.id;
  if (!id) return null;
  if (!ctx.labelsFor) {
    ctx.labelsFor = new Map();
    for (const label of ctx.doc.querySelectorAll('label[for]')) {
      const target = label.getAttribute('for');
      if (target && !ctx.labelsFor.has(target))
        ctx.labelsFor.set(target, label);
    }
  }
  return ctx.labelsFor.get(id) ?? null;
}

function labelText(element: Element, ctx: Context): string {
  const native = (element as HTMLInputElement).labels;
  const labels: Element[] = native ? [...native] : [];
  const forLabel = labelFor(element, ctx);
  if (forLabel && !labels.includes(forLabel)) labels.push(forLabel);
  if (LABELABLE_TAGS.has(element.localName)) {
    // A wrapping label names only its first labelable descendant.
    const wrapping = element.closest('label');
    if (
      wrapping &&
      !labels.includes(wrapping) &&
      (wrapping.control ?? element) === element
    )
      labels.push(wrapping);
  }
  return collapse(labels.map((label) => textOf(label, element)).join(' '));
}

export function nameOf(
  element: Element,
  ctx: Context,
  ownTextOnly = false,
): string {
  const labelledBy = referencedText(element, 'aria-labelledby', ctx);
  if (labelledBy) return clip(ctx, labelledBy);
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel?.trim()) return clip(ctx, ariaLabel);
  // Browsers name a labelable element, including a select trigger button,
  // from its <label> before its own text. Custom switches use label[for] too.
  const role = roleOf(element) ?? '';
  if (
    LABELABLE_TAGS.has(element.localName) ||
    role === 'switch' ||
    role === 'checkbox' ||
    role === 'radio' ||
    role === 'slider'
  ) {
    const label = labelText(element, ctx);
    if (label) return clip(ctx, label);
  }
  if (isFormField(element)) {
    return clip(
      ctx,
      element.getAttribute('title') ??
        element.getAttribute('placeholder') ??
        '',
    );
  }
  if (element.localName === 'table') {
    const caption = (element as HTMLTableElement).caption;
    if (caption) return clip(ctx, textOf(caption));
  }
  if (NAME_FROM_CONTENT.has(role)) {
    const text = collapse(textOf(element, undefined, true, ownTextOnly));
    if (text) return clip(ctx, text);
  }
  return clip(ctx, element.getAttribute('title') ?? '');
}

/**
 * Many settings rows show their label as plain text beside an unlabelled
 * switch. Read that row text, as a sighted user would, when a control has no
 * accessible name. A container holding another field or switch is a group
 * of rows, not this control's row, so the search stops there.
 */
function nearbyText(element: Element, ctx: Context): string {
  let ancestor = element.parentElement;
  for (let level = 0; ancestor && level < 3; level += 1) {
    if (
      ancestor.querySelectorAll(LABELABLE_SELECTOR).length > 1 ||
      ancestor.querySelectorAll(INTERACTIVE_SELECTOR).length > 3
    )
      return '';
    const text = collapse(textOf(ancestor, undefined, true, true));
    if (text) return text.length <= NAME_MAX ? clip(ctx, text) : '';
    ancestor = ancestor.parentElement;
  }
  return '';
}

function isDisabled(element: Element): boolean {
  return (
    (element as HTMLButtonElement).disabled === true ||
    element.getAttribute('aria-disabled') === 'true' ||
    Boolean(element.closest('fieldset[disabled]'))
  );
}

export function controlStates(element: Element, role: string): string[] {
  const states: string[] = [];
  const checked =
    element.localName === 'input' &&
    ((element as HTMLInputElement).type === 'checkbox' ||
      (element as HTMLInputElement).type === 'radio')
      ? String((element as HTMLInputElement).checked)
      : element.getAttribute('aria-checked');
  if (role === 'switch') states.push(checked === 'true' ? 'on' : 'off');
  else if (checked === 'mixed') states.push('mixed');
  else if (
    checked !== null &&
    (role === 'checkbox' ||
      role === 'radio' ||
      role === 'menuitemcheckbox' ||
      role === 'menuitemradio')
  )
    states.push(checked === 'true' ? 'checked' : 'unchecked');
  if (element.getAttribute('aria-selected') === 'true') states.push('selected');
  const current = element.getAttribute('aria-current');
  if (current && current !== 'false') states.push('current');
  const pressed = element.getAttribute('aria-pressed');
  if (pressed === 'true') states.push('pressed');
  const expanded = element.getAttribute('aria-expanded');
  if (expanded === 'true') states.push('expanded');
  else if (expanded === 'false') states.push('collapsed');
  const popup = element.getAttribute('aria-haspopup');
  if (popup && popup !== 'false')
    states.push(popup === 'true' ? 'opens menu' : `opens ${popup}`);
  if (isDisabled(element)) states.push('disabled');
  if (
    (element as HTMLInputElement).required ||
    element.getAttribute('aria-required') === 'true'
  )
    states.push('required');
  if (TEXT_INPUT_ROLES.has(role)) {
    // Emptiness explains a disabled Save or Create; the value itself stays local.
    const value =
      element.getAttribute('contenteditable') === 'true'
        ? (element.textContent ?? '')
        : ((element as HTMLInputElement).value ?? '');
    if (!value.trim()) states.push('empty');
  }
  return states;
}

function controlValue(
  element: Element,
  role: string,
  ctx: Context,
): string | null {
  // Only values chosen from fixed options: never anything the user typed.
  if (role === 'slider' || role === 'progressbar') {
    const valueText = element.getAttribute('aria-valuetext');
    if (valueText) return clip(ctx, valueText, 40);
    const now =
      element.getAttribute('aria-valuenow') ??
      (element as HTMLInputElement).value;
    if (!now) return null;
    const min =
      element.getAttribute('aria-valuemin') ??
      element.getAttribute('min') ??
      null;
    const max =
      element.getAttribute('aria-valuemax') ??
      element.getAttribute('max') ??
      null;
    return clip(ctx, min && max ? `${now} (range ${min} to ${max})` : now, 40);
  }
  if (role !== 'combobox') return null;
  if (element.localName === 'select') {
    const select = element as HTMLSelectElement;
    const option = select.selectedOptions[0];
    return option ? clip(ctx, option.textContent ?? '') : null;
  }
  if (element.localName === 'input') return null;
  // A select-style trigger button shows its chosen option as its text.
  const shown = collapse(textOf(element));
  return shown ? clip(ctx, shown) : null;
}

function describedBy(element: Element, ctx: Context): string {
  const description = referencedText(element, 'aria-describedby', ctx);
  const error = referencedText(element, 'aria-errormessage', ctx);
  return clip(ctx, [description, error].filter(Boolean).join(' '), TEXT_MAX);
}

function linkTarget(
  element: Element,
  location: OutlineLocation | null,
): string | null {
  const href = element.getAttribute('href');
  if (!href || href.startsWith('#')) return null;
  try {
    const base =
      location?.href ??
      (location?.origin ? `${location.origin}${location.pathname}` : null);
    const url = new URL(href, base ?? 'https://localhost/');
    if (url.protocol === 'mailto:') return 'email link';
    // Only web destinations are described; script and data URLs are not.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return location?.origin && url.origin === location.origin
      ? url.pathname
      : `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return null;
  }
}

function visibleDescendants(
  element: Element,
  selector: string,
  ctx: Context,
): Element[] {
  return [...element.querySelectorAll(selector)].filter(
    (candidate) =>
      !(ctx.skip && candidate.closest(ctx.skip)) &&
      !candidate.closest('[aria-hidden="true"], [hidden], [inert]') &&
      isRendered(candidate),
  );
}

function isOffscreen(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return (
    rect.bottom <= 0 ||
    rect.right <= 0 ||
    rect.top >= view.innerHeight ||
    rect.left >= view.innerWidth
  );
}

export function isListLike(parent: Element, child: Element): boolean {
  const parentRole = roleOf(parent);
  if (
    parent.localName === 'ul' ||
    parent.localName === 'ol' ||
    parent.localName === 'tbody' ||
    ['list', 'grid', 'rowgroup', 'listbox', 'feed', 'menu'].includes(
      parentRole ?? '',
    )
  )
    return true;
  const childRole = roleOf(child);
  if (childRole && LIST_ITEM_ROLES.has(childRole)) return true;
  // Card grids: repeated siblings that each hold a link or button.
  return Boolean(child.querySelector('a[href], button, [role="button"]'));
}

function signature(element: Element): string {
  const className =
    typeof element.className === 'string' ? element.className : '';
  return `${element.localName}|${element.getAttribute('role') ?? ''}|${className}`;
}

/** Stable refs for one document: an element keeps its ref while it lives. */
export class RefRegistry {
  private ids = new WeakMap<Element, string>();
  private elements = new Map<string, WeakRef<Element>>();
  private next = 1;

  refFor(element: Element): string {
    let id = this.ids.get(element);
    if (!id) {
      id = `e${this.next++}`;
      this.ids.set(element, id);
      this.elements.set(id, new WeakRef(element));
    }
    return id;
  }

  resolve(ref: string): Element | null {
    const element = this.elements.get(ref.replace(/^ref=/, ''))?.deref();
    if (!element || !element.isConnected) return null;
    return element;
  }

  /** Forget refs whose elements were removed, so the map stays small. */
  prune() {
    for (const [id, weak] of this.elements) {
      const element = weak.deref();
      if (!element || !element.isConnected) this.elements.delete(id);
    }
  }
}

type Walk = {
  ctx: Context;
  location: OutlineLocation | null;
  lines: string[];
  chars: number;
  visited: number;
  controls: number;
  truncated: boolean;
  tablists: WeakSet<Element>;
  maxChars: number;
  maxElements: number;
  repeatMin: number;
  repeatKeep: number;
  refs: RefRegistry | null;
  refMap: Map<string, Element>;
  viewport: boolean;
};

function add(walk: Walk, depth: number, line: string) {
  if (walk.truncated) return;
  const text = `${'  '.repeat(depth)}${line}`;
  if (walk.chars + text.length + 1 > walk.maxChars) {
    walk.truncated = true;
    return;
  }
  walk.lines.push(text);
  walk.chars += text.length + 1;
}

function controlLine(
  element: Element,
  role: string,
  walk: Walk,
  ownTextOnly = false,
): string {
  const { ctx } = walk;
  const kind = role === 'file' ? 'file upload' : role;
  const name = nameOf(element, ctx, ownTextOnly);
  const value = controlValue(element, role, ctx);
  const target = role === 'link' ? linkTarget(element, walk.location) : null;
  const states = controlStates(element, role);
  const invalid = element.getAttribute('aria-invalid') === 'true';
  const description = describedBy(element, ctx);
  let line = name ? `${kind} ${quote(name)}` : kind;
  if (!name) {
    const nearby = nearbyText(element, ctx);
    const attr = element.getAttribute(ctx.hintAttribute);
    if (nearby) line += ` near ${quote(nearby)}`;
    else if (attr) line += ` (unlabelled, ${ctx.hintAttribute} ${attr})`;
  }
  if (value && value !== name) line += ` = ${quote(value)}`;
  if (target) line += ` → ${target}`;
  if (invalid) states.push('invalid');
  if (walk.viewport && isOffscreen(element)) states.push('offscreen');
  if (states.length) line += ` [${states.join(', ')}]`;
  if (walk.refs) {
    const ref = walk.refs.refFor(element);
    walk.refMap.set(ref, element);
    line += ` [ref=${ref}]`;
  }
  if (description) line += ` — ${quote(description)}`;
  walk.controls += 1;
  return line;
}

function tableLine(element: Element, walk: Walk): string {
  const { ctx } = walk;
  const name = nameOf(element, ctx);
  const columns = visibleDescendants(element, 'th, [role="columnheader"]', ctx)
    .map((cell) => clip(ctx, textOf(cell), 40))
    .filter(Boolean);
  const bodyRows =
    element.querySelectorAll('tbody tr').length ||
    Math.max(0, element.querySelectorAll('[role="row"]').length - 1);
  let line = name ? `table ${quote(name)}` : 'table';
  if (columns.length) line += `: columns ${columns.join(' | ')}`;
  if (bodyRows) line += `; ${bodyRows} row${bodyRows === 1 ? '' : 's'}`;
  return line;
}

function walkChildren(element: Element, depth: number, walk: Walk) {
  const children = element.children;
  const count = children.length;
  if (count === 0) return;
  // Only count signatures when a run could be long enough to shorten.
  let totals: Map<string, number> | null = null;
  if (count >= walk.repeatMin) {
    totals = new Map();
    for (let i = 0; i < count; i += 1) {
      const key = signature(children[i]);
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
  }
  const seen = totals ? new Map<string, number>() : null;
  for (let i = 0; i < count; i += 1) {
    if (walk.truncated) return;
    const child = children[i];
    if (totals && seen) {
      const key = signature(child);
      const total = totals.get(key) ?? 0;
      if (total >= walk.repeatMin && isListLike(element, child)) {
        const index = (seen.get(key) ?? 0) + 1;
        seen.set(key, index);
        if (index > walk.repeatKeep) {
          if (index === total)
            add(
              walk,
              depth,
              `… ${total - walk.repeatKeep} more similar items`,
            );
          continue;
        }
      }
    }
    walkElement(child, depth, walk);
  }
}

function walkElement(element: Element, depth: number, walk: Walk) {
  if (walk.truncated) return;
  walk.visited += 1;
  if (walk.visited > walk.maxElements) {
    walk.truncated = true;
    return;
  }
  const { ctx } = walk;
  if (
    SKIPPED_TAGS.has(element.localName) ||
    (element.localName === 'dialog' && !element.hasAttribute('open')) ||
    (ctx.skip !== null && element.matches(ctx.skip)) ||
    isAriaHidden(element) ||
    !isRendered(element)
  )
    return;

  if (element.hasAttribute('data-sonner-toast')) {
    const text = clip(ctx, textOf(element), TEXT_MAX);
    if (text) add(walk, depth, `toast ${quote(text)}`);
    return;
  }

  const role = roleOf(element);
  switch (role) {
    case 'heading': {
      const level =
        element.getAttribute('aria-level') ??
        (/^h[1-6]$/.test(element.localName) ? element.localName[1] : '2');
      const text = nameOf(element, ctx);
      if (text) {
        const offscreen = walk.viewport && isOffscreen(element);
        add(
          walk,
          depth,
          `h${level} ${quote(text)}${offscreen ? ' [offscreen]' : ''}`,
        );
      }
      return;
    }
    case 'navigation': {
      const items = visibleDescendants(
        element,
        'a[href], button, [role="button"], [role="link"], [role="tab"]',
        ctx,
      )
        .map((item) => {
          const name = nameOf(item, ctx);
          const current = item.getAttribute('aria-current');
          let label =
            name && current && current !== 'false' ? `${name} [current]` : name;
          if (label && walk.refs) {
            const ref = walk.refs.refFor(item);
            walk.refMap.set(ref, item);
            label += ` [ref=${ref}]`;
          }
          return label;
        })
        .filter(Boolean);
      const name = nameOf(element, ctx);
      if (items.length)
        add(
          walk,
          depth,
          `navigation${name && !items.some((item) => item.startsWith(name)) ? ` ${quote(name)}` : ''}: ${items.join(' · ')}`,
        );
      return;
    }
    case 'tablist': {
      const tabs = visibleDescendants(element, '[role="tab"]', ctx).map((tab) => {
        const states = controlStates(tab, 'tab').filter(
          (state) => state === 'selected' || state === 'disabled',
        );
        let label = `${nameOf(tab, ctx)}${states.length ? ` [${states.join(', ')}]` : ''}`;
        if (walk.refs) {
          const ref = walk.refs.refFor(tab);
          walk.refMap.set(ref, tab);
          label += ` [ref=${ref}]`;
        }
        return label;
      });
      if (tabs.length) add(walk, depth, `tabs: ${tabs.join(' | ')}`);
      walk.tablists.add(element);
      walkChildren(element, depth, walk);
      return;
    }
    case 'table':
    case 'grid':
    case 'treegrid':
      add(walk, depth, tableLine(element, walk));
      walkChildren(element, depth + 1, walk);
      return;
    case 'log': {
      // Conversation logs hold what people said; only their presence matters.
      const name = nameOf(element, ctx);
      add(walk, depth, `log${name ? ` ${quote(name)}` : ''}`);
      return;
    }
    case 'progressbar':
      add(walk, depth, controlLine(element, role, walk));
      return;
    case 'alert':
    case 'status':
    case 'tooltip': {
      const text = clip(ctx, textOf(element), TEXT_MAX);
      if (text) add(walk, depth, `${role} ${quote(text)}`);
      return;
    }
    case 'label':
    case 'legend': {
      const label = element as HTMLLabelElement;
      const labelsControl =
        role === 'label' &&
        (Boolean(label.htmlFor) ||
          Boolean(element.querySelector('input, select, textarea')));
      if (!labelsControl) {
        const text = clip(ctx, textOf(element));
        if (text) add(walk, depth, `${role} ${quote(text)}`);
      }
      walkChildren(element, depth, walk);
      return;
    }
  }

  if (role === 'tab') {
    // Already listed on the tablist line.
    const tablist = element.closest('[role="tablist"]');
    if (tablist && walk.tablists.has(tablist)) return;
  }

  if (role && CONTROL_ROLES.has(role)) {
    // Clickable cards can hold their own buttons (share, menu): list those
    // under the card instead of folding them into its name.
    const nested =
      !isFormField(element) &&
      element.getAttribute('contenteditable') !== 'true' &&
      Boolean(element.querySelector(INTERACTIVE_SELECTOR));
    add(walk, depth, controlLine(element, role, walk, nested));
    if (nested || (role === 'listbox' && element.localName !== 'select'))
      walkChildren(element, depth + 1, walk);
    return;
  }

  if (role && SECTION_ROLES.has(role)) {
    const name = nameOf(element, ctx);
    const header =
      role === 'dialog' || role === 'alertdialog'
        ? `${role}${name ? ` ${quote(name)}` : ''} (open)`
        : `${role}${name && role !== 'main' ? ` ${quote(name)}` : ''}`;
    const start = walk.lines.length;
    add(walk, depth, header);
    if (role === 'dialog' || role === 'alertdialog') {
      const description = referencedText(element, 'aria-describedby', ctx);
      if (description)
        add(
          walk,
          depth + 1,
          `text ${quote(clip(ctx, description, TEXT_MAX))}`,
        );
    }
    walkChildren(element, depth + 1, walk);
    // An empty landmark (like a toast region with no toasts) is noise.
    if (walk.lines.length === start + 1 && !walk.truncated) {
      const [removed] = walk.lines.splice(start, 1);
      walk.chars -= (removed?.length ?? 0) + 1;
    }
    return;
  }

  const live = element.getAttribute('aria-live');
  if (live && live !== 'off' && !element.querySelector('[data-sonner-toast]')) {
    // Short live regions are status messages; long ones are content.
    const text = collapse(textOf(element));
    if (text && text.length <= TEXT_MAX) {
      add(walk, depth, `status ${quote(clip(ctx, text, TEXT_MAX))}`);
      return;
    }
  }

  walkChildren(element, depth, walk);
}

function locationOf(
  doc: Document,
  options: OutlineOptions,
): OutlineLocation | null {
  if (options.location) return options.location;
  const location = doc.location;
  if (!location) return null;
  return {
    pathname: location.pathname,
    search: location.search,
    origin: location.origin,
    href: location.href,
  };
}

function defaultPageAddress(
  location: OutlineLocation,
  keepParams: string[],
): string {
  const params = new URLSearchParams(location.search ?? '');
  const kept = keepParams
    .map((key) => [key, params.get(key)] as const)
    .filter((pair): pair is readonly [string, string] => pair[1] !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  return `${location.pathname}${kept.length ? `?${kept.join('&')}` : ''}`;
}

function scrollLine(doc: Document): string | null {
  const view = doc.defaultView;
  const scroller = doc.scrollingElement;
  if (!view || !scroller) return null;
  const max = scroller.scrollHeight - view.innerHeight;
  if (max <= 4) return null;
  const percent = Math.round((Math.min(scroller.scrollTop, max) / max) * 100);
  if (percent <= 1) return 'Scroll: top, more below';
  if (percent >= 99) return 'Scroll: bottom';
  return `Scroll: ${percent}% down`;
}

/**
 * Outline the page. Returns null when nothing useful was found, so a failed
 * capture never blocks the caller.
 */
export function outline(
  doc: Document = document,
  options: OutlineOptions = {},
  registry?: RefRegistry,
): Outline | null {
  const started =
    typeof performance === 'undefined' ? Date.now() : performance.now();
  const body = doc.body;
  if (!body) return null;
  const location = locationOf(doc, options);
  const walk: Walk = {
    ctx: createContext(doc, options),
    location,
    lines: [],
    chars: 0,
    visited: 0,
    controls: 0,
    truncated: false,
    tablists: new WeakSet(),
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
    maxElements: options.maxElements ?? DEFAULT_MAX_ELEMENTS,
    repeatMin: options.repeatMin ?? 8,
    repeatKeep: options.repeatKeep ?? 3,
    refs: options.refs ? (registry ?? new RefRegistry()) : null,
    refMap: new Map(),
    viewport: options.viewport ?? false,
  };
  if (options.header !== false) {
    if (location) {
      const address = options.pageAddress
        ? options.pageAddress(location)
        : defaultPageAddress(location, options.keepParams ?? ['tab']);
      add(walk, 0, `Page: ${address}`);
    }
    const title = clip(walk.ctx, doc.title ?? '');
    if (title) add(walk, 0, `Title: ${quote(title)}`);
    const view = doc.defaultView;
    if (view?.innerWidth) add(walk, 0, `Viewport: ${view.innerWidth}px wide`);
    if (walk.viewport) {
      const scroll = scrollLine(doc);
      if (scroll) add(walk, 0, scroll);
    }
  }
  const headerLines = walk.lines.length;
  walkElement(body, 0, walk);
  if (walk.lines.length === headerLines) return null;
  if (walk.truncated) {
    const marker = '… (outline truncated)'.slice(0, Math.max(0, walk.maxChars));
    while (walk.lines.length && walk.chars + marker.length > walk.maxChars) {
      walk.chars -= walk.lines.pop()!.length + 1;
    }
    walk.lines.push(marker);
  }
  const text = walk.lines.join('\n');
  const ended =
    typeof performance === 'undefined' ? Date.now() : performance.now();
  return {
    text,
    lines: walk.lines,
    refs: walk.refMap,
    stats: {
      chars: text.length,
      lines: walk.lines.length,
      visited: walk.visited,
      controls: walk.controls,
      truncated: walk.truncated,
      ms: ended - started,
    },
  };
}
