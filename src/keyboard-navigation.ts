/**
 * Return the next item in a keyboard-navigated list.
 *
 * Keeping this small bit of state transition outside the React components makes
 * the wrap-around behavior consistent between the command palette and the
 * project file tree, and gives it a deterministic interaction contract to test.
 */
export function nextSelection(index: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown' || key === 'ArrowRight') return (index + 1 + count) % count;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (index - 1 + count) % count;
  return null;
}
