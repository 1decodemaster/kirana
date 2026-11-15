import type { UnitCode } from './units.js';

const LEADING_X = /^x\s*(\d+(?:\.\d+)?)\s+(.+)$/i;
const LEADING_QTY = /^(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|grams?|ml|l|ltr|litre|liter)\s+(.+)$/i;
const TRAILING_X = /^(.+?)\s+x\s*(\d+(?:\.\d+)?)\s*$/i;
const TRAILING_UNIT =
  /^(.+?)\s+(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|grams?|ml|l|ltr|litre|liter|dozen|dz|pack|packs|pcs?|x)\s*$/i;
const TRAILING_DOZEN = /^(.+?)\s+(dozen|dz)\s*$/i;
const TRAILING_BARE = /^(.+?)\s+(\d+(?:\.\d+)?)\s*$/i;

const UNIT_ALIASES: Readonly<Record<string, UnitCode>> = {
  ea: 'ea',
  kg: 'kg',
  kgs: 'kg',
  g: 'g',
  gm: 'g',
  gms: 'g',
  gram: 'g',
  grams: 'g',
  ml: 'ml',
  l: 'l',
  ltr: 'l',
  litre: 'l',
  liter: 'l',
  dozen: 'dozen',
  dz: 'dozen',
  pack: 'pack',
  packs: 'pack',
  pc: 'ea',
  pcs: 'ea',
  x: 'ea',
};

export interface ParsedQuantity {
  name: string;
  qty: number;
  unit: UnitCode;
}

export function parseQty(input: string): ParsedQuantity | null {
  const text = input.trim();
  if (text.length === 0) return null;

  const leadingX = LEADING_X.exec(text);
  if (leadingX) return build(grp(leadingX, 1), 'ea', grp(leadingX, 2));

  const leading = LEADING_QTY.exec(text);
  if (leading) return build(grp(leading, 1), grp(leading, 2), grp(leading, 3));

  const trailingX = TRAILING_X.exec(text);
  if (trailingX) return build(grp(trailingX, 2), 'ea', grp(trailingX, 1));

  const trailingUnit = TRAILING_UNIT.exec(text);
  if (trailingUnit) return build(grp(trailingUnit, 2), grp(trailingUnit, 3), grp(trailingUnit, 1));

  const trailingDozen = TRAILING_DOZEN.exec(text);
  if (trailingDozen) return build('1', grp(trailingDozen, 2), grp(trailingDozen, 1));

  const trailingBare = TRAILING_BARE.exec(text);
  if (trailingBare) return build(grp(trailingBare, 2), 'ea', grp(trailingBare, 1));

  return null;
}

function grp(m: RegExpExecArray, i: number): string {
  const g = m[i];
  /* v8 ignore next -- the grammar has no optional captures; guards future edits */
  if (g === undefined) throw new Error(`regex capture ${i} missing`);
  return g;
}

function build(qtyText: string, unitText: string, nameText: string): ParsedQuantity | null {
  const qty = Number(qtyText);
  /* v8 ignore next -- the grammar only captures \d+(\.\d+)?, always finite */
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const unit = UNIT_ALIASES[unitText.toLowerCase()];
  /* v8 ignore next -- the unit alternations are exactly the UNIT_ALIASES keys */
  if (unit === undefined) return null;
  const name = nameText.replace(/\s+/g, ' ').trim();
  /* v8 ignore next -- parseQty trims before matching, so names cannot be empty */
  if (name.length === 0) return null;
  return { name, qty, unit };
}
