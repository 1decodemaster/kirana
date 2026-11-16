import type { CategoryDto, SearchResultDto } from '@kirana/shared';

export interface CatalogGroup {
  readonly categoryId: string | null;
  readonly name: string;
  readonly icon: string | null;
  readonly color: string | null;
  readonly items: readonly SearchResultDto[];
}

/** §8.2: catalog rows read grouped by default category, in the categories'
 * sort order, uncategorized last. Item order inside a group is the server's
 * (ranked in search mode, name-ordered in browse mode). A categoryId that no
 * longer resolves (deleted category) counts as uncategorized. */
export function groupCatalogResults(
  items: readonly SearchResultDto[],
  categories: readonly CategoryDto[],
): CatalogGroup[] {
  const known = new Set(categories.map((c) => c.id));
  const buckets = new Map<string | null, SearchResultDto[]>();
  for (const item of items) {
    const key = item.defaultCategoryId !== null && known.has(item.defaultCategoryId)
      ? item.defaultCategoryId
      : null;
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [item]);
    } else {
      bucket.push(item);
    }
  }

  const groups: CatalogGroup[] = [];
  for (const category of [...categories].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const bucket = buckets.get(category.id);
    if (bucket === undefined) continue;
    groups.push({
      categoryId: category.id,
      name: category.name,
      icon: category.icon,
      color: category.color,
      items: bucket,
    });
  }
  const uncategorized = buckets.get(null);
  if (uncategorized !== undefined) {
    groups.push({ categoryId: null, name: 'Uncategorized', icon: null, color: null, items: uncategorized });
  }
  return groups;
}
