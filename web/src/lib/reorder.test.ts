import { describe, expect, it } from 'vitest';
import { effectiveAisleOrder, insertionIndex, moveTo, sortOrderPatches } from './reorder.js';

describe('moveTo', () => {
  it('moves an element forward', () => {
    expect(moveTo(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('moves an element backward', () => {
    expect(moveTo(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op when from equals to', () => {
    expect(moveTo(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });

  it('clamps out-of-range indices', () => {
    expect(moveTo(['a', 'b'], -5, 99)).toEqual(['b', 'a']);
  });

  it('returns empty for an empty list', () => {
    expect(moveTo([], 0, 0)).toEqual([]);
  });

  it('does not mutate the input', () => {
    const input = ['a', 'b', 'c'];
    moveTo(input, 0, 2);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});

describe('insertionIndex', () => {
  it('is 0 above every midpoint', () => {
    expect(insertionIndex([100, 200], 40)).toBe(0);
  });

  it('counts midpoints strictly below the pointer', () => {
    expect(insertionIndex([100, 200, 300], 150)).toBe(1);
    expect(insertionIndex([100, 200, 300], 260)).toBe(2);
    expect(insertionIndex([100, 200, 300], 400)).toBe(3);
  });

  it('does not count a midpoint the pointer sits exactly on', () => {
    expect(insertionIndex([100, 200], 100)).toBe(0);
  });
});

describe('effectiveAisleOrder', () => {
  const categories = [
    { id: 'c1', sortOrder: 10, name: 'Dairy' },
    { id: 'c2', sortOrder: 0, name: 'Produce' },
    { id: 'c3', sortOrder: 20, name: 'Bakery' },
  ];

  it('falls back to sortOrder, then name, with no saved order', () => {
    expect(effectiveAisleOrder([], categories)).toEqual(['c2', 'c1', 'c3']);
  });

  it('puts saved ids first, remainder appended in catalog order', () => {
    expect(effectiveAisleOrder(['c3'], categories)).toEqual(['c3', 'c2', 'c1']);
  });

  it('drops unknown ids and deduplicates', () => {
    expect(effectiveAisleOrder(['cX', 'c1', 'c1'], categories)).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('sortOrderPatches', () => {
  it('numbers positions 10 apart', () => {
    expect(sortOrderPatches(['a', 'b', 'c'])).toEqual([
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 10 },
      { id: 'c', sortOrder: 20 },
    ]);
  });
});
