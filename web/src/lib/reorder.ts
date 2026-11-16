/** Pure reorder math for the management screens (§8.1 /stores, /categories,
 *  per-store aisle order). No DOM, no React — unit-testable per §19. */

/** Move the element at `from` so it lands at `to` (both clamped in range). */
export function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  const n = list.length;
  if (n === 0) return [];
  const a = Math.max(0, Math.min(n - 1, from));
  const b = Math.max(0, Math.min(n - 1, to));
  if (a === b) return [...list];
  const next = [...list];
  const [item] = next.splice(a, 1);
  if (item === undefined) return [...list];
  next.splice(b, 0, item);
  return next;
}

/** Insertion index while dragging: how many midpoints sit above the pointer.
 *  Crossing a neighbour's midpoint swaps — the standard sortable feel. */
export function insertionIndex(midpoints: readonly number[], y: number): number {
  let index = 0;
  for (const m of midpoints) {
    if (y > m) index += 1;
  }
  return index;
}

/** §6.8: a store's aisle order is `categoryOrder` (unknown/duplicate ids
 *  dropped), then the remaining categories by sortOrder then name. */
export function effectiveAisleOrder(
  categoryOrder: readonly string[],
  categories: ReadonlyArray<{ readonly id: string; readonly sortOrder: number; readonly name: string }>,
): string[] {
  const known = new Set(categories.map((c) => c.id));
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const id of categoryOrder) {
    if (known.has(id) && !seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }
  const rest = categories
    .filter((c) => !seen.has(c.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((c) => c.id);
  return [...ordered, ...rest];
}

/** sortOrder for each position: 10 apart so a later midpoint insert (§6.8
 *  float sort_order is for list rows, not categories) stays possible. */
export const REORDER_STEP = 10;

export function sortOrderPatches(
  ids: readonly string[],
  step: number = REORDER_STEP,
): ReadonlyArray<{ readonly id: string; readonly sortOrder: number }> {
  return ids.map((id, index) => ({ id, sortOrder: index * step }));
}
