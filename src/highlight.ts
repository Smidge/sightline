export type HighlightOptions = {
  /** How long the ring stays. Default 2,400 ms. */
  durationMs?: number;
  /** Pulse length. Default 800 ms. Ignored with reduced motion. */
  pulseMs?: number;
  /** Skip the pulse and the smooth scroll. Defaults to the user's setting. */
  reducedMotion?: boolean;
  /** Ring colour. Default `#2f6bff`. */
  color?: string;
  /** Scroll the element into view first. Default true. */
  scroll?: boolean;
};

const RING_ATTRIBUTE = 'data-sightline-ring';

/**
 * Draws a ring over an element so a person can find what an agent named. The
 * ring sits above the page, ignores the pointer and is hidden from assistive
 * technology; the element itself is not changed. Returns a function that
 * removes the ring early.
 */
export function highlight(
  element: Element,
  options: HighlightOptions = {},
): () => void {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  const reducedMotion =
    options.reducedMotion ??
    Boolean(view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const duration = options.durationMs ?? 2_400;
  const pulse = options.pulseMs ?? 800;
  const color = options.color ?? '#2f6bff';
  doc.querySelector(`[${RING_ATTRIBUTE}]`)?.remove();
  if (options.scroll !== false && 'scrollIntoView' in element) {
    (element as HTMLElement).scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }
  const ring = doc.createElement('div');
  ring.setAttribute('aria-hidden', 'true');
  ring.setAttribute(RING_ATTRIBUTE, '');
  Object.assign(ring.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483646',
    borderRadius: '8px',
    border: `2px solid ${color}`,
    boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 28%, transparent)`,
    boxSizing: 'border-box',
  });
  doc.body.append(ring);
  const place = () => {
    const rect = element.getBoundingClientRect();
    ring.style.top = `${rect.top - 4}px`;
    ring.style.left = `${rect.left - 4}px`;
    ring.style.width = `${rect.width + 8}px`;
    ring.style.height = `${rect.height + 8}px`;
  };
  place();
  if (!reducedMotion && typeof ring.animate === 'function') {
    ring.animate([{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }], {
      duration: pulse,
      iterations: Math.max(1, Math.floor(duration / pulse)),
      easing: 'ease-in-out',
    });
  }
  const started = Date.now();
  let frame = 0;
  const follow = () => {
    if (!ring.isConnected) return;
    if (Date.now() - started >= duration) {
      ring.remove();
      return;
    }
    place();
    frame = view?.requestAnimationFrame(follow) ?? 0;
  };
  frame = view?.requestAnimationFrame(follow) ?? 0;
  return () => {
    if (frame) view?.cancelAnimationFrame(frame);
    ring.remove();
  };
}
