import { highlightCode } from './code.js';
import { copyButtons } from './copy.js';
import { markStaticOutlines } from './outline-view.js';

highlightCode();
markStaticOutlines();
copyButtons(document);

// Mark the section being read in the contents.
const links = new Map<string, HTMLAnchorElement>();
for (const link of document.querySelectorAll<HTMLAnchorElement>('.toc a[href^="#"]'))
  links.set(link.hash.slice(1), link);
const sections = [...links.keys()]
  .map((id) => document.getElementById(id))
  .filter((section): section is HTMLElement => Boolean(section));
let current: HTMLAnchorElement | null = null;
const mark = () => {
  const line = window.innerHeight * 0.25;
  let active = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= line) active = section;
    else break;
  }
  const link = active ? links.get(active.id) : null;
  if (link === current) return;
  current?.removeAttribute('aria-current');
  link?.setAttribute('aria-current', 'location');
  current = link ?? null;
};
let pending = 0;
addEventListener(
  'scroll',
  () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(mark);
  },
  { passive: true },
);
mark();
