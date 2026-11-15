export const UNITS = {
  ea: { type: 'count', label: 'ea', base: 'ea', factor: 1, plural: 'ea' },
  pack: { type: 'count', label: 'pack', base: 'ea', factor: 1, plural: 'packs' },
  dozen: { type: 'count', label: 'dozen', base: 'ea', factor: 12, plural: 'dozen' },
  g: { type: 'weight', label: 'g', base: 'g', factor: 1, plural: 'g' },
  kg: { type: 'weight', label: 'kg', base: 'g', factor: 1000, plural: 'kg' },
  ml: { type: 'volume', label: 'ml', base: 'ml', factor: 1, plural: 'ml' },
  l: { type: 'volume', label: 'L', base: 'ml', factor: 1000, plural: 'L' },
} as const;

export type UnitCode = keyof typeof UNITS;
export type UnitType = (typeof UNITS)[UnitCode]['type'];

export const UNIT_CODES = Object.keys(UNITS) as UnitCode[];

export function isUnitCode(code: string): code is UnitCode {
  return Object.hasOwn(UNITS, code);
}

export function unitType(code: UnitCode): UnitType {
  return UNITS[code].type;
}

export function toBase(value: number, code: UnitCode): number {
  return value * UNITS[code].factor;
}

export function convert(value: number, from: UnitCode, to: UnitCode): number | null {
  if (unitType(from) !== unitType(to)) return null;
  return toBase(value, from) / UNITS[to].factor;
}

export function displayUnit(value: number, type: UnitType): UnitCode {
  if (type === 'count') return 'ea';
  if (type === 'weight') return value >= 1000 ? 'kg' : 'g';
  return value >= 1000 ? 'l' : 'ml';
}

export function formatQty(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Number(rounded.toFixed(2)));
}
