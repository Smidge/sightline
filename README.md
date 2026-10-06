# Sightline

What's on the screen, as text an LLM agent can use.

Sightline runs inside the page. It reads the accessibility tree the way a screen reader does and turns it into a compact outline: roles, accessible names, states, the dialog that's open, alerts and form errors. An agent built into your app can then answer "why can't I click Generate?" from what's actually rendered instead of from documentation that may be out of date.

```
Page: /api-keys
Title: "Anam Lab"
Viewport: 1440px wide
Scroll: top, more below
navigation "Main navigation": Personas [ref=e1] · API Keys [current] [ref=e3] · Sessions [ref=e4]
main
  h1 "API Keys"
  button "New Key" [ref=e5]
  searchbox "Search API keys..." [empty] [ref=e6]
  table: columns Key ID | Label | Created | Actions; 9 rows
    button "1675c7a…3cd2" [ref=e7]
    button "Open actions for production" [collapsed, opens menu] [ref=e8]
    … 6 more similar items
```

It was built for Anam's in-app assistant, Sophie. In Anam's evaluation, questions about the open page passed in 30 of 30 runs with the outline against 3 of 6 without it, and the median answer came in 3.8 s instead of 10.0 s. It now also powers a live avatar version of Sophie that watches the page and guides people step by step.

## Why another snapshot library

Playwright's AI snapshot and its in-page forks (`ivya`, `aria-snapshot`) produce a similar outline. Sightline is built for a different job: an assistant inside your own product, looking at a real user's screen. That changes the rules:

- **It never reads what the user typed.** Text fields show only `[empty]`. Contenteditable text, passwords and field values never appear in the outline or in interaction events. Email addresses become `[email]` unless you allow them.
- **It shows only the open dialog.** Content behind a modal (`aria-hidden` or `inert`) is skipped, so the agent describes what the user can act on now.
- **It fits a budget.** Runs of similar items shorten to the first three plus a count. Tables become columns and a row count. The output stops at a character cap (6,000 by default, about 1,500 tokens).
- **It runs in the page.** There's no CDP, browser extension or server. It has no dependencies and builds an outline in a few milliseconds on real app pages.
- **It skips your agent's own UI.** Pass a selector and the chat panel never describes itself.
- **It follows a live session.** `watch` reports navigation, dialogs and alerts once the page has settled. `track` reports what the user clicked or toggled, by name. Refs stay stable between captures, so an agent can say "highlight e5" after the page has changed around it.

## Usage

```ts
import { createSightline } from '@anam-ai/sightline';

const sightline = createSightline({
  skip: '[data-agent-panel]', // never describe the agent's own UI
  viewport: true,             // mark [offscreen] controls, add a Scroll: line
});

// Send with each message to your LLM.
const outline = sightline.capture();
await chat.send({ text: question, pageOutline: outline?.text });

// Let the agent point at things.
sightline.highlight('e5');             // by ref from the outline
sightline.highlight('New Key');        // or by visible name

// Keep a live agent up to date.
const stopWatching = sightline.watch((change) => {
  // change.kind: initial | navigation | dialog-opened | dialog-closed | alert | update
  agent.addContext(`[screen] ${change.kind} ${change.path}\n${change.outline.text}`);
});
const stopTracking = sightline.track((interaction) => {
  agent.addContext(`[user] ${interaction.type} ${interaction.role} "${interaction.name}"`);
});
```

Lower-level functions are exported too: `outline(document, options)`, `findControl`, `describeElement`, `watchPage`, `trackInteractions`, `describeInteraction`, `diffLines` and `highlight`.

### Options

| Option | Default | Purpose |
| --- | --- | --- |
| `skip` | none | Selector for subtrees to leave out |
| `maxChars` | 6000 | Character budget; the outline ends with `… (outline truncated)` |
| `maxElements` | 20000 | Element budget for one walk |
| `refs` | `true` in `createSightline` | Add `[ref=eN]` to controls |
| `viewport` | `false` | Mark `[offscreen]` controls and add a `Scroll:` line |
| `keepParams` | `['tab']` | Query parameters kept on the `Page:` line |
| `pageAddress` | path + kept params | Custom `Page:` line |
| `location` | `document.location` | The address to report, for iframes and tests |
| `keepEmail` | none | Emails matching this pattern are kept |
| `redact` | none | Extra redaction for every name and text excerpt |
| `hintAttribute` | `data-testid` | Quoted for a control with no name and no nearby text |
| `repeatMin` / `repeatKeep` | 8 / 3 | When and how far repeated items are shortened |

### Watching

`watch` captures at most once every 150 ms while the page is busy. It reports a change only after the page has held still for 250 ms, or for 700 ms after the address changes so the new page can load. A poll every 1.5 s catches changes that no mutation reports. Mutations inside `skip` are ignored.

## Performance

Measured in Chromium 143 on generated pages (nav, labelled forms, a large table, card grids and a dialog), with `refs` and `viewport` on. Each figure is the median of 20 runs after 3 warm-ups (`pnpm bench`):

| Elements | Median | p95 | Output |
| ---: | ---: | ---: | ---: |
| 515 | 0.9 ms | 1.1 ms | 5,971 chars |
| 2,015 | 0.8 ms | 0.9 ms | 4,661 chars |
| 10,015 | 0.9 ms | 1.3 ms | 4,661 chars |
| 50,015 | 1.7 ms | 1.8 ms | 4,662 chars |

Long runs of similar items are counted and skipped, not walked. Cost therefore follows how varied a page is rather than how big it is: with no character cap at all, the 50,000-element page still took 1.7 ms. On real Anam Lab pages an outline took under 6 ms, including the first, unwarmed capture.

## Accessible names are the contract

Sightline sees what a screen reader sees. An icon button with no `aria-label` reaches the agent as `button near "…"` (named from the text beside it) or `button (unlabelled)`. Naming your controls properly makes the agent accurate, and it's good accessibility practice anyway.

## Development

```sh
pnpm install
pnpm test       # Vitest + happy-dom
pnpm bench      # Chromium benchmark via Playwright (needs a local Chromium)
pnpm build      # emits dist/
```
