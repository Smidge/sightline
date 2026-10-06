import {
  INTERACTIVE_SELECTOR,
  collapse,
  createContext,
  isRendered,
  nameOf,
  roleOf,
  type Context,
} from './outline';

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
  return nameOf(element, ctx, nested);
}

export type FindOptions = {
  /** Only match this role, such as `button` or `switch`. */
  role?: string | null;
  /** Subtrees to ignore, such as the agent's own panel. */
  skip?: string;
};

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
  const ctx = createContext(doc, { skip: options.skip });
  let partial: HTMLElement | null = null;
  for (const element of doc.querySelectorAll<HTMLElement>(FINDABLE_SELECTOR)) {
    if (
      (options.skip && element.closest(options.skip)) ||
      element.closest('[aria-hidden="true"], [hidden], [inert]') ||
      !isRendered(element)
    )
      continue;
    if (options.role && roleOf(element) !== options.role) continue;
    const elementName = normalizedName(controlName(element, ctx));
    if (!elementName) continue;
    if (elementName === want) return element;
    if (!partial && elementName.includes(want)) partial = element;
  }
  return partial;
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
  options: { skip?: string; hintAttribute?: string } = {},
  doc?: Document,
): DescribedElement | null {
  if (!target || typeof (target as Element).closest !== 'function') return null;
  const start = target as Element;
  if (options.skip && start.closest(options.skip)) return null;
  const control =
    start.closest('[contenteditable="true"]') ?? start.closest(FINDABLE_SELECTOR);
  if (!control) return null;
  const ctx = createContext(doc ?? control.ownerDocument, {
    skip: options.skip,
    hintAttribute: options.hintAttribute,
  });
  const hintAttribute = options.hintAttribute ?? 'data-testid';
  return {
    role: roleOf(control) ?? control.localName,
    name: controlName(control, ctx),
    hint:
      start.closest(`[${hintAttribute}]`)?.getAttribute(hintAttribute) ?? null,
    element: control,
  };
}
