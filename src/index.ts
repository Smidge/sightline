/**
 * Sightline: what's on screen, as text an LLM agent can use. It runs in the
 * page, reads the accessibility tree the way a screen reader does, and never
 * reads what the user typed.
 */
import { describeElement, findControl } from './find';
import { highlight, type HighlightOptions } from './highlight';
import {
  describeInteraction,
  trackInteractions,
  type Interaction,
  type TrackOptions,
} from './interactions';
import {
  RefRegistry,
  outline,
  type Outline,
  type OutlineOptions,
} from './outline';
import { watchPage, type PageChange, type WatchOptions } from './watch';

export { diffLines, type LineDiff } from './diff';
export {
  describeElement,
  findControl,
  type DescribedElement,
  type FindOptions,
} from './find';
export { highlight, type HighlightOptions } from './highlight';
export {
  describeInteraction,
  trackInteractions,
  type Interaction,
  type TrackOptions,
} from './interactions';
export {
  DEFAULT_MAX_CHARS,
  RefRegistry,
  outline,
  type Outline,
  type OutlineLocation,
  type OutlineOptions,
  type OutlineStats,
} from './outline';
export {
  watchPage,
  type PageChange,
  type PageChangeKind,
  type WatchOptions,
} from './watch';

export type SightlineOptions = OutlineOptions & {
  /** The document to read. Default `document`. */
  document?: Document;
};

export type Sightline = {
  /** Outline the page now. Refs stay stable across captures. */
  capture(overrides?: Partial<OutlineOptions>): Outline | null;
  /** The element behind a ref from an earlier capture, if it is still on the page. */
  resolve(ref: string): Element | null;
  /** A visible control by ref (`e12`) or by the name the outline shows. */
  find(target: string, role?: string | null): Element | null;
  /** Ring a control by ref, name or element. Returns false when nothing matched. */
  highlight(
    target: string | Element,
    options?: HighlightOptions & { role?: string | null },
  ): boolean;
  /** Report the page each time it settles into a new state. */
  watch(
    onChange: (change: PageChange) => void,
    options?: WatchOptions,
  ): () => void;
  /** Report clicks, toggles and field focus by role and name. */
  track(
    onInteraction: (interaction: Interaction & { ref: string }) => void,
    options?: TrackOptions,
  ): () => void;
};

const REF_RE = /^(?:ref=)?e\d+$/;

/**
 * One Sightline per page: it keeps element refs stable between captures, so
 * an agent can say "highlight e12" after the page has changed around it.
 */
export function createSightline(options: SightlineOptions = {}): Sightline {
  const { document: providedDoc, ...outlineOptions } = options;
  const doc = providedDoc ?? document;
  const registry = new RefRegistry();
  let captures = 0;

  const capture = (overrides: Partial<OutlineOptions> = {}) => {
    captures += 1;
    if (captures % 50 === 0) registry.prune();
    return outline(
      doc,
      { refs: true, ...outlineOptions, ...overrides },
      registry,
    );
  };

  const find = (target: string, role?: string | null) => {
    if (REF_RE.test(target.trim())) return registry.resolve(target.trim());
    return findControl(
      target,
      { role, skip: outlineOptions.skip, infer: outlineOptions.infer },
      doc,
    );
  };

  return {
    capture,
    resolve: (ref) => registry.resolve(ref),
    find,
    highlight(target, highlightOptions = {}) {
      const element =
        typeof target === 'string'
          ? find(target, highlightOptions.role)
          : target;
      if (!element) return false;
      highlight(element, highlightOptions);
      return true;
    },
    watch(onChange, watchOptions = {}) {
      return watchPage(doc, () => capture(), onChange, {
        skip: outlineOptions.skip,
        ...watchOptions,
      });
    },
    track(onInteraction, trackOptions = {}) {
      return trackInteractions(
        doc,
        (interaction) =>
          onInteraction({
            ...interaction,
            ref: registry.refFor(interaction.element),
          }),
        {
          skip: outlineOptions.skip,
          hintAttribute: outlineOptions.hintAttribute,
          infer: outlineOptions.infer,
          ...trackOptions,
        },
      );
    },
  };
}

/** Convenience re-exports for agents that only need the text. */
export const sightline = {
  outline,
  describeElement,
  describeInteraction,
};
