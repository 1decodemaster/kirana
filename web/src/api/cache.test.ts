import { describe, expect, it } from 'vitest';
import type { BoardResponse, CategoryDto, StoreDto } from '@kirana/shared';
import { applyCategorySortOrder, applyStoreOrder, applyStorePatch } from './cache.js';

const category = (id: string, sortOrder: number): CategoryDto => ({
  id,
  name: `Cat ${id}`,
  scope: 'grocery',
  icon: null,
  color: null,
  sortOrder,
});

const store = (id: string, overrides: Partial<StoreDto> = {}): StoreDto => ({
  id,
  name: `Store ${id}`,
  iconKind: 'emoji',
  iconRef: null,
  status: 'active',
  categoryOrder: [],
  sortOrder: 0,
  counts: { total: 0, bought: 0 },
  items: [],
  ...overrides,
});

const board = (stores: StoreDto[], categories: CategoryDto[] = []): BoardResponse => ({
  revision: 1,
  household: { id: 'hh', name: 'Home' },
  me: { id: 'm1', displayName: 'Alex', color: '#4F46E5' },
  members: [],
  categories,
  stores,
  catalog: [],
});

describe('applyStorePatch', () => {
  it('applies only the provided fields', () => {
    const b = board([store('s1', { name: 'Old' }), store('s2')]);
    const next = applyStorePatch(b, 's1', { name: 'New', sortOrder: 5 });
    expect(next.stores[0]?.name).toBe('New');
    expect(next.stores[0]?.sortOrder).toBe(5);
    expect(next.stores[0]?.status).toBe('active');
    expect(next.stores[1]?.name).toBe('Store s2');
  });
});

describe('applyStoreOrder', () => {
  it('reorders stores and renumbers sortOrder', () => {
    const b = board([store('s1'), store('s2'), store('s3')]);
    const next = applyStoreOrder(b, ['s3', 's1', 's2']);
    expect(next.stores.map((s) => s.id)).toEqual(['s3', 's1', 's2']);
    expect(next.stores.map((s) => s.sortOrder)).toEqual([0, 10, 20]);
  });

  it('appends stores missing from the ordered list', () => {
    const b = board([store('s1'), store('s2')]);
    const next = applyStoreOrder(b, ['s2']);
    expect(next.stores.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(next.stores[1]?.sortOrder).toBe(0);
  });
});

describe('applyCategorySortOrder', () => {
  it('renumbers the ordered categories and leaves the rest alone', () => {
    const b = board([], [category('c1', 0), category('c2', 10), category('c3', 20)]);
    const next = applyCategorySortOrder(b, ['c3', 'c1']);
    expect(next.categories.find((c) => c.id === 'c3')?.sortOrder).toBe(0);
    expect(next.categories.find((c) => c.id === 'c1')?.sortOrder).toBe(10);
    expect(next.categories.find((c) => c.id === 'c2')?.sortOrder).toBe(10);
  });
});
