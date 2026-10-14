import { createInferState, isClickTarget, type InferState } from './infer.js';
import {
  INTERACTIVE_SELECTOR,
  collapse,
  createContext,
  isRendered,
  roleOf,
  shownName,
  type Context,
} from './outline.js';

const FINDABLE_SELECTOR = `${INTERACTIVE_SELECTOR}, [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="progressbar"], [contenteditable="true"]`;

function normalizedName(text: string) {
  return collapse(text).toLowerCase();
}

function isFormField(element: Element): boolean {
  return (
    element.localName === 'input' ||
    element.localName === 'textarea' ||
    element.localName === 'select'
  );
}

function controlName(element: Element, ctx: Context): string {
  const nested =
    !isFormField(element) &&
    Boolean(element.querySelector(INTERACTIVE_SELECTOR));
  return shownName(element, ctx, nested);
}

export type FindOptions = {
  /** Only match this role, such as `button` or `switch`. */
  role?: string | null;
  /** Subtrees to ignore, such as the agent's own panel. */
  skip?: string;
  /** Also match the clickable elements `infer` lists, by the same names. */
  infer?: boolean;
};

function pointerAt(element: Element | null): boolean {
  const view = element?.ownerDocument.defaultView;
  return Boolean(
    element && view && view.getComputedStyle(element).cursor === 'pointer',
  );
}

function clickTarget(element: Element, state: InferState): boolean {
  const view = element.ownerDocument.defaultView;
  return isClickTarget(
    element,
    view?.getComputedStyle(element) ?? null,
    pointerAt(element.parentElement),
    state,
  );
}

/** The name `infer` gives a clickable element: its text, else a guess. */
function clickableName(element: Element, ctx: Context): string {
  const nested = Boolean(element.querySelector(INTERACTIVE_SELECTOR));
  return shownName(element, ctx, nested, 'clickable');
}

/** Every element, including inside open shadow roots when `deep`. */
function* allElements(
  root: Document | ShadowRoot | Element,
  deep: boolean,
): Generator<Element> {
  for (const element of root.querySelectorAll('*')) {
    yield element;
    if (deep && element.shadowRoot)
      yield* allElements(element.shadowRoot, deep);
  }
}

/** The nearest clickable element at or above a click, within a few levels. */
function clickableAncestor(start: Element, state: InferState): Element | null {
  let node: Element | null = start;
  for (let level = 0; node && level < 8; level += 1) {
    if (clickTarget(node, state)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * The visible control a name refers to, using the same names as the outline.
 * Exact names win over partial ones. Returns null when nothing matches.
 */
export function findControl(
  name: string,
  options: FindOptions = {},
  doc: Document = document,
): HTMLElement | null {
  const want = normalizedName(name);
  if (!want) return null;
  const ctx = createContext(doc, { skip: options.skip, infer: options.infer });
  const state = ctx.infer;
  const visible = (element: Element) =>
    !(options.skip && element.closest(options.skip)) &&
    !element.closest('[aria-hidden="true"], [hidden], [inert]') &&
    isRendered(element);
  // With infer, every element is a candidate (clickable divs, shadow roots);
  // without it, only real controls are, as before.
  const candidates: Iterable<Element> = state
    ? allElements(doc, true)
    : doc.querySelectorAll(FINDABLE_SELECTOR);
  let exactClickable: Element | null = null;
  let partial: Element | null = null;
  let partialClickable: Element | null = null;
  for (const element of candidates) {
    const semantic = element.matches(FINDABLE_SELECTOR);
    if (!semantic && (!state || roleOf(element))) continue;
    const role = semantic ? roleOf(element) : 'clickable';
    if (options.role && role !== options.role) continue;
    if (!visible(element)) continue;
    if (!semantic && !clickTarget(element, state!)) continue;
    const elementName = normalizedName(
      semantic ? controlName(element, ctx) : clickableName(element, ctx),
    );
    if (!elementName) continue;
    if (elementName === want) {
      if (semantic) return element as HTMLElement;
      exactClickable ??= element;
    } else if (elementName.includes(want)) {
      if (semantic) partial ??= element;
      else partialClickable ??= element;
    }
  }
  // An exact name of either kind beats a partial one.
  return (exactClickable ?? partial ?? partialClickable) as HTMLElement | null;
}

export type DescribedElement = {
  role: string;
  name: string;
  /** The host's hint attribute (for example `data-attr`), when present. */
  hint: string | null;
  element: Element;
};

/**
 * The control an event landed on, by role and accessible name, so a click
 * can be reported to an agent without reading any value. Null outside any
 * control or inside a skipped subtree.
 */
export function describeElement(
  target: EventTarget | null,
  options: { skip?: string; hintAttribute?: string; infer?: boolean } = {},
  doc?: Document,
): DescribedElement | null {
  if (!target || typeof (target as Element).closest !== 'function') return null;
  const start = target as Element;
  if (options.skip && start.closest(options.skip)) return null;
  const semantic =
    start.closest('[contenteditable="true"]') ??
    start.closest(FINDABLE_SELECTOR);
  const clickable =
    !semantic && options.infer
      ? clickableAncestor(start, createInferState(start.ownerDocument))
      : null;
  const control = semantic ?? clickable;
  if (!control) return null;
  const ctx = createContext(doc ?? control.ownerDocument, {
    skip: options.skip,
    hintAttribute: options.hintAttribute,
    infer: options.infer,
  });
  const hintAttribute = options.hintAttribute ?? 'data-testid';
  return {
    role: clickable ? 'clickable' : (roleOf(control) ?? control.localName),
    name: clickable ? clickableName(control, ctx) : controlName(control, ctx),
    hint:
      start.closest(`[${hintAttribute}]`)?.getAttribute(hintAttribute) ?? null,
    element: control,
  };
}
