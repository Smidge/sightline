import { describeElement } from './find.js';
import { clip, createContext, controlStates, roleOf } from './outline.js';

export type Interaction = {
  type: 'click' | 'toggle' | 'select' | 'focus' | 'edit' | 'submit';
  role: string;
  name: string;
  /** For toggles: on/off/checked/unchecked. For edits: `empty` or `filled`. */
  state?: string;
  /** For selects: the chosen option's text (a fixed option, never typed text). */
  option?: string;
  hint: string | null;
  element: Element;
  at: number;
};

export type TrackOptions = {
  /** Subtrees to ignore, such as the agent's own panel. */
  skip?: string;
  hintAttribute?: string;
  /** Ignore a repeat of the same interaction within this time. Default 300 ms. */
  dedupeMs?: number;
  /** Also report clicks on the clickable elements `infer` lists. */
  infer?: boolean;
};

const TEXT_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox']);

/**
 * Reports what the user does, by control role and accessible name: clicks,
 * toggles, chosen options, focus moving into a field, and whether a field was
 * left empty or filled. It never reports what was typed.
 */
export function trackInteractions(
  doc: Document,
  onInteraction: (interaction: Interaction) => void,
  options: TrackOptions = {},
): () => void {
  const dedupeMs = options.dedupeMs ?? 300;
  let stopped = false;
  const ctx = createContext(doc);
  let last = '';
  let lastAt = 0;

  const report = (
    type: Interaction['type'],
    target: EventTarget | null,
    extra: Partial<Interaction> = {},
  ) => {
    if (stopped) return;
    const described = describeElement(target, options, doc);
    if (!described || !described.name) return;
    const at = Date.now();
    const key = `${type}|${described.role}|${described.name}|${extra.state ?? ''}|${extra.option ?? ''}`;
    if (key === last && at - lastAt < dedupeMs) return;
    last = key;
    lastAt = at;
    onInteraction({
      type,
      role: described.role,
      name: described.name,
      hint: described.hint,
      element: described.element,
      at,
      ...extra,
    });
  };

  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    if (!target?.closest) return;
    // Native fields report through change and focus instead: a click on a
    // checkbox is a toggle, a click into a text field is focus.
    const field = target.closest('input, select, textarea');
    if (field) {
      const type = (field as HTMLInputElement).type;
      const isButton =
        field.localName === 'input' &&
        ['button', 'submit', 'reset', 'image'].includes(type);
      if (!isButton) return;
    }
    const custom = target.closest(
      '[role="switch"], [role="checkbox"], [role="radio"]',
    );
    if (custom) {
      const role = roleOf(custom) ?? 'switch';
      // Custom toggles flip aria-checked after the click handler runs.
      setTimeout(() => {
        const state = controlStates(custom, role).find((value) =>
          ['on', 'off', 'checked', 'unchecked', 'mixed'].includes(value),
        );
        report('toggle', custom, state ? { state } : {});
      }, 0);
      return;
    }
    report('click', target);
  };

  const onChange = (event: Event) => {
    const target = event.target as Element | null;
    if (!target) return;
    const role = roleOf(target) ?? '';
    if (target.localName === 'select') {
      const option = (target as HTMLSelectElement).selectedOptions[0];
      report('select', target, {
        option: option ? clip(ctx, option.textContent ?? '') : undefined,
      });
      return;
    }
    if (role === 'checkbox' || role === 'radio' || role === 'switch') {
      const state = controlStates(target, role).find((value) =>
        ['on', 'off', 'checked', 'unchecked', 'mixed'].includes(value),
      );
      report('toggle', target, state ? { state } : {});
      return;
    }
    if (TEXT_ROLES.has(role)) {
      const value =
        target.getAttribute('contenteditable') === 'true'
          ? (target.textContent ?? '')
          : ((target as HTMLInputElement).value ?? '');
      report('edit', target, { state: value.trim() ? 'filled' : 'empty' });
    }
  };

  const onFocus = (event: Event) => {
    const target = event.target as Element | null;
    if (!target) return;
    if (TEXT_ROLES.has(roleOf(target) ?? '') && target.localName !== 'select')
      report('focus', target);
  };

  const onSubmit = (event: Event) => {
    const form = event.target as HTMLFormElement | null;
    const submitter = (event as SubmitEvent).submitter ?? form;
    report('submit', submitter);
  };

  doc.addEventListener('click', onClick, true);
  doc.addEventListener('change', onChange, true);
  doc.addEventListener('focusin', onFocus, true);
  doc.addEventListener('submit', onSubmit, true);
  return () => {
    stopped = true;
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('change', onChange, true);
    doc.removeEventListener('focusin', onFocus, true);
    doc.removeEventListener('submit', onSubmit, true);
  };
}

/** A short sentence for an agent, such as `clicked button "New Key"`. */
export function describeInteraction(interaction: Interaction): string {
  const target = `${interaction.role} "${interaction.name}"`;
  switch (interaction.type) {
    case 'click':
      return `clicked ${target}`;
    case 'toggle':
      return `turned ${target}${interaction.state ? ` ${interaction.state}` : ''}`;
    case 'select':
      return `chose "${interaction.option ?? ''}" in ${target}`;
    case 'focus':
      return `moved into ${target}`;
    case 'edit':
      return `${interaction.state === 'empty' ? 'cleared' : 'filled in'} ${target}`;
    case 'submit':
      return `submitted ${target}`;
  }
}
