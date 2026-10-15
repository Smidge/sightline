/**
 * Copy buttons: `data-copy="text to copy"`, `data-copy="#id"` for another
 * element's text, or a name the page resolves through `resolve`.
 */
export function copyButtons(
  root: ParentNode,
  resolve: (name: string) => string | null = () => null,
) {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    const label = button.textContent;
    let timer: ReturnType<typeof setTimeout> | undefined;
    button.addEventListener('click', async () => {
      const key = button.dataset.copy ?? '';
      const text =
        resolve(key) ??
        (key.startsWith('#') ? (document.querySelector(key)?.textContent ?? '') : key);
      try {
        await navigator.clipboard.writeText(text.trim());
        button.textContent = 'Copied';
      } catch {
        button.textContent = 'Copy failed';
      }
      clearTimeout(timer);
      timer = setTimeout(() => (button.textContent = label), 1_600);
    });
  }
}
