export type LineDiff = {
  added: string[];
  removed: string[];
};

/**
 * Lines that appeared or disappeared between two outlines, counting repeats,
 * so an agent can be told what changed without resending the whole page.
 * Order follows the newer outline for additions and the older for removals.
 */
export function diffLines(before: string, after: string): LineDiff {
  const previous = before ? before.split('\n') : [];
  const next = after ? after.split('\n') : [];
  const remaining = new Map<string, number>();
  for (const line of previous)
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of next) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) remaining.set(line, count - 1);
    else added.push(line);
  }
  const removed: string[] = [];
  for (const line of previous) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      removed.push(line);
      remaining.set(line, count - 1);
    }
  }
  return { added, removed };
}
