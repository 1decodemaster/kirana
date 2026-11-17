import { describe, expect, it } from 'vitest';
import type { CatalogItemDto } from '@kirana/shared';
import { buildIndex, resolveLocal, searchCatalog } from './searchIndex.js';

// NFR-5: client search ≤ 30ms for 5,000 items. The add-sheet index is a
// linear scan over scored candidates; this bench pins the budget on a
// realistic corpus (grocery names, aliases incl. Devanagari, sparse stats).

const N = 5000;
const NOW = 1_730_000_000_000;

const BASE_NAMES = [
  'Milk',
  'Atta',
  'Basmati Rice',
  'Toor Dal',
  'Tomatoes',
  'Onions',
  'Sunflower Oil',
  'Bread',
  'Eggs',
  'Yogurt',
  'Paneer',
  'Green Chilies',
  'Coriander Leaves',
  'Cumin Seeds',
  'Turmeric Powder',
  'Garam Masala',
  'Biscuits',
  'Potato Chips',
  'Dish Soap',
  'Laundry Detergent',
];
const ALIASES: ReadonlyArray<readonly string[]> = [
  ['doodh', 'दूध'],
  ['aata', 'आटा'],
  ['chawal', 'चावल'],
  ['arhar dal'],
  ['tamatar'],
  ['pyaaz', 'प्याज़'],
  ['tel'],
  ['double roti'],
  ['anda', 'अंडा'],
  ['dahi'],
];

function itemId(i: number): string {
  return `01913b5e-7d5a-7000-8000-${String(i).padStart(12, '0')}`;
}

/** Fixture-only indexed pick (noUncheckedIndexedAccess-safe). */
function at<T>(items: readonly T[], i: number): T {
  const value = items[i % items.length];
  if (value === undefined) throw new Error('fixture index out of range');
  return value;
}

function fixture(): CatalogItemDto[] {
  const items: CatalogItemDto[] = [];
  for (let i = 0; i < N; i += 1) {
    const base = at(BASE_NAMES, i);
    const name = i < BASE_NAMES.length ? base : `${base} ${Math.floor(i / BASE_NAMES.length)}`;
    const aliases = i % 5 === 0 ? [...at(ALIASES, Math.floor(i / 5))] : [];
    items.push({
      id: itemId(i),
      name,
      norm: name.toLowerCase(),
      aliases,
      defaultUnit: i % 3 === 0 ? 'kg' : null,
      defaultCategoryId: i % 7 === 0 ? itemId(i % 26) : null,
      iconRef: i % 2 === 0 ? '🥛' : null,
      // Sparse stats: a real catalog has most items never added.
      stats:
        i % 10 === 0 ? { timesAdded: (i % 40) + 1, lastAddedAt: NOW - i * 1000, storeIds: [itemId(1)] } : undefined,
    });
  }
  return items;
}

function bench(fn: () => void, runs: number): { mean: number; max: number } {
  for (let i = 0; i < 3; i += 1) fn(); // warmup
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { mean, max: Math.max(...samples) };
}

describe('NFR-5 — client search latency with 5,000 catalog items', () => {
  const index = buildIndex(fixture());

  it('searchCatalog answers in ≤ 30ms mean across representative queries', () => {
    const queries = ['milk', 'atta', 'चावल', 'tomato', 'item 4999', 'dish'];
    const results: string[] = [];
    let worstMean = 0;
    for (const q of queries) {
      const { mean, max } = bench(() => searchCatalog(index, q, itemId(1), NOW), 20);
      worstMean = Math.max(worstMean, mean);
      results.push(`"${q}" mean ${mean.toFixed(2)}ms max ${max.toFixed(2)}ms`);
    }
    console.info(`NFR-5 searchCatalog @ ${N} items:\n${results.join('\n')}`);
    expect(worstMean).toBeLessThanOrEqual(30);
  });

  it('resolveLocal (exact + alias + fuzzy path) answers in ≤ 30ms mean', () => {
    const { mean, max } = bench(() => resolveLocal(index, 'doodh', itemId(1), NOW), 20);
    console.info(`NFR-5 resolveLocal @ ${N} items: mean ${mean.toFixed(2)}ms max ${max.toFixed(2)}ms`);
    expect(mean).toBeLessThanOrEqual(30);
  });

  it('the index finds seeded aliases and exact matches (wiring smoke)', () => {
    const aliasHit = searchCatalog(index, 'chawal', null, NOW, 5);
    expect(aliasHit.length).toBeGreaterThan(0);
    expect(aliasHit.every((r) => r.matchedVia === 'alias')).toBe(true);
    const exact = searchCatalog(index, 'Milk 3', null, NOW, 5);
    expect(exact.some((r) => r.name === 'Milk 3')).toBe(true);
  });
});
