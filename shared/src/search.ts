import { fold } from './fold.js';
import { normalizeName } from './normalize.js';

/** §8.6 search ranking — the single scorer used by both the server
 * (GET /items, near-duplicate guard) and the web add-item sheet's local
 * index (ADR-0002). Pure: no DB, no clock — `now` and all signals are
 * injected. */

export type MatchedVia = 'name' | 'alias' | 'fuzzy';

export interface PreparedQuery {
  readonly raw: string;
  readonly norm: string;
  readonly folded: string;
}

export function prepareQuery(raw: string): PreparedQuery {
  return { raw, norm: normalizeName(raw), folded: fold(raw) };
}

export interface SearchCandidate {
  readonly nameNorm: string;
  readonly nameFold: string;
  readonly aliasNorms: readonly string[];
  readonly aliasFolds: readonly string[];
}

export function buildSearchCandidate(name: string, aliases: readonly string[]): SearchCandidate {
  return {
    nameNorm: normalizeName(name),
    nameFold: fold(name),
    aliasNorms: aliases.map(normalizeName),
    aliasFolds: aliases.map(fold),
  };
}

export interface MatchQualityResult {
  readonly quality: number;
  readonly via: MatchedVia;
}

const EDIT_TIER_MIN_RATIO = 0.7;
const EDIT_TIER_WEIGHT = 0.5;
const SUBSTRING_MIN_LENGTH = 3;

const DP_UNSET = 2 ** 31 - 1; // exceeds any reachable distance (names ≤ 80 chars)

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Row reads under noUncheckedIndexedAccess are `T | undefined`; an unset
  // cell would be a bug, so it degrades to a sentinel the min() discards.
  const prev = new Uint32Array(n + 1);
  const cur = new Uint32Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const deletion = (prev[j] ?? DP_UNSET) + 1;
      const insertion = (cur[j - 1] ?? DP_UNSET) + 1;
      const substitution = (prev[j - 1] ?? DP_UNSET) + cost;
      cur[j] = Math.min(deletion, insertion, substitution);
    }
    prev.set(cur);
  }
  return prev[n] ?? m + n;
}

/** Edit-distance similarity of two folded strings, or null when below the
 * §8.6 fuzzy gate (ratio ≥ 0.7). */
function editRatio(queryFolded: string, candidateFolded: string): number | null {
  const maxLen = Math.max(queryFolded.length, candidateFolded.length);
  // dist ≥ |len diff|, so ratio ≤ 1 − |diff|/maxLen; prune below the gate.
  if ((maxLen - Math.min(queryFolded.length, candidateFolded.length)) / maxLen > 1 - EDIT_TIER_MIN_RATIO) {
    return null;
  }
  const ratio = 1 - editDistance(queryFolded, candidateFolded) / maxLen;
  return ratio >= EDIT_TIER_MIN_RATIO ? ratio : null;
}

/** §8.6 matchQuality. Returns null when the query matches nothing.
 * Length gates apply to the transformed forms: fold("zzzz") collapses to "j",
 * so a raw-length gate would let a junk query substring-match everything. */
export function matchQuality(query: PreparedQuery, candidate: SearchCandidate): MatchQualityResult | null {
  const { norm, folded } = query;
  if (norm.length === 0) return null;

  if (candidate.nameNorm === norm) return { quality: 1.0, via: 'name' };
  if (candidate.aliasNorms.includes(norm)) return { quality: 0.95, via: 'alias' };

  if (candidate.nameNorm.startsWith(norm)) return { quality: 0.85, via: 'name' };
  if (candidate.aliasNorms.some((a) => a.startsWith(norm))) return { quality: 0.85, via: 'alias' };

  if (folded.length > 0) {
    if (candidate.nameFold.startsWith(folded)) return { quality: 0.85, via: 'name' };
    if (candidate.aliasFolds.some((a) => a.startsWith(folded))) return { quality: 0.85, via: 'alias' };
  }

  if (norm.length >= SUBSTRING_MIN_LENGTH) {
    if (candidate.nameNorm.includes(norm)) return { quality: 0.7, via: 'name' };
    if (candidate.aliasNorms.some((a) => a.includes(norm))) return { quality: 0.7, via: 'alias' };
  }
  if (folded.length >= SUBSTRING_MIN_LENGTH) {
    if (candidate.nameFold.includes(folded)) return { quality: 0.7, via: 'name' };
    if (candidate.aliasFolds.some((a) => a.includes(folded))) return { quality: 0.7, via: 'alias' };
  }

  let best: number | null = null;
  for (const f of [candidate.nameFold, ...candidate.aliasFolds]) {
    const ratio = editRatio(folded, f);
    if (ratio !== null && (best === null || ratio > best)) best = ratio;
  }
  if (best !== null) return { quality: EDIT_TIER_WEIGHT * best, via: 'fuzzy' };
  return null;
}

/** Per-item ranking signals from item_store_stats. The board ships them for
 * every catalog entry (ADR-0002) so client and server rank identically. */
export interface SearchSignals {
  readonly timesAdded: number;
  readonly lastAddedAt: number | null;
  readonly storeIds: readonly string[];
}

export const EMPTY_SIGNALS: SearchSignals = { timesAdded: 0, lastAddedAt: null, storeIds: [] };

export interface ScoredMatch {
  readonly score: number;
  readonly quality: number;
  readonly via: MatchedVia;
}

const DAY_MS = 86_400_000;

/** §8.6 total score: 0.55·matchQuality + 0.25·storeAffinity + 0.15·recency
 * + 0.05·frequency. Null when the query does not match the candidate. */
export function searchScore(
  query: PreparedQuery,
  candidate: SearchCandidate,
  signals: SearchSignals,
  storeId: string | null,
  now: number,
): ScoredMatch | null {
  const mq = matchQuality(query, candidate);
  if (mq === null) return null;
  const affinity = storeId !== null && signals.storeIds.includes(storeId) ? 1 : 0;
  const daysSince = signals.lastAddedAt === null ? null : Math.max(0, (now - signals.lastAddedAt) / DAY_MS);
  const recency = daysSince === null ? 0 : Math.exp(-daysSince / 30);
  const frequency = Math.min(signals.timesAdded / 20, 1);
  const score = 0.55 * mq.quality + 0.25 * affinity + 0.15 * recency + 0.05 * frequency;
  return { score, quality: mq.quality, via: mq.via };
}

/** Deterministic ordering for equal scores (codepoint compare — never
 * locale-dependent). */
export function compareMatches(
  a: { score: number; quality: number; nameNorm: string; id: string },
  b: { score: number; quality: number; nameNorm: string; id: string },
): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.quality !== b.quality) return b.quality - a.quality;
  if (a.nameNorm !== b.nameNorm) return a.nameNorm < b.nameNorm ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** §6.4 catalog resolution — the decision, isolated from the lookups so the
 * server (SQL) and the sheet (local index) share it. Callers perform the
 * EXACT/ALIAS lookups and pass the top fuzzy candidates pre-sorted by score
 * (best first). */
export const NEAR_DUPLICATE_THRESHOLD = 0.9;
export const FUZZY_SUGGESTION_COUNT = 5;

export interface ResolveCandidate {
  readonly id: string;
  readonly name: string;
  readonly score: number;
}

export type ResolveDecision =
  | { readonly kind: 'exact'; readonly itemId: string }
  | { readonly kind: 'alias'; readonly itemId: string }
  | { readonly kind: 'near-duplicate'; readonly suggestions: readonly ResolveCandidate[] }
  | { readonly kind: 'create' };

export function resolveItem(
  exactNameHit: { readonly id: string } | null,
  aliasHit: { readonly id: string } | null,
  fuzzyTop: readonly ResolveCandidate[],
): ResolveDecision {
  if (exactNameHit !== null) return { kind: 'exact', itemId: exactNameHit.id };
  if (aliasHit !== null) return { kind: 'alias', itemId: aliasHit.id };
  const best = fuzzyTop[0];
  if (best !== undefined && best.score >= NEAR_DUPLICATE_THRESHOLD) {
    return { kind: 'near-duplicate', suggestions: fuzzyTop.slice(0, FUZZY_SUGGESTION_COUNT) };
  }
  return { kind: 'create' };
}

/** FTS5 trigram prefilter queries (ADR-0002): one per canonical form, each a
 * conjunction of quoted per-token phrases. Tokens under 3 codepoints cannot
 * trigram-match and are dropped — the SQL/JS tiers cover them. Returns null
 * when a side has no usable tokens. The caller UNIONs both sides' results. */
export function ftsPhraseQueries(raw: string): { norm: string | null; folded: string | null } {
  const norm = ftsSide(normalizeName(raw));
  const folded = ftsSide(fold(raw));
  return { norm, folded };
}

function ftsSide(form: string): string | null {
  // Quotes cannot survive normalizeName/fold (they are not in the keep-set),
  // so tokens never need FTS5 quote escaping.
  const tokens = form
    .split(' ')
    .filter((t) => [...t].length >= SUBSTRING_MIN_LENGTH)
    .map((t) => `"${t}"`);
  return tokens.length === 0 ? null : tokens.join(' ');
}
