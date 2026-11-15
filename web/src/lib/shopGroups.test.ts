import { describe, expect, it } from 'vitest';
import type { CategoryDto, ListItemDto } from '@kirana/shared';
import { firstUncheckedIndex, groupShopSections, sectionCounts } from './shopGroups.js';

const CATEGORIES: CategoryDto[] = [
  { id: 'c-produce', name: 'Produce', scope: 'grocery', icon: '🥬', color: null, sortOrder: 0 },
  { id: 'c-dairy', name: 'Dairy & Eggs', scope: 'grocery', icon: '🥛', color: null, sortOrder: 10 },
  { id: 'c-grains', name: 'Grains & Lentils', scope: 'grocery', icon: '🌾', color: null, sortOrder: 20 },
];
const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

function row(overrides: Partial<ListItemDto> & Pick<ListItemDto, 'id' | 'categoryId' | 'status'>): ListItemDto {
  return {
    itemId: `item-${overrides.id}`,
    name: `Item ${overrides.id}`,
    qtyValue: null,
    unitCode: null,
    note: null,
    addedBy: null,
    updatedAt: 0,
    ...overrides,
  };
}

describe('groupShopSections', () => {
  it('merges consecutive same-category rows and splits separated ones (board order in, section order out)', () => {
    const items = [
      row({ id: '1', categoryId: 'c-produce', status: 'active' }),
      row({ id: '2', categoryId: 'c-produce', status: 'bought' }),
      row({ id: '3', categoryId: 'c-dairy', status: 'active' }),
      row({ id: '4', categoryId: 'c-produce', status: 'active' }),
    ];
    const sections = groupShopSections(items, byId);
    expect(sections.map((s) => s.categoryId)).toEqual(['c-produce', 'c-dairy', 'c-produce']);
    expect(sections[0]?.items.map((i) => i.id)).toEqual(['1', '2']);
    expect(sections[2]?.items.map((i) => i.id)).toEqual(['4']);
  });

  it('forms one tail group for uncategorized rows and keeps their order', () => {
    const items = [
      row({ id: '1', categoryId: null, status: 'active' }),
      row({ id: '2', categoryId: null, status: 'bought' }),
    ];
    const sections = groupShopSections(items, byId);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.categoryId).toBeNull();
    expect(sections[0]?.category).toBeUndefined();
    expect(sections[0]?.items.map((i) => i.id)).toEqual(['1', '2']);
  });

  it('returns [] for an empty store', () => {
    expect(groupShopSections([], byId)).toEqual([]);
  });

  it('attaches the category dto for lookup by id', () => {
    const sections = groupShopSections([row({ id: '1', categoryId: 'c-dairy', status: 'active' })], byId);
    expect(sections[0]?.category?.name).toBe('Dairy & Eggs');
  });
});

describe('sectionCounts', () => {
  it('counts bought vs total', () => {
    const items = [
      row({ id: '1', categoryId: null, status: 'bought' }),
      row({ id: '2', categoryId: null, status: 'active' }),
      row({ id: '3', categoryId: null, status: 'bought' }),
    ];
    const section = groupShopSections(items, byId)[0];
    if (section === undefined) throw new Error('expected one section');
    expect(sectionCounts(section)).toEqual({ bought: 2, total: 3 });
  });
});

describe('firstUncheckedIndex (§8.5 current category)', () => {
  it('returns the first section with an unchecked item', () => {
    const sections = groupShopSections(
      [
        row({ id: '1', categoryId: 'c-produce', status: 'bought' }),
        row({ id: '2', categoryId: 'c-produce', status: 'bought' }),
        row({ id: '3', categoryId: 'c-dairy', status: 'active' }),
        row({ id: '4', categoryId: 'c-grains', status: 'active' }),
      ],
      byId,
    );
    expect(firstUncheckedIndex(sections)).toBe(1);
  });

  it('returns undefined once everything is checked', () => {
    const sections = groupShopSections([row({ id: '1', categoryId: null, status: 'bought' })], byId);
    expect(firstUncheckedIndex(sections)).toBeUndefined();
  });

  it('returns undefined for an empty trip', () => {
    expect(firstUncheckedIndex([])).toBeUndefined();
  });
});
