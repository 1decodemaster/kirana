import { describe, expect, it } from 'vitest';
import { UNITS, convert, displayUnit, formatQty, isUnitCode, toBase, unitType } from './units.js';

describe('UNITS registry', () => {
  it('matches the PRD §6.2 registry exactly', () => {
    expect(Object.keys(UNITS).sort()).toEqual(['dozen', 'ea', 'g', 'kg', 'l', 'ml', 'pack']);
    expect(UNITS.kg).toEqual({ type: 'weight', label: 'kg', base: 'g', factor: 1000, plural: 'kg' });
    expect(UNITS.dozen).toEqual({ type: 'count', label: 'dozen', base: 'ea', factor: 12, plural: 'dozen' });
    expect(UNITS.l).toEqual({ type: 'volume', label: 'L', base: 'ml', factor: 1000, plural: 'L' });
  });
});

describe('unitType', () => {
  it('derives the measurement type from the unit code', () => {
    expect(unitType('ea')).toBe('count');
    expect(unitType('dozen')).toBe('count');
    expect(unitType('kg')).toBe('weight');
    expect(unitType('ml')).toBe('volume');
  });
});

describe('toBase and convert', () => {
  it('converts through base units', () => {
    expect(toBase(1.5, 'kg')).toBe(1500);
    expect(convert(1.5, 'kg', 'g')).toBe(1500);
    expect(convert(1500, 'g', 'kg')).toBe(1.5);
    expect(convert(2, 'l', 'ml')).toBe(2000);
    expect(convert(1, 'dozen', 'ea')).toBe(12);
  });

  it('never converts between measurement types', () => {
    expect(convert(1, 'kg', 'ml')).toBeNull();
    expect(convert(1, 'ea', 'g')).toBeNull();
  });
});

describe('displayUnit', () => {
  it('picks the display unit for a value and type (§6.2)', () => {
    expect(displayUnit(500, 'weight')).toBe('g');
    expect(displayUnit(1000, 'weight')).toBe('kg');
    expect(displayUnit(999, 'volume')).toBe('ml');
    expect(displayUnit(1000, 'volume')).toBe('l');
    expect(displayUnit(3, 'count')).toBe('ea');
  });
});

describe('formatQty', () => {
  it('rounds to 2 decimals and strips trailing zeros (§6.2)', () => {
    expect(formatQty(1.5)).toBe('1.5');
    expect(formatQty(1.5)).toBe('1.5');
    expect(formatQty(2.0)).toBe('2');
    expect(formatQty(1.505)).toBe('1.51');
    expect(formatQty(0.1 + 0.2)).toBe('0.3');
    expect(formatQty(1500)).toBe('1500');
  });
});

describe('isUnitCode', () => {
  it('narrows to UnitCode only for registry keys', () => {
    expect(isUnitCode('kg')).toBe(true);
    expect(isUnitCode('Kg')).toBe(false);
    expect(isUnitCode('cup')).toBe(false);
    expect(isUnitCode('')).toBe(false);
  });
});
