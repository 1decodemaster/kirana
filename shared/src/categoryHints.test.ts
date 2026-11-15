import { describe, expect, it } from 'vitest';
import { CATEGORY_HINTS, hintCategory } from './categoryHints.js';

describe('hintCategory (PRD §14.3)', () => {
  it("maps the PRD's own examples", () => {
    expect(hintCategory('milk')).toBe('Dairy & Eggs');
    expect(hintCategory('doodh')).toBe('Dairy & Eggs');
    expect(hintCategory('curd')).toBe('Dairy & Eggs');
    expect(hintCategory('paneer')).toBe('Dairy & Eggs');
    expect(hintCategory('ghee')).toBe('Dairy & Eggs');
    expect(hintCategory('dal')).toBe('Grains & Lentils');
    expect(hintCategory('rice')).toBe('Grains & Lentils');
    expect(hintCategory('atta')).toBe('Grains & Lentils');
    expect(hintCategory('flour')).toBe('Grains & Lentils');
    expect(hintCategory('soap')).toBe('Cleaning Supplies');
    expect(hintCategory('detergent')).toBe('Cleaning Supplies');
    expect(hintCategory('cleaner')).toBe('Cleaning Supplies');
  });

  it('matches raw display names case-insensitively (§6.5 — hint on the item name)', () => {
    expect(hintCategory('Milk')).toBe('Dairy & Eggs');
    expect(hintCategory('Basmati Rice')).toBe('Grains & Lentils');
    expect(hintCategory('प्याज़')).toBe('Produce');
    expect(hintCategory('pyaz')).toBe('Produce');
    expect(hintCategory('chawal')).toBe('Grains & Lentils');
    expect(hintCategory('दही')).toBe('Dairy & Eggs');
  });

  it('returns null for unknown names — it is a hint, not a classifier', () => {
    expect(hintCategory('blorptastic')).toBeNull();
    expect(hintCategory('')).toBeNull();
  });

  it('prefers the more specific category via ordering', () => {
    expect(hintCategory('red chilli powder')).toBe('Spices & Masala');
    expect(hintCategory('green chilli')).toBe('Produce');
  });
});

describe('CATEGORY_HINTS invariants', () => {
  it('references only seeded category names (PRD §14.1)', () => {
    const grocery = [
      'Produce',
      'Dairy & Eggs',
      'Bakery',
      'Meat & Seafood',
      'Grains & Lentils',
      'Spices & Masala',
      'Oils & Ghee',
      'Snacks & Namkeen',
      'Beverages & Tea/Coffee',
      'Frozen',
      'Canned & Packaged',
      'Breakfast',
      'Sweets & Desserts',
      'Other',
    ];
    const household = [
      'Cleaning Supplies',
      'Laundry',
      'Bathroom',
      'Personal Care',
      'Kitchenware',
      'Storage & Organization',
      'Stationery',
      'Hardware',
      'Electrical',
      'Baby',
      'Pet',
      'Other',
    ];
    const valid = new Set([...grocery, ...household]);
    for (const hint of CATEGORY_HINTS) {
      expect(valid.has(hint.category), hint.pattern).toBe(true);
    }
  });

  it('stays around the ~120 entry budget (§14.3)', () => {
    expect(CATEGORY_HINTS.length).toBeGreaterThan(60);
    expect(CATEGORY_HINTS.length).toBeLessThanOrEqual(140);
  });
});
