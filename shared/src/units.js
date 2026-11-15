export const UNITS = {
    ea: { type: 'count', label: 'ea', base: 'ea', factor: 1, plural: 'ea' },
    pack: { type: 'count', label: 'pack', base: 'ea', factor: 1, plural: 'packs' },
    dozen: { type: 'count', label: 'dozen', base: 'ea', factor: 12, plural: 'dozen' },
    g: { type: 'weight', label: 'g', base: 'g', factor: 1, plural: 'g' },
    kg: { type: 'weight', label: 'kg', base: 'g', factor: 1000, plural: 'kg' },
    ml: { type: 'volume', label: 'ml', base: 'ml', factor: 1, plural: 'ml' },
    l: { type: 'volume', label: 'L', base: 'ml', factor: 1000, plural: 'L' },
};
export const UNIT_CODES = Object.keys(UNITS);
export function isUnitCode(code) {
    return Object.hasOwn(UNITS, code);
}
export function unitType(code) {
    return UNITS[code].type;
}
export function toBase(value, code) {
    return value * UNITS[code].factor;
}
export function convert(value, from, to) {
    if (unitType(from) !== unitType(to))
        return null;
    return toBase(value, from) / UNITS[to].factor;
}
export function displayUnit(value, type) {
    if (type === 'count')
        return 'ea';
    if (type === 'weight')
        return value >= 1000 ? 'kg' : 'g';
    return value >= 1000 ? 'l' : 'ml';
}
export function formatQty(value) {
    const rounded = Math.round(value * 100) / 100;
    return String(Number(rounded.toFixed(2)));
}
//# sourceMappingURL=units.js.map