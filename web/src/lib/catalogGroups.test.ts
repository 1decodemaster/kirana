import { describe, expect, it } from 'vitest';
import type { CategoryDto, SearchResultDto } from '@kirana/shared';
import { groupCatalogResults } from './catalogGroups.js';

const CATEGORIES: CategoryDto[] = [
  { id: 'c-produce', name: 'Produce', scope: 'grocery', icon: '🥬', color: '#a3b18a', sortOrder: 0 },
  { id: 'c-dairy', name: 'Dairy & Eggs', scope: 'grocery', icon: '🥛', color: null, sortOrder: 10 },
  { id: 'c-grains', name: 'Grains & Lentils', scope: 'grocery', icon: '🌾', color: null, sortOrder: 20 },
];

function result(overrides: Partial<SearchResultDto> & Pick<SearchResultDto, 'id' | 'name'>): SearchResultDto {
  return {
    norm: `norm-${overrides.id}`,
    defaultUnit: null,
    defaultCategoryId: null,
    iconRef: null,
    matchedVia: 'name',
    inStore: false,
    score: 0.5,
    ...overrides,
  };
}

describe('groupCatalogResults', () => {
  it('groups by default category in sortOrder and puts uncategorized last', () => {
    const items = [
      result({ id: '1', name: 'Rice', defaultCategoryId: 'c-grains' }),
      result({ id: '2', name: 'Onion', defaultCategoryId: 'c-produce' }),
      result({ id: '3', name: 'Milk', defaultCategoryId: 'c-dairy' }),
      result({ id: '4', name: 'Soap' }),
    ];
    const groups = groupCatalogResults(items, CATEGORIES);
    expect(groups.map((g) => g.name)).toEqual(['Produce', 'Dairy & Eggs', 'Grains & Lentils', 'Uncategorized']);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['2']);
    expect(groups[3]?.categoryId).toBeNull();
  });

  it('keeps server order within a group', () => {
    const items = [
      result({ id: '1', name: 'Basmati', defaultCategoryId: 'c-grains' }),
      result({ id: '2', name: 'Atta', defaultCategoryId: 'c-grains' }),
      result({ id: '3', name: 'Toor dal', defaultCategoryId: 'c-grains' }),
    ];
    const groups = groupCatalogResults(items, CATEGORIES);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['1', '2', '3']);
  });

  it('treats an unknown categoryId as uncategorized', () => {
    const items = [result({ id: '1', name: 'Mystery', defaultCategoryId: 'c-gone' })];
    const groups = groupCatalogResults(items, CATEGORIES);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe('Uncategorized');
  });

  it('returns no groups for an empty catalog', () => {
    expect(groupCatalogResults([], CATEGORIES)).toEqual([]);
  });
});
