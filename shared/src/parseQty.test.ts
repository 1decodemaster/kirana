import { describe, expect, it } from 'vitest';
import { parseQty } from './parseQty.js';

describe('parseQty — PRD §6.3 examples (normative)', () => {
  it.each([
    ['milk 2 l', 'milk', 2, 'l'],
    ['atta 5kg', 'atta', 5, 'kg'],
    ['eggs dozen', 'eggs', 1, 'dozen'],
    ['x3 bananas', 'bananas', 3, 'ea'],
    ['500 g paneer', 'paneer', 500, 'g'],
    ['dal 2', 'dal', 2, 'ea'],
  ])('%s → name=%s qty=%s unit=%s', (input, name, qty, unit) => {
    expect(parseQty(input)).toEqual({ name, qty, unit });
  });
});

describe('parseQty — grammar details', () => {
  it('is case-insensitive and tolerant of spaces', () => {
    expect(parseQty('MILK 2 L')).toEqual({ name: 'MILK', qty: 2, unit: 'l' });
    expect(parseQty('atta  5  kg')).toEqual({ name: 'atta', qty: 5, unit: 'kg' });
  });

  it('handles unit spelling variants', () => {
    expect(parseQty('atta 5kgs')).toEqual({ name: 'atta', qty: 5, unit: 'kg' });
    expect(parseQty('500 grams paneer')).toEqual({ name: 'paneer', qty: 500, unit: 'g' });
    expect(parseQty('milk 1 ltr')).toEqual({ name: 'milk', qty: 1, unit: 'l' });
    expect(parseQty('oil 1 litre')).toEqual({ name: 'oil', qty: 1, unit: 'l' });
    expect(parseQty('milk x2')).toEqual({ name: 'milk', qty: 2, unit: 'ea' });
    expect(parseQty('x3 bananas')).toEqual({ name: 'bananas', qty: 3, unit: 'ea' });
    expect(parseQty('eggs dz')).toEqual({ name: 'eggs', qty: 1, unit: 'dozen' });
    expect(parseQty('bhujia 2 packs')).toEqual({ name: 'bhujia', qty: 2, unit: 'pack' });
  });

  it('handles fractional quantities', () => {
    expect(parseQty('milk 0.5 l')).toEqual({ name: 'milk', qty: 0.5, unit: 'l' });
    expect(parseQty('0.5 kg atta')).toEqual({ name: 'atta', qty: 0.5, unit: 'kg' });
  });

  it('returns null when there is nothing to parse', () => {
    expect(parseQty('milk')).toBeNull();
    expect(parseQty('')).toBeNull();
    expect(parseQty('   ')).toBeNull();
  });

  it('discards a parse that would leave an empty name', () => {
    expect(parseQty('2 kg')).toBeNull();
    expect(parseQty('dozen')).toBeNull();
  });

  it('discards a parse with a non-positive quantity (INV-3)', () => {
    expect(parseQty('milk 0 l')).toBeNull();
    expect(parseQty('milk 0')).toBeNull();
    expect(parseQty('x0 bananas')).toBeNull();
  });

  it('never silently drops user text on failure (§6.3)', () => {
    expect(parseQty('milk with honey 500ml')).toEqual({
      name: 'milk with honey',
      qty: 500,
      unit: 'ml',
    });
    expect(parseQty('special 5kg atta mix')).toBeNull();
  });
});
