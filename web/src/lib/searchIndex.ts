import {
  buildSearchCandidate,
  compareMatches,
  EMPTY_SIGNALS,
  normalizeName,
  prepareQuery,
  resolveItem,
  searchScore,
  type CatalogItemDto,
  type ResolveCandidate,
  type ResolveDecision,
  type SearchResultDto,
  type SearchSignals,
} from '@kirana/shared';

/** The add-item sheet's local index (ADR-0002): the board's catalog is already
 * in memory, so suggestions rank identically to the server with zero network.
 * `now` is injected — no clock reads in pure modules. */

export interface CatalogEntry {
  readonly item: CatalogItemDto;
  readonly signals: SearchSignals;
}

export function buildIndex(catalog: readonly CatalogItemDto[]): CatalogEntry[] {
  // Validation of candidates happens inside searchScore; here we only pair
  // each item with its §8.6 signals (stats are optional on the wire).
  return catalog.map((item) => ({
    item,
    signals: item.stats ?? EMPTY_SIGNALS,
  }));
}

export function searchCatalog(
  index: readonly CatalogEntry[],
  rawQuery: string,
  storeId: string | null,
  now: number,
  limit = 5,
): SearchResultDto[] {
  const query = rawQuery.trim();
  if (query.length === 0) return [];
  const prepared = prepareQuery(query);

  const scored: Array<{ entry: CatalogEntry; score: number; quality: number; via: SearchResultDto['matchedVia'] }> = [];
  for (const entry of index) {
    const candidate = buildSearchCandidate(entry.item.name, entry.item.aliases);
    const match = searchScore(prepared, candidate, entry.signals, storeId, now);
    if (match === null) continue;
    scored.push({ entry, score: match.score, quality: match.quality, via: match.via });
  }
  scored.sort((a, b) =>
    compareMatches(
      { score: a.score, quality: a.quality, nameNorm: a.entry.item.norm, id: a.entry.item.id },
      { score: b.score, quality: b.quality, nameNorm: b.entry.item.norm, id: b.entry.item.id },
    ),
  );
  return scored.slice(0, limit).map(({ entry, score, via }) => ({
    id: entry.item.id,
    name: entry.item.name,
    norm: entry.item.norm,
    defaultUnit: entry.item.defaultUnit,
    defaultCategoryId: entry.item.defaultCategoryId,
    iconRef: entry.item.iconRef,
    matchedVia: via,
    inStore: storeId !== null && (entry.item.stats?.storeIds.includes(storeId) ?? false),
    score,
  }));
}

/** Display name of an index entry by item id (for the AC-A4 prompt card). */
export function exactNameOf(index: readonly CatalogEntry[], itemId: string): string | null {
  return index.find((e) => e.item.id === itemId)?.item.name ?? null;
}

/** §6.4 resolution against the local index — the sheet previews the exact
 * decision the server would make (AC-A4's prompt fires before any network
 * call; the server stays authoritative for replays and other clients). */
export function resolveLocal(
  index: readonly CatalogEntry[],
  rawName: string,
  storeId: string | null,
  now: number,
): ResolveDecision {
  const norm = normalizeName(rawName);
  let exactHit: { id: string } | null = null;
  let aliasHit: { id: string } | null = null;
  for (const entry of index) {
    if (exactHit === null && entry.item.norm === norm) exactHit = { id: entry.item.id };
    if (
      aliasHit === null &&
      entry.item.aliases.some((a) => normalizeName(a) === norm)
    ) {
      aliasHit = { id: entry.item.id };
    }
  }
  const fuzzyTop: ResolveCandidate[] = searchCatalog(index, rawName, storeId, now, 5).map((r) => ({
    id: r.id,
    name: r.name,
    score: r.score,
  }));
  return resolveItem(exactHit, aliasHit, fuzzyTop);
}
