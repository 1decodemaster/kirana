import { describe, expect, it } from 'vitest';
import { mergeAddIntoRow, type AccumulateRow } from './accumulate.js';
import type { AddListItemRequest } from './contracts.js';

function row(overrides: Partial<AccumulateRow> = {}): AccumulateRow {
  return {
    qtyValue: null,
    unitCode: null,
    categoryId: 'cat-1',
    note: null,
    ...overrides,
  };
}

function add(overrides: Partial<AddListItemRequest> = {}): AddListItemRequest {
  return { clientId: '01913b5e-7d5a-7000-8000-000000000001', ...overrides };
}

describe('mergeAddIntoRow (ADR-0007 — one active row per store + item)', () => {
  it('sums quantities when the units match', () => {
    const merged = mergeAddIntoRow(row({ qtyValue: 2, unitCode: 'l' }), add({ qtyValue: 3, unitCode: 'l' }));
    expect(merged.qtyValue).toBe(5);
    expect(merged.unitCode).toBe('l');
  });

  it('an add without a quantity keeps the row as-is', () => {
    const merged = mergeAddIntoRow(row({ qtyValue: 2, unitCode: 'l' }), add({ unitCode: 'l' }));
    expect(merged.qtyValue).toBe(2);
    expect(merged.unitCode).toBe('l');
  });

  it('an unspecified unit inherits the row unit and sums', () => {
    const merged = mergeAddIntoRow(row({ qtyValue: 2, unitCode: 'l' }), add({ qtyValue: 1 }));
    expect(merged.qtyValue).toBe(3);
    expect(merged.unitCode).toBe('l');
  });

  it('a quantity on a quantity-less row fills it in', () => {
    const merged = mergeAddIntoRow(row({ qtyValue: null, unitCode: 'l' }), add({ qtyValue: 2, unitCode: 'l' }));
    expect(merged.qtyValue).toBe(2);
  });

  it('two quantity-less adds stay quantity-less (never a phantom 0)', () => {
    const merged = mergeAddIntoRow(row(), add());
    expect(merged.qtyValue).toBeNull();
    const again = mergeAddIntoRow(row({ qtyValue: null, unitCode: 'ea' }), add({ unitCode: 'ea' }));
    expect(again.qtyValue).toBeNull();
  });

  it('an explicitly different unit replaces qty + unit only when a quantity rides along', () => {
    const replaced = mergeAddIntoRow(row({ qtyValue: 2, unitCode: 'l' }), add({ qtyValue: 1, unitCode: 'kg' }));
    expect(replaced).toMatchObject({ qtyValue: 1, unitCode: 'kg' });
    const kept = mergeAddIntoRow(row({ qtyValue: 2, unitCode: 'l' }), add({ unitCode: 'kg' }));
    expect(kept).toMatchObject({ qtyValue: 2, unitCode: 'l' });
  });

  it('a provided note or category replaces; absent ones are kept', () => {
    const merged = mergeAddIntoRow(
      row({ note: 'old', categoryId: 'cat-1' }),
      add({ note: 'fresh', categoryId: 'cat-2' }),
    );
    expect(merged).toMatchObject({ note: 'fresh', categoryId: 'cat-2' });
    const untouched = mergeAddIntoRow(row({ note: 'old', categoryId: 'cat-1' }), add({ qtyValue: 1 }));
    expect(untouched).toMatchObject({ note: 'old', categoryId: 'cat-1' });
  });

  it('an add carrying neither qty nor unit changes nothing but still allows note/category updates', () => {
    const merged = mergeAddIntoRow(row({ qtyValue: 2, unitCode: 'l', note: 'old' }), add({ note: 'new' }));
    expect(merged).toMatchObject({ qtyValue: 2, unitCode: 'l', note: 'new' });
  });
});
