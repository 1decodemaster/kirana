import type Database from 'better-sqlite3';
import {
  fold,
  matchQuality,
  normalizeName,
  prepareQuery,
  type ImportPreviewResponse,
  type ImportRowDto,
  type SearchCandidate,
} from '@kirana/shared';
import { inFileKey, type ParsedImportRow } from './importParse.js';

interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly candidate: SearchCandidate;
}

const FUZZY_SUGGEST_RATIO = 0.9;
// matchQuality's fuzzy tier returns quality = 0.5·editRatio, so a §9.3
// "fuzzy ≥ 0.9" suggestion is quality ≥ 0.45.
const FUZZY_SUGGEST_QUALITY = 0.45;

/** Resolve every parsed row against the live catalog: exact name, exact alias,
 * fuzzy ≥ 0.9 (§9.3), or an in-file duplicate of an earlier line on the same
 * store. Nothing is written to the DB. */
export function previewImport(
  db: Database.Database,
  householdId: string,
  rows: readonly ParsedImportRow[],
): { counts: Omit<ImportPreviewResponse, 'rows' | 'token'>; rows: ImportRowDto[]; invalidLines: Set<number> } {
  const byNorm = new Map<string, CatalogEntry>();
  const aliasOwner = new Map<string, CatalogEntry>();
  const catalog: CatalogEntry[] = [];

  interface ItemNameRow {
    readonly id: string;
    readonly name: string;
    readonly name_norm: string;
  }
  const itemRows = db
    .prepare(
      `SELECT id, name, name_norm FROM items WHERE household_id = ? AND deleted_at IS NULL ORDER BY name_norm, id`,
    )
    .all(householdId) as ItemNameRow[];
  const aliasRows = db
    .prepare(
      `SELECT a.item_id, a.alias, a.alias_norm FROM item_aliases a
       JOIN items i ON i.id = a.item_id
       WHERE i.household_id = ? AND i.deleted_at IS NULL
       ORDER BY a.alias_norm, a.id`,
    )
    .all(householdId) as Array<{ item_id: string; alias: string; alias_norm: string }>;

  const aliasesByItem = new Map<string, string[]>();
  for (const a of aliasRows) {
    const bucket = aliasesByItem.get(a.item_id) ?? [];
    bucket.push(a.alias);
    aliasesByItem.set(a.item_id, bucket);
  }
  const entryById = new Map<string, CatalogEntry>();
  for (const row of itemRows) {
    const entry: CatalogEntry = {
      id: row.id,
      name: row.name,
      candidate: {
        nameNorm: row.name_norm,
        nameFold: fold(row.name),
        aliasNorms: (aliasesByItem.get(row.id) ?? []).map(normalizeName),
        aliasFolds: (aliasesByItem.get(row.id) ?? []).map(fold),
      },
    };
    catalog.push(entry);
    entryById.set(row.id, entry);
    if (!byNorm.has(row.name_norm)) byNorm.set(row.name_norm, entry);
  }
  for (const a of aliasRows) {
    const entry = entryById.get(a.item_id);
    if (entry !== undefined && !aliasOwner.has(a.alias_norm)) aliasOwner.set(a.alias_norm, entry);
  }

  const seenInFile = new Map<string, number>();
  const outRows: ImportRowDto[] = [];
  const invalidLines = new Set<number>();
  const counts = { new: 0, duplicate: 0, conflict: 0, invalid: 0 };

  for (const row of rows) {
    const base = {
      line: row.line,
      store: row.store,
      category: row.category,
      name: row.name,
      aliases: [...row.aliases],
      qty: row.qty,
      unit: row.unit,
      note: row.note,
    };
    if (row.error !== null) {
      counts.invalid += 1;
      invalidLines.add(row.line);
      outRows.push({ ...base, action: 'error', targetItemId: null, targetName: null, message: row.error });
      continue;
    }

    const norm = normalizeName(row.name);
    const key = inFileKey(row.name, row.store);
    const firstLine = seenInFile.get(key);
    if (firstLine !== undefined) {
      counts.conflict += 1;
      outRows.push({
        ...base,
        action: 'skip',
        targetItemId: null,
        targetName: null,
        message: `Same item already on line ${firstLine} of this file`,
      });
      continue;
    }
    seenInFile.set(key, row.line);

    const exact = byNorm.get(norm);
    if (exact !== undefined) {
      counts.duplicate += 1;
      outRows.push({
        ...base,
        action: 'merge',
        targetItemId: exact.id,
        targetName: exact.name,
        message: 'Matches an existing item by name',
      });
      continue;
    }

    const aliasHit = aliasOwner.get(norm);
    if (aliasHit !== undefined) {
      counts.duplicate += 1;
      outRows.push({
        ...base,
        action: 'merge',
        targetItemId: aliasHit.id,
        targetName: aliasHit.name,
        message: 'Matches an existing item by alias',
      });
      continue;
    }

    const fuzzy = fuzzySuggestion(prepareQuery(row.name), catalog);
    if (fuzzy !== undefined) {
      counts.duplicate += 1;
      outRows.push({
        ...base,
        action: 'merge',
        targetItemId: fuzzy.id,
        targetName: fuzzy.name,
        message: `Similar to "${fuzzy.name}"`,
      });
      continue;
    }

    counts.new += 1;
    outRows.push({ ...base, action: 'create', targetItemId: null, targetName: null, message: null });
  }

  return { counts, rows: outRows, invalidLines };
}

function fuzzySuggestion(prepared: ReturnType<typeof prepareQuery>, catalog: readonly CatalogEntry[]): CatalogEntry | undefined {
  const queryLength = prepared.folded.length;
  let best: { entry: CatalogEntry; quality: number } | undefined;
  for (const entry of catalog) {
    // Edit ratio ≥ 0.9 needs a length gap ≤ 10%; skip the rest cheaply.
    const candidateLength = entry.candidate.nameFold.length;
    const gap = Math.abs(candidateLength - queryLength);
    const maxLen = Math.max(candidateLength, queryLength);
    if (maxLen > 0 && gap / maxLen > 1 - FUZZY_SUGGEST_RATIO) continue;
    const match = matchQuality(prepared, entry.candidate);
    if (match === null || match.via !== 'fuzzy') continue;
    if (match.quality >= FUZZY_SUGGEST_QUALITY && (best === undefined || match.quality > best.quality)) {
      best = { entry, quality: match.quality };
    }
  }
  return best?.entry;
}
