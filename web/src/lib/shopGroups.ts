import type { CategoryDto, ListItemDto } from '@kirana/shared';

/** One §8.5 category section. `categoryId === null` is the uncategorized
 * tail group (the board's "final group", §6.8). */
export interface ShopSection {
  readonly categoryId: string | null;
  readonly category: CategoryDto | undefined;
  readonly items: readonly ListItemDto[];
}

/** Consecutive grouping of the board's §6.8-ordered rows. The server hands
 * `store.items` pre-sorted (category groups via `category_order_json` ∪
 * sort_order, unchecked-first within a group), so grouping consecutive runs
 * by `categoryId` reproduces the board's section order exactly. */
export function groupShopSections(
  items: readonly ListItemDto[],
  categoriesById: ReadonlyMap<string, CategoryDto>,
): ShopSection[] {
  const sections: ShopSection[] = [];
  let current: { readonly categoryId: string | null; readonly category: CategoryDto | undefined; readonly items: ListItemDto[] } | undefined;
  for (const item of items) {
    if (current !== undefined && current.categoryId === item.categoryId) {
      current.items.push(item);
    } else {
      const categoryId = item.categoryId;
      current = {
        categoryId,
        category: categoryId === null ? undefined : categoriesById.get(categoryId),
        items: [item],
      };
      sections.push(current);
    }
  }
  return sections;
}

export function sectionCounts(
  section: ShopSection,
): { readonly bought: number; readonly total: number } {
  let bought = 0;
  for (const item of section.items) {
    if (item.status === 'bought') bought += 1;
  }
  return { bought, total: section.items.length };
}

/** The §8.5 "current" category: the first section (board order) that still
 * has an unchecked item. `undefined` once everything is checked. */
export function firstUncheckedIndex(sections: readonly ShopSection[]): number | undefined {
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    if (section === undefined) break;
    if (section.items.some((item) => item.status !== 'bought')) return i;
  }
  return undefined;
}
