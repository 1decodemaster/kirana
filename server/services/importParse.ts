import {
  exportPayloadSchema,
  normalizeName,
  unitCodeSchema,
  type ExportPayload,
  type UnitCode,
} from '@kirana/shared';
import { httpError } from '../plugins/errors.js';
import { CsvParseError, parseCsv } from './csv.js';

/** A row as it arrived in the file, validated per-field but not yet resolved
 * against the catalog. `error` holds the per-row reason when invalid. */
export interface ParsedImportRow {
  readonly line: number;
  readonly store: string;
  readonly category: string | null;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly qty: number | null;
  readonly unit: UnitCode | null;
  readonly note: string | null;
  readonly error: string | null;
}

const CSV_HEADER = ['store', 'category', 'name', 'aliases', 'qty', 'unit', 'note'] as const;

/** §9.1: store required, name required; qty/unit/note/aliases optional. */
const REQUIRED_COLUMNS = new Set<string>(['store', 'name']);

export const MAX_IMPORT_ROWS = 5000;
const MAX_STORE_NAME = 60;
const MAX_ITEM_NAME = 80;
const MAX_NOTE = 500;
const MAX_QTY = 1e6;

/** Parse an uploaded CSV (§9.1 header required) into rows. Physical file line
 * numbers (header = line 1) are preserved for the preview UI. */
export function parseCsvImport(text: string): ParsedImportRow[] {
  let parsed;
  try {
    parsed = parseCsv(text);
  } catch (error) {
    if (error instanceof CsvParseError) {
      throw httpError(400, 'IMPORT_PARSE_FAILED', `Malformed CSV: ${error.message}`);
    }
    throw error;
  }
  const [header, ...dataRows] = parsed.rows;
  if (header === undefined) {
    throw httpError(400, 'IMPORT_PARSE_FAILED', 'CSV is empty: a header row is required');
  }
  const columns = new Map<string, number>();
  header.forEach((name, index) => columns.set(name.trim().toLowerCase(), index));
  const missing = [...REQUIRED_COLUMNS].filter((c) => !columns.has(c));
  if (missing.length > 0) {
    throw httpError(400, 'IMPORT_PARSE_FAILED', `CSV header is missing required column(s): ${missing.join(', ')}`);
  }
  const unknown = header.filter((name) => name.trim().length > 0 && !CSV_HEADER.includes(name.trim().toLowerCase() as (typeof CSV_HEADER)[number]));
  if (unknown.length > 0) {
    throw httpError(400, 'IMPORT_PARSE_FAILED', `CSV header has unknown column(s): ${unknown.join(', ')}`);
  }

  const rows: ParsedImportRow[] = [];
  for (const fields of dataRows) {
    const line = parsed.lineNumbers[rows.length + 1];
    if (line === undefined) break;
    const cell = (column: (typeof CSV_HEADER)[number]): string => {
      const index = columns.get(column);
      const raw = index === undefined ? undefined : fields[index];
      return raw === undefined ? '' : raw;
    };
    rows.push(validateRow({
      line,
      store: cell('store'),
      category: cell('category'),
      name: cell('name'),
      aliases: cell('aliases'),
      qty: cell('qty'),
      unit: cell('unit'),
      note: cell('note'),
    }));
  }
  return rows;
}

/** Parse an uploaded /export payload verbatim (§9.1): every list row becomes
 * an import row, carrying its item's identity and aliases. */
export function parseJsonImport(text: string): ParsedImportRow[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw httpError(400, 'IMPORT_PARSE_FAILED', 'File is not valid JSON');
  }
  const result = exportPayloadSchema.safeParse(raw);
  if (!result.success) {
    throw httpError(400, 'IMPORT_PARSE_FAILED', 'JSON does not match the /export payload schema');
  }
  return rowsFromExportPayload(result.data);
}

/** The export payload → import rows (shared by the upload path and tests). */
export function rowsFromExportPayload(payload: ExportPayload): ParsedImportRow[] {
  const storeNameById = new Map(payload.stores.map((s) => [s.id, s.name]));
  const categoryNameById = new Map(payload.categories.map((c) => [c.id, c.name]));
  const itemById = new Map(payload.items.map((i) => [i.id, i]));

  return payload.listItems.map((listItem, index) => {
    const item = itemById.get(listItem.itemId);
    const store = storeNameById.get(listItem.storeId);
    if (item === undefined || store === undefined) {
      return {
        line: index + 1,
        store: store ?? '',
        category: null,
        name: item?.name ?? listItem.name,
        aliases: [],
        qty: null,
        unit: null,
        note: null,
        error: item === undefined ? 'List row references an item missing from the payload' : 'List row references a store missing from the payload',
      };
    }
    return validateRow({
      line: index + 1,
      store,
      category: listItem.categoryId === null ? '' : (categoryNameById.get(listItem.categoryId) ?? ''),
      name: item.name,
      aliases: item.aliases.map((a) => a.alias).join('|'),
      qty: listItem.qtyValue === null ? '' : String(listItem.qtyValue),
      unit: listItem.unitCode ?? '',
      note: listItem.note ?? '',
    });
  });
}

/** Apply the §9.1 field rules; anything broken makes the row invalid (the
 * preview shows why) rather than aborting the whole file. */
function validateRow(raw: {
  line: number;
  store: string;
  category: string;
  name: string;
  aliases: string;
  qty: string;
  unit: string;
  note: string;
}): ParsedImportRow {
  const store = raw.store.trim();
  const name = raw.name.trim();
  const category = raw.category.trim();
  const note = raw.note.trim();

  const aliases = raw.aliases
    .split('|')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

  let qty: number | null = null;
  if (raw.qty.trim().length > 0) {
    const parsed = Number(raw.qty.trim());
    if (!Number.isFinite(parsed)) {
      return invalid(raw, `qty "${raw.qty.trim()}" is not a number`);
    }
    if (parsed <= 0 || parsed > MAX_QTY) {
      return invalid(raw, `qty ${raw.qty.trim()} must be greater than 0`);
    }
    qty = parsed;
  }

  let unit: UnitCode | null = null;
  if (raw.unit.trim().length > 0) {
    const parsed = unitCodeSchema.safeParse(raw.unit.trim());
    if (!parsed.success) {
      return invalid(raw, `unit "${raw.unit.trim()}" is not a known unit`);
    }
    unit = parsed.data;
  }

  if (store.length === 0) return invalid(raw, 'store is required');
  if (store.length > MAX_STORE_NAME) return invalid(raw, `store name is longer than ${MAX_STORE_NAME} characters`);
  if (name.length === 0) return invalid(raw, 'name is required');
  if (name.length > MAX_ITEM_NAME) return invalid(raw, `name is longer than ${MAX_ITEM_NAME} characters`);
  if (category.length > MAX_STORE_NAME) return invalid(raw, `category name is longer than ${MAX_STORE_NAME} characters`);
  if (note.length > MAX_NOTE) return invalid(raw, `note is longer than ${MAX_NOTE} characters`);
  for (const alias of aliases) {
    if (alias.length > MAX_ITEM_NAME) {
      return invalid(raw, `alias "${alias}" is longer than ${MAX_ITEM_NAME} characters`);
    }
  }

  return { line: raw.line, store, category: category.length === 0 ? null : category, name, aliases, qty, unit, note: note.length === 0 ? null : note, error: null };
}

function invalid(raw: { line: number; store: string; category: string; name: string; aliases: string; qty: string; unit: string; note: string }, message: string): ParsedImportRow {
  return {
    line: raw.line,
    store: raw.store.trim(),
    category: raw.category.trim() === '' ? null : raw.category.trim(),
    name: raw.name.trim(),
    aliases: raw.aliases.split('|').map((a) => a.trim()).filter((a) => a.length > 0),
    qty: null,
    unit: null,
    note: raw.note.trim() === '' ? null : raw.note.trim(),
    error: message,
  };
}

const DEVANAGARI = /[\u0900-\u097F]/;

/** §9.1 language inference for import aliases: Devanagari → hi; Latin script
 * for a Devanagari item name → hi-Latn; otherwise en. */
export function inferAliasLang(alias: string, itemName: string): 'en' | 'hi-Latn' | 'hi' {
  if (DEVANAGARI.test(alias)) return 'hi';
  if (DEVANAGARI.test(itemName)) return 'hi-Latn';
  return 'en';
}

/** Which parser applies: explicit JSON content type, or a body that starts
 * like the /export object. Everything else is CSV (§9.1's default). */
export function isJsonUpload(mimetype: string, text: string): boolean {
  if (mimetype.includes('json')) return true;
  const trimmed = text.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/** Norm key for in-file duplicate detection: same item on the same store. */
export function inFileKey(name: string, store: string): string {
  return `${normalizeName(name)}\u0000${normalizeName(store)}`;
}
