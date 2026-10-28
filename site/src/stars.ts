/**
 * Fills in the repository's star count on "Star on GitHub" links once it is
 * high enough to help rather than put people off. One unauthenticated GitHub
 * API call per browser session; the links work without it.
 */
const REPO = 'Smidge/sightline';
const SHOW_FROM = 10;
const KEY = 'sightline-stars';

async function starCount(): Promise<number | null> {
  try {
    const cached = Number(sessionStorage.getItem(KEY));
    if (cached > 0) return cached;
  } catch {
    // Storage can be blocked; fetch instead.
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;
    const { stargazers_count: stars } = (await response.json()) as {
      stargazers_count?: number;
    };
    if (typeof stars !== 'number') return null;
    try {
      sessionStorage.setItem(KEY, String(stars));
    } catch {
      // Not cached; the next page load asks again.
    }
    return stars;
  } catch {
    return null;
  }
}

export async function showStars(root: ParentNode = document) {
  const slots = [...root.querySelectorAll<HTMLElement>('[data-star-count]')];
  if (!slots.length) return;
  const stars = await starCount();
  if (stars === null || stars < SHOW_FROM) return;
  const shown = stars.toLocaleString('en-GB');
  for (const slot of slots) {
    slot.textContent = shown;
    slot.hidden = false;
    slot
      .closest('a')
      ?.setAttribute('aria-label', `Star on GitHub, ${shown} stars`);
  }
}
