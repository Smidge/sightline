/**
 * Reading pages that don't use semantic HTML. Many sites build buttons from
 * plain divs with a click handler, leave icon buttons unnamed, style big bold
 * text as headings and build modals from fixed divs. With `infer` on, the
 * outline treats those as a sighted user would. Everything here is a guess,
 * so the outline marks guessed names with where they came from.
 */
import { INTERACTIVE_SELECTOR, collapse, textOf } from './outline.js';

export type InferState = {
  /** Body text size, the baseline for spotting headings by size. */
  baseFontSize: number;
  viewportArea: number;
};

export function createInferState(doc: Document): InferState {
  const view = doc.defaultView;
  const body = doc.body;
  const size =
    body && view ? parseFloat(view.getComputedStyle(body).fontSize) : 0;
  return {
    baseFontSize: size > 0 ? size : 16,
    viewportArea: view ? view.innerWidth * view.innerHeight : 0,
  };
}

const REACT_HANDLERS = [
  'onClick',
  'onMouseDown',
  'onMouseUp',
  'onPointerDown',
  'onPointerUp',
  'onTouchStart',
  'onTouchEnd',
];

type Handlers = Record<string, unknown>;

/** React keeps a host element's props on it under `__reactProps$<id>`. */
function reactProps(element: Element): Handlers | null {
  for (const key of Object.keys(element)) {
    if (key.startsWith('__reactProps$'))
      return (element as unknown as Record<string, Handlers>)[key] ?? null;
  }
  return null;
}

/**
 * Whether script listens for clicks on this element: an inline handler, a
 * handler property, React or Vue props, or jQuery. Listeners added with
 * `addEventListener` are invisible to page script, which is why the walker
 * also counts a pointer cursor.
 */
export function hasClickHandler(element: Element): boolean {
  if (element.hasAttribute('onclick') || element.hasAttribute('onmousedown'))
    return true;
  const html = element as HTMLElement;
  if (typeof html.onclick === 'function') return true;
  const props = reactProps(element);
  if (props && REACT_HANDLERS.some((name) => typeof props[name] === 'function'))
    return true;
  const vue = (element as unknown as { _vei?: Handlers })._vei;
  if (vue && (vue.onClick || vue.onMousedown || vue.onPointerdown)) return true;
  const jquery = (
    element.ownerDocument.defaultView as unknown as {
      jQuery?: {
        _data?: (element: Element, key: string) => Handlers | undefined;
      };
    } | null
  )?.jQuery;
  const events = jquery?._data?.(element, 'events');
  return Boolean(events && (events.click || events.mousedown));
}

function labelsAControl(element: Element): boolean {
  return (
    element.localName === 'label' &&
    (Boolean((element as HTMLLabelElement).htmlFor) ||
      Boolean(element.querySelector('input, select, textarea')))
  );
}

/**
 * Whether an element without a role is something the user clicks: it has a
 * click handler, or it is where a pointer cursor starts. A pointer cursor
 * around real controls is styling, and a handler on a backdrop or page
 * wrapper (to close menus) is not a control, so both are left out.
 */
export function isClickTarget(
  element: Element,
  style: CSSStyleDeclaration | null,
  parentPointer: boolean,
  state: InferState,
): boolean {
  const tag = element.localName;
  if (
    tag === 'body' ||
    tag === 'html' ||
    tag === 'main' ||
    labelsAControl(element)
  )
    return false;
  const handler = hasClickHandler(element);
  const pointerStart = style?.cursor === 'pointer' && !parentPointer;
  if (!handler && !pointerStart) return false;
  // Around a real link or button (a card with an analytics handler, a
  // pointer cursor on a wrapper), the real control is the target.
  if (element.querySelector(INTERACTIVE_SELECTOR)) return false;
  // A modal box or form that stops clicks from closing it holds fields; it
  // is a container, not something to click.
  if (
    element.querySelector('input, select, textarea, [contenteditable="true"]')
  )
    return false;
  const rect = element.getBoundingClientRect();
  // Without layout (a test DOM) sizes are zero and can't rule anything out.
  if (rect.width > 0 || rect.height > 0) {
    if (rect.width < 4 || rect.height < 4) return false;
    if (
      state.viewportArea &&
      rect.width * rect.height > state.viewportArea * 0.5
    )
      return false;
  }
  return element.getElementsByTagName('*').length <= 150;
}

const INLINE_TAGS = new Set([
  'span',
  'b',
  'strong',
  'em',
  'i',
  'small',
  'br',
  'sup',
  'sub',
  'mark',
  'u',
  'font',
  'slot',
]);

/**
 * A heading level for short text set noticeably larger (or larger and bold)
 * than the body text, or null. Only blocks holding plain or inline text count.
 */
export function styledHeadingLevel(
  element: Element,
  style: CSSStyleDeclaration | null,
  state: InferState,
): number | null {
  if (!style) return null;
  const size = parseFloat(style.fontSize);
  if (!(size > 0)) return null;
  const ratio = size / state.baseFontSize;
  const weight =
    style.fontWeight === 'bold' || style.fontWeight === 'bolder'
      ? 700
      : Number.parseInt(style.fontWeight, 10) || 400;
  if (!(ratio >= 1.6 || (ratio >= 1.25 && weight >= 600))) return null;
  for (const child of element.children)
    if (!INLINE_TAGS.has(child.localName)) return null;
  const text = collapse(textOf(element));
  if (text.length < 2 || text.length > 80) return null;
  // Shops set prices large and bold; a price is not a heading.
  if (/[£$€¥₹]\s*\d|\d\s*(?:€|zł|kr|kč)/i.test(text)) return null;
  return ratio >= 2 ? 1 : ratio >= 1.5 ? 2 : 3;
}

/* Guessed names ----------------------------------------------------------- */

/** Words in class names and ids that say nothing about what a control does. */
const FILLER = new Set(
  `div span container wrapper wrap inner outer content contents box item items el elem element
  component comp module block section css js is has bg col row flex grid icon icons ico svg img
  image pic fa fas far fal fab fad fat fass bi mdi ri ti lucide glyphicon glyphicons material
  symbols outlined round rounded sharp line fill filled solid regular light duotone thin bold sm
  md lg xl xs xxl small large medium big primary secondary tertiary default active selected
  disabled visible btn button buttons link links clickable cursor pointer hover focus holder root
  base ui ux mui ant chakra vue react ng sc styled emotion jsx global theme dark white black gray
  grey color colour text label title inline relative absolute fixed sticky heroicon heroicons
  octicon ion ionicon ionicons feather tabler ph la las lar lab gg svgrepo trigger control ctrl
  widget layout area panel view style styles class main common shared new old outline two tone
  twotone`.split(/\s+/),
);

const SYNONYMS: Record<string, string> = {
  x: 'close',
  xmark: 'close',
  times: 'close',
  cross: 'close',
  hamburger: 'menu',
  burger: 'menu',
  bars: 'menu',
  magnifier: 'search',
  magnifying: 'search',
  loupe: 'search',
  kebab: 'more options',
  ellipsis: 'more options',
  dots: 'more options',
  meatballs: 'more options',
  cog: 'settings',
  gear: 'settings',
  gears: 'settings',
  prev: 'previous',
  chevron: 'arrow',
  caret: 'arrow',
  angle: 'arrow',
};

/** Words that are short but real. */
const SHORT_WORDS = new Set([
  'x',
  'up',
  'add',
  'bag',
  'car',
  'cog',
  'eye',
  'map',
  'pen',
  'pin',
  'tv',
  'faq',
  'buy',
  'cart',
  'new',
  'off',
  'on',
  'go',
]);

const UTILITY_CLASS =
  /^(?:-?[mp][trblxy]?|[wh]|gap|space|text|bg|border|rounded|shadow|font|leading|tracking|items|justify|content|self|place|flex|grid|col|row|z|top|left|right|bottom|inset|overflow|opacity|cursor|transition|duration|delay|ease|ring|outline|min|max|aspect|object|translate|scale|rotate|skew|origin|fill|stroke|sr|not|group|peer|order|basis|grow|shrink|line|size|decoration|underline|whitespace|break|select|pointer|align|list|from|to|via|divide|backdrop|blur|filter|drop|animate)-/;
const UTILITY_WORDS = new Set([
  'flex',
  'hidden',
  'block',
  'inline',
  'relative',
  'absolute',
  'fixed',
  'sticky',
  'grid',
  'contents',
  'truncate',
  'uppercase',
  'lowercase',
  'capitalize',
  'italic',
  'underline',
  'transform',
  'container',
  'group',
  'peer',
  'visible',
  'invisible',
  'shrink',
  'grow',
  'border',
  'rounded',
  'shadow',
  'antialiased',
]);

function looksHashed(word: string): boolean {
  return (
    /\d/.test(word) ||
    !/[aeiouy]/.test(word) ||
    /[bcdfghjklmnpqrstvwxz]{5,}/.test(word)
  );
}

/** Words from an identifier such as `btnAddToCart`, `icon-close` or `fa-trash-can`. */
const COMPOUNDS: Array<[RegExp, string]> = [
  [/magnifying[-_ ]?glass/gi, 'search'],
  [/x[-_]?mark/gi, 'close'],
  [/more[-_]?(?:vert|horiz|vertical|horizontal)/gi, 'more options'],
  [/dots[-_]?(?:vertical|horizontal|three)/gi, 'more options'],
];

export function identifierWords(identifier: string): string[] {
  const words: string[] = [];
  let source = identifier;
  for (const [pattern, word] of COMPOUNDS)
    source = source.replace(pattern, ` ${word} `);
  for (const raw of source
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)) {
    if (!raw || FILLER.has(raw)) continue;
    if (raw.length < 3 && !SHORT_WORDS.has(raw)) continue;
    if (!SHORT_WORDS.has(raw) && looksHashed(raw)) continue;
    const word = SYNONYMS[raw] ?? raw;
    if (!words.includes(word)) words.push(word);
  }
  return words.slice(0, 4);
}

function classTokens(element: Element): string[] {
  const value = element.getAttribute('class');
  if (!value) return [];
  return value
    .split(/\s+/)
    .filter(
      (token) =>
        token &&
        !token.includes(':') &&
        !token.includes('[') &&
        !UTILITY_CLASS.test(token) &&
        !UTILITY_WORDS.has(token),
    );
}

const ICON_CLASS =
  /^(?:fa[a-z]?|bi|mdi|ri|ti|lucide|glyphicon|icon|icons|ico|la[srb]?|ion|ionicon|ph|octicon|feather|tabler-icon|gg|material-(?:icons|symbols)(?:-[a-z]+)?|svg-inline--fa|i)[-_]/;

function iconName(element: Element): string | null {
  const href =
    element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
  if (element.localName === 'use' && href.includes('#')) {
    const words = identifierWords(href.slice(href.lastIndexOf('#') + 1));
    if (words.length) return words.join(' ');
  }
  const dataIcon = element.getAttribute('data-icon');
  if (dataIcon) {
    const words = identifierWords(dataIcon);
    if (words.length) return words.join(' ');
  }
  // Material UI names its icons in a test id: data-testid="DeleteIcon".
  const testId = element.getAttribute('data-testid') ?? '';
  if (/icon$/i.test(testId)) {
    const words = identifierWords(testId);
    if (words.length) return words.join(' ');
  }
  for (const token of classTokens(element)) {
    if (!ICON_CLASS.test(token)) continue;
    const words = identifierWords(token);
    if (words.length) return words.join(' ');
  }
  return null;
}

function fileWords(source: string | null): string | null {
  if (!source || source.startsWith('data:')) return null;
  const file = source.split(/[?#]/)[0]?.split('/').pop() ?? '';
  const words = identifierWords(
    file.replace(/\.[a-z0-9]+$/i, '').replace(/@\dx$/, ''),
  );
  return words.length ? words.join(' ') : null;
}

const TOOLTIP_ATTRIBUTES = [
  'data-tooltip',
  'data-tip',
  'data-title',
  'data-original-title',
  'data-bs-original-title',
  'data-label',
  'data-hint',
  'data-balloon',
];

/**
 * Words that say what a control does. Ids, classes, test ids and image file
 * names are full of design-system and CDN jargon ("tux tooltip reference",
 * "tiktokx cropcenter"), so a guess from them keeps only these words.
 */
const ACTION_WORDS = new Set(
  `close search menu cart basket bag checkout buy pay order share like favourite favorite wishlist
  heart star bookmark save play pause stop mute unmute volume fullscreen expand collapse next
  previous back forward delete remove trash bin edit add plus minus new create upload download
  attach send submit login logout signin signout signup register account profile user avatar
  settings options more filter sort refresh reload copy paste print help info notifications
  notification bell inbox message messages chat comment comments reply follow subscribe
  unsubscribe home dashboard calendar date time location map phone email mail call language
  currency country region gift coupon voucher camera photo video image mic microphone emoji zoom
  scroll carousel slide arrow left right up down top bottom toggle checkbox switch dropdown
  select radio accept decline dismiss cancel confirm continue done ok apply clear reset undo redo
  logo translate theme lock unlock show hide visibility password eye compare open`.split(
    /\s+/,
  ),
);
const DIRECTIONS = new Set(['left', 'right', 'up', 'down', 'top', 'bottom']);
const MOTION = new Set(['arrow', 'scroll', 'carousel', 'slide']);

/** A weak guess, kept only when it says what the control does, else []. */
function actionWords(words: string[], fromFileName = false): string[] {
  // A logo file is named after its site ("bloom-logo.png"); a logo class
  // carries build hashes too, so only the word logo is safe there.
  if (words.includes('logo'))
    return fromFileName ? words.slice(0, 3) : ['logo'];
  // "top right" alone is a position, not an action; "arrow right" is one.
  const motion = words.some((word) => MOTION.has(word));
  const kept = words.filter((word) => motion || !DIRECTIONS.has(word));
  return kept.some((word) => ACTION_WORDS.has(word)) ? kept.slice(0, 3) : [];
}

const IDENTIFIER_ATTRIBUTES: Array<[string, string]> = [
  ['data-testid', 'test id'],
  ['data-test', 'test id'],
  ['data-test-id', 'test id'],
  ['data-qa', 'test id'],
  ['data-cy', 'test id'],
  ['data-action', 'data-action'],
  ['name', 'name attribute'],
  ['id', 'id'],
];

export type GuessedName = {
  name: string;
  from: string;
  /** Tooltips, icons and images name a control well; ids and classes less so. */
  strong: boolean;
};

const SYMBOL_NAMES: Record<string, string> = {
  '×': 'close',
  '✕': 'close',
  '✖': 'close',
  '⨯': 'close',
  '☰': 'menu',
  '≡': 'menu',
  '⋮': 'more options',
  '⋯': 'more options',
  '…': 'more options',
  '‹': 'previous',
  '«': 'previous',
  '←': 'previous',
  '›': 'next',
  '»': 'next',
  '→': 'next',
  '♡': 'favourite',
  '♥': 'favourite',
  '❤': 'favourite',
  '☆': 'favourite',
  '★': 'favourite',
  '+': 'add',
  '−': 'remove',
  '🔍': 'search',
  '🛒': 'cart',
};

/** What a control named only by a symbol, such as × or ☰, does. */
export function symbolName(name: string): string | null {
  return SYMBOL_NAMES[name.replace(/\uFE0F/g, '').trim()] ?? null;
}

/**
 * The short text just before a field, as in `<div>Email</div><input>`:
 * how div-soup forms label their fields.
 */
export function textBefore(element: Element): string {
  let node: Element | null = element;
  for (let level = 0; node && level < 2; level += 1) {
    let sibling = node.previousElementSibling;
    for (let step = 0; sibling && step < 2; step += 1) {
      if (!sibling.querySelector('input, select, textarea, button, a[href]')) {
        const text = collapse(textOf(sibling));
        if (text) return text.length <= 40 ? text : '';
      }
      sibling = sibling.previousElementSibling;
    }
    // Only climb out of a wrapper that holds nothing but this field.
    const parent: Element | null = node.parentElement;
    if (!parent || parent.children.length > 1) return '';
    node = parent;
  }
  return '';
}

/**
 * A name for a control that has none, from what a developer left behind: a
 * tooltip attribute, the icon inside it, an image file name, a test id, its
 * id or its class names. Null when nothing readable is there.
 */
export function guessName(element: Element): GuessedName | null {
  for (const attribute of TOOLTIP_ATTRIBUTES) {
    const value = collapse(element.getAttribute(attribute) ?? '');
    if (value) return { name: value, from: 'tooltip', strong: true };
  }
  const parts = [
    element,
    ...element.querySelectorAll(
      'svg, use, i, span, img, [data-icon], [data-testid]',
    ),
  ].slice(0, 16);
  for (const part of parts) {
    const icon = iconName(part);
    if (icon) return { name: icon, from: 'icon', strong: true };
  }
  for (const part of parts) {
    const image =
      part.localName === 'img' && !part.getAttribute('alt')
        ? fileWords(part.getAttribute('src'))
        : null;
    const named = image ? actionWords(image.split(' '), true) : [];
    if (named.length)
      return { name: named.join(' '), from: 'image file name', strong: true };
  }
  if (
    element.localName === 'input' &&
    element.getAttribute('type') === 'image'
  ) {
    const image = fileWords(element.getAttribute('src'));
    const named = image ? actionWords(image.split(' '), true) : [];
    if (named.length)
      return { name: named.join(' '), from: 'image file name', strong: true };
  }
  for (const [attribute, from] of IDENTIFIER_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    const words = value ? actionWords(identifierWords(value)) : [];
    if (words.length) return { name: words.join(' '), from, strong: false };
  }
  const own = classTokens(element).flatMap((token) => identifierWords(token));
  const unique = actionWords([...new Set(own)]).slice(0, 3);
  return unique.length
    ? { name: unique.join(' '), from: 'class name', strong: false }
    : null;
}

/* Div modals --------------------------------------------------------------- */

/**
 * A modal built from plain divs: a fixed element on top at the centre of the
 * viewport that covers a good part of it, holds something to click and is
 * not the whole app. Null when there is none, or the page marks its own
 * modal (the walker already shows only that one).
 */
export function findOverlay(
  doc: Document,
  skip: string | null,
): Element | null {
  const view = doc.defaultView;
  const body = doc.body;
  if (!view || !body || !view.innerWidth || !view.innerHeight) return null;
  if (doc.querySelector('[aria-modal="true"], dialog[open]')) return null;
  const top = doc.elementFromPoint?.(view.innerWidth / 2, view.innerHeight / 2);
  if (!top || top === body || top === doc.documentElement) return null;
  let fixed: Element | null = null;
  for (
    let node: Element | null = top;
    node && node !== body;
    node = node.parentElement
  ) {
    if (view.getComputedStyle(node).position === 'fixed') fixed = node;
  }
  if (!fixed || (skip && fixed.closest(skip))) return null;
  const rect = fixed.getBoundingClientRect();
  if (rect.width * rect.height < view.innerWidth * view.innerHeight * 0.2)
    return null;
  const inside = fixed.getElementsByTagName('*').length;
  if (inside * 2 > body.getElementsByTagName('*').length) return null;
  if (!fixed.querySelector(`${INTERACTIVE_SELECTOR}, [onclick], [tabindex]`)) {
    const pointer = [...fixed.getElementsByTagName('*')].some(
      (element) => view.getComputedStyle(element).cursor === 'pointer',
    );
    if (!pointer) return null;
  }
  return fixed;
}

/** A modal's title: its label, or the first heading or bold line in it. */
export function overlayName(overlay: Element): string {
  const label = overlay.getAttribute('aria-label');
  if (label?.trim()) return collapse(label);
  const heading = overlay.querySelector(
    'h1, h2, h3, h4, [role="heading"], strong, b',
  );
  return heading ? collapse(textOf(heading)) : '';
}
