# Sightline

What's on the screen, as text an LLM agent can use.

Sightline runs inside the page. It reads the accessibility tree the way a screen reader does and turns it into a compact outline: roles, accessible names, states, the dialog that's open, alerts and form errors. An agent built into your app can then answer "why can't I click Generate?" from what's actually rendered instead of from documentation that may be out of date.

**[Try it on any page](https://smidge.github.io/sightline/)** and read the **[docs](https://smidge.github.io/sightline/docs/)**. The site's demo reads a public page in your browser, and its bookmarklet runs Sightline on whatever page you have open.

```
Page: /api-keys
Title: "Anam Lab"
Viewport: 1440px wide
Scroll: top, more below
navigation "Main navigation"
  link "Personas" → / [ref=e1]
  link "API Keys" → /api-keys [current] [ref=e2]
  link "Sessions" → /sessions [ref=e3]
main
  h1 "API Keys"
  button "New Key" [ref=e4]
  searchbox "Search API keys..." [empty] [ref=e5]
  table: columns Key ID | Label | Created | Actions; 9 rows
    button "1675c7a…3cd2" [ref=e6]
    button "Open actions for production" [collapsed, opens menu] [ref=e7]
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
- **It is written for models to act on.** With refs on, every control gets its own line, so a ref always sits next to its name. In live testing, a model reading several `Name [ref=eN]` pairs on one line picked the wrong one.
- **It follows a live session.** `watch` reports navigation, dialogs and alerts once the page has settled. `track` reports what the user clicked or toggled, by name. Refs stay stable between captures, so an agent can say "highlight e4" after the page has changed around it.

## Install

```sh
npm install @smidge/sightline
```

Sightline is an ES module with TypeScript types and no runtime dependencies. It needs a DOM, so call it in the browser.

## Usage

```ts
import { createSightline } from '@smidge/sightline';

const sightline = createSightline({
  skip: '[data-agent-panel]', // never describe the agent's own UI
  viewport: true, // mark [offscreen] controls, add a Scroll: line
});

// Send with each message to your LLM.
const outline = sightline.capture();
await chat.send({ text: question, pageOutline: outline?.text });

// Let the agent point at things.
sightline.highlight('e5'); // by ref from the outline
sightline.highlight('New Key'); // or by visible name

// Keep a live agent up to date.
const stopWatching = sightline.watch((change) => {
  // change.kind: initial | navigation | dialog-opened | dialog-closed | alert | update
  agent.addContext(
    `[screen] ${change.kind} ${change.path}\n${change.outline.text}`,
  );
});
const stopTracking = sightline.track((interaction) => {
  agent.addContext(
    `[user] ${interaction.type} ${interaction.role} "${interaction.name}"`,
  );
});
```

Lower-level functions are exported too: `outline(document, options)`, `findControl`, `describeElement`, `watchPage`, `trackInteractions`, `describeInteraction`, `diffLines` and `highlight`.

### Options

| Option                     | Default                     | Purpose                                                         |
| -------------------------- | --------------------------- | --------------------------------------------------------------- |
| `skip`                     | none                        | Selector for subtrees to leave out                              |
| `maxChars`                 | 6000                        | Character budget; a cut outline says so (see below)             |
| `maxElements`              | 20000                       | Element budget for one walk                                     |
| `refs`                     | `true` in `createSightline` | Add `[ref=eN]` to controls                                      |
| `viewport`                 | `false`                     | Mark `[offscreen]` controls and add a `Scroll:` line            |
| `keepParams`               | `['tab']`                   | Query parameters kept on the `Page:` line                       |
| `pageAddress`              | path + kept params          | Custom `Page:` line                                             |
| `location`                 | `document.location`         | The address to report, for iframes and tests                    |
| `keepEmail`                | none                        | Emails matching this pattern are kept                           |
| `redact`                   | none                        | Extra redaction for every name and text excerpt                 |
| `hintAttribute`            | `data-testid`               | Quoted for a control with no name and no nearby text            |
| `repeatMin` / `repeatKeep` | 8 / 3                       | When and how far repeated items are shortened                   |
| `infer`                    | `false`                     | Also read pages built without semantic HTML (see below)         |
| `annotate`                 | none                        | Adds your app's note to a listed control (see below)            |

### Watching

`watch` captures at most once every 150 ms while the page is busy. It reports a change only after the page has held still for 250 ms, or for 700 ms after the address changes so the new page can load. A poll every 1.5 s catches changes that no mutation reports. Mutations inside `skip` are ignored.

Busy pages:

- A page that never holds still, such as a progress counter or a list that keeps re-rendering, is reported at least every 2 s (`maxWaitMs`) instead of never.
- A new alert, dialog or error message is reported about 250 ms after it appears, even while something else keeps changing.
- Text edited in place (frameworks set a text node's value) and changes to names, descriptions and error links are observed directly, not left to the poll.
- A re-render that produces the same outline reports nothing.
- A clock or counter that shows in the outline is reported on every change. Leave it out with `skip`, or set `updates: false` to report only navigation, dialogs and alerts.
- When a framework swaps a control for an identical new element, the new element gets a new ref and the old ref stops resolving. `watch` reports that rather than treat the new element as the old one. On pages that remount controls constantly, refs go stale quickly; `find` and `highlight` also accept the control's name.

## Evidence and its limits

An outline is selective, not a copy of the page. It says what it saw, marks what it couldn't see, and doesn't fill gaps with guesses.

### Validation and disabled controls

A control line keeps the page's evidence in separate parts:

```
textbox "Key name" [required, empty, invalid] [ref=e1] — "Shown in your audit log." — error "Enter a key name."
button "Create key" [disabled] [ref=e7]
button "Rotate key" [disabled] [ref=e8] — "You need the Admin role to rotate keys."
```

- The brackets hold states read from the element: `invalid` from `aria-invalid`, `empty` from the field (never its value), `disabled`, `required` and so on.
- The quoted text after `—` is the description the page links with `aria-describedby`, or `aria-description`.
- `— error "…"` is the message linked with `aria-errormessage`. It is reported only while the control is invalid, as ARIA specifies, so a stale message left in the page doesn't show up. A message linked both ways is reported once, as the error.

Each referenced ID is read once and in order, and a missing ID is skipped. Text inside `skip`, field values and editable text are never read through a reference. Redaction and the 240-character limit apply to each part.

Sightline doesn't connect evidence for you. An empty required field next to a disabled Create button is two facts, and the outline doesn't claim one causes the other. If the page gives a reason, such as an `aria-describedby` on the button, it's shown. If the reason only lives in your app's state, supply it with `annotate`:

```ts
createSightline({
  annotate: (element, role) =>
    role === 'button' && element.matches('[type=submit]') && !form.valid
      ? `Disabled until ${form.firstMissingField} is filled in`
      : null,
});
// button "Create key" [disabled] [ref=e7] — note "Disabled until Key name is filled in"
```

Notes get the same redaction and length limit as page text. `annotate` is only called for controls the walk reaches and would list, never for hidden or skipped ones. A hook that throws or returns something other than text adds nothing.

### What the outline leaves out, and how it says so

- **Frames.** A frame big enough to be content always gets a line, so an agent knows part of the page is elsewhere. Without `infer`: `frame "Card number" (contents not included)`. With `infer`, a same-origin frame is read in place, and a frame whose document isn't available reads `frame "Card number" (contents not readable)`. Sightline doesn't guess why: another origin, a sandbox or a frame still loading all look the same. A frame with no title is `frame (unnamed, …)`. Frames smaller than 60×40, such as tracking pixels, are left out. After eight frame lines the rest are counted (`… (3 more frames not listed)`), and `stats.framesNotRead` counts every frame whose contents are missing.
- **Budgets.** A cut outline ends with `… (outline truncated: character limit)` or `… (outline truncated: element limit)`, and `stats.truncatedBy` says which. Invalid fields and alerts the walk didn't reach are then looked up, checking at most 50 candidates. Any found are listed under `Errors and alerts after the cut:`, using up to a quarter of the budget; the lines just before the cut give up the room. The lookup follows the walk's rules, so skipped, hidden and background content stays out. If it finds nothing, the outline says nothing more. It never claims the rest of the page is free of errors.
- **Repeated items.** A run of similar items still shortens to the first three, but an item holding an invalid field or an alert is kept wherever it falls. The count of hidden items leaves it out.

What the outline can't see or doesn't list:

- Error text that is only styled, such as red text beside a field, and neither linked with ARIA nor announced as an alert or status.
- Paragraph text that doesn't name or describe a control.
- Why a control is disabled, unless the page or `annotate` says.
- Controls a virtualised list hasn't rendered, and the contents of closed menus and collapsed sections.
- Only part of the page: there's no option yet to outline a single region at a larger budget.

### Finding something that isn't listed

Sightline lists headings, landmarks, controls, alerts and status messages, and summarises tables. Wrappers such as a `div` around a card or an unlabelled `section` aren't listed, because they have no role or name; their controls appear under the nearest listed parent. Listing every `div` would bury the controls, so the default stays compact.

If something meaningful is missing:

1. Check it has a role and an accessible name. `describeElement(element)` returns the role and name Sightline sees, or `null` if it isn't a control.
2. Check it isn't hidden from assistive technology (`hidden`, `aria-hidden`, `inert`, behind an open modal) or inside your `skip` selector.
3. For a `div` with a click handler, or an icon button with no name, try `infer: true`.
4. If the outline was cut (`stats.truncated`), capture once with a bigger budget, `sightline.capture({ maxChars: 20_000 })`, or keep more of each run with `repeatKeep`.

## Performance

Measured in Chromium 156 on generated pages (nav, labelled forms, a large table, card grids and a dialog), with `refs` and `viewport` on. Each figure is the median of 20 runs after 3 warm-ups (`pnpm bench`):

| Elements | Median |    p95 |      Output |
| -------: | -----: | -----: | ----------: |
|      515 | 1.1 ms | 1.6 ms | 5,996 chars |
|    2,015 | 0.8 ms | 1.2 ms | 4,709 chars |
|   10,015 | 1.1 ms | 1.4 ms | 4,709 chars |
|   50,015 | 2.6 ms | 2.9 ms | 4,710 chars |

Long runs of similar items are counted and skipped, not walked. Each shortened run is checked once for invalid fields and alerts with a native selector query, so very large repeated pages cost a little more than before: in the same setup the 50,000-element page went from 1.5 ms to 2.6 ms, with or without a character cap. Before this change, an outline of real Anam Lab pages took under 6 ms, including the first, unwarmed capture.

`pnpm bench:evidence` runs realistic fixtures (a long checkout, a basket with one error row, validation patterns, frames) and busy-page `watch` scenarios in Chromium, and reports output size, capture time, whether the key evidence survived and how often `watch` reported.

## Accessible names are the contract

Sightline sees what a screen reader sees. An icon button with no `aria-label` reaches the agent as `button near "…"` (named from the text beside it) or `button (unlabelled)`. Naming your controls properly makes the agent accurate, and it's good accessibility practice anyway. For pages you don't control, `infer` fills some of the gaps with marked guesses.

## Pages without semantic HTML

Many sites build buttons from plain divs with a click handler, leave icon buttons unnamed, and fake headings and modals with styling. With `infer: true`, Sightline reads those as a sighted user would.

- An element that reacts to clicks without a button or link role is listed as `clickable "Add to bag"`. Sightline counts an `onclick` attribute or property, React (`__reactProps$…`) and Vue click props, jQuery handlers, and the element where a pointer cursor starts. It leaves out a wrapper around a real link or button, a container holding form fields, anything covering half the screen, and a clickable with nothing to call it.
- A control with no name gets a guess, marked with its source, such as `button "close" (guessed from icon)`. The guess comes from a tooltip attribute, the icon inside (`fa-trash`, `lucide-x`, `<use href="#icon-cart">`, Material UI's `data-testid="DeleteIcon"`), an image file name, a test id, `name`, `id` or the class. A guess from a file name, id or class is kept only if it contains a word that says what the control does, so jargon like `tux-tooltip-reference` never reaches the model. A field takes the short text just before it (`<div>Email</div><input>`), and a control showing only `×` or `☰` reads as `close` or `menu`.
- Short text set noticeably larger and bolder than the body text becomes a heading. Prices are left out.
- A fixed element over the centre of the viewport that covers a fifth of it, holds something to click and isn't the whole app counts as an open dialog. Only the dialog is shown, as with a real modal, and `watch` reports it opening and closing.
- Open shadow roots, their slots and same-origin frames are read. A frame whose contents can't be read is still listed (see Evidence and its limits).

`find`, `highlight`, `track` and `describeElement` use the same names, so an agent can ask to click "close" when the page shows `×`.

Inference costs a computed-style read per element. Measured on live sites in Chromium 143, with `refs` and `viewport` on:

| Page                                       |  Controls | Unnamed | Time         |
| ------------------------------------------ | --------: | ------: | ------------ |
| Deque's Mars Commuter (built inaccessible) | 103 → 111 |   7 → 3 | 5.5 → 7.0 ms |
| University of Washington "before" demo     |   25 → 27 |   1 → 0 | 1.7 → 3.8 ms |
| TikTok Explore                             |   23 → 28 |   6 → 6 | 1.7 → 4.5 ms |
| AliExpress home                            |   80 → 82 |   0 → 0 | 2.8 → 4.2 ms |
| BBC home (accessible)                      |   68 → 68 |   0 → 0 | 5.1 → 6.8 ms |

On an accessible page inference adds nothing but time. Listeners added with `addEventListener` are invisible to page script, so a div with one and no pointer cursor stays unlisted.

## Development

```sh
pnpm install
pnpm test       # Vitest + happy-dom
pnpm bench      # Chromium benchmark via Playwright (needs a local Chromium)
pnpm build      # emits dist/
pnpm site       # builds the GitHub Pages site (site/) into _site/ and serves it on :4173
```

The site deploys to GitHub Pages from `main` through `.github/workflows/pages.yml`.

### Releasing

Bump `version` in `package.json` in the pull request. When it merges, `.github/workflows/publish.yml` publishes that version to npm with provenance, through npm trusted publishing, and creates a `v<version>` GitHub release. A version with a hyphen, such as `0.2.0-beta.1`, is published under the `next` tag. A merge that doesn't change the version publishes nothing, and pull requests run the publish as a dry run.

## License

MIT
