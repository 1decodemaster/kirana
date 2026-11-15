# ADR-0002: P2 search architecture — shared scorer, FTS5 rebuild, no Fuse.js

Status: Accepted
Date: 2026-11-15

Context: The P2 card mandates a search spike in the first 20% covering §8.6
ranking, "FTS5 wiring", a "local Fuse.js index", and the Devanagari matching
question left open by P0 (PHASE-0 Learned a: `normalizeName` NFKD-strips
Devanagari matras/viramas, so `चावल` → `च वल`). Probes run this session
(scripts in `/tmp/opencode`, results in `docs/progress/PHASE-2.md`):

1. `normalizeName`/`fold` handle Devanagari queries correctly for **exact and
   prefix** matching: both sides mangle identically, nukta variants collapse
   (`प्याज़` ≡ `प्याज`), and prefix works on norms (`प्या` → `पय ज`). No
   Devanagari-specific code path is needed for the exact/alias/prefix tiers.
2. The P0 FTS5 table (`item_search`, trigram tokenizer) is **case-sensitive on
   raw columns** (`milk` does not match `Milk variant 0`), `search_keys` lacks
   `fold(name)`, and a virtual table's tokenizer cannot be altered in place.
3. FTS5 trigram MATCH retrieval at the 5,000-item cap: 0.05–1.0 ms/query.
   Pure-JS scoring of all 5,000 candidates: 7–23 ms/keystroke (edit-distance
   tier dominates). Both fit AC-A1's 50 ms; FTS5 is a 20–100× retrieval win at
   the cap and the PRD mandates the wiring.
4. Multi-word MATCH must be built as quoted per-token phrases (bare queries are
   AND-of-tokens and tokens <3 codepoints silently fail the whole query).
   Tokens below 3 codepoints must be dropped from the FTS query and left to
   the SQL/JS tiers.
5. Footgun: `fold("zzzz")` → `"j"` (z→j then repeat-collapse). Any length gate
   must be applied to the **transformed** form, never the raw query.

Decision:

1. **One scorer, in shared.** `shared/src/search.ts` implements §8.6 verbatim
   (matchQuality tiers 1.00/0.95/0.85/0.70/fuzzy, score
   `0.55·mq + 0.25·affinity + 0.15·recency + 0.05·frequency`) plus
   `editDistance` and the §6.4 `resolveItem` decision function. Server and web
   call the same pure functions — "client and server must agree" is satisfied
   by construction, not by ported copies.
2. **No Fuse.js.** Its bitap scoring cannot express §8.6's tiered weights,
   alias matching, or per-store affinity; it would be a candidate filter whose
   output we re-rank anyway. The shared scorer over precomputed haystacks
   meets AC-A1 with one dependency fewer. This deviates from the P2 card's
   "local Fuse.js index" wording; §4.4's intent (<5 ms local lookup, no
   network) is preserved.
3. **Migration 0002 rebuilds `item_search`** with a single canonical `keys`
   column = `normalizeName(name) + normalizeName(alias)… + fold(name) +
   fold(alias)…` (already lowercase, so the tokenizer's case-sensitivity is
   harmless), plus the six sync triggers rebuilt for the new shape. It is
   derived, rebuildable data (no user rows; no `.backup` required, but the
   runner's transaction still applies). `db:reindex` rebuilds it from items +
   aliases. FTS5 is a **prefilter for the 0.70 substring tier only**; exact,
   alias and prefix tiers are parameterized SQL on `name_norm`/`alias_norm`.
4. **Devanagari** rides the exact/alias/prefix SQL tiers (probe 1); its
   post-mangle tokens are usually <3 codepoints so FTS contributes nothing —
   accepted, because G2.4's queries (`pya`, `pyaz`, `प्याज़`, `chawa`, `dood`,
   `milk`) are all satisfied by the SQL tiers and JS scorer.
5. **Contract addendum v1.0 → v1.1 (additive, backward compatible):**
   - `catalogItemDto.stats?: { timesAdded, lastAddedAt, storeIds }` — the board
     ships per-item `item_store_stats` signals so the client's local index can
     compute affinity/recency/frequency exactly like the server (§8.6 "must
     agree"; §8.4's "In this store" grouping needs ever-added affinity, which
     current-list proxies cannot express after a clear-bought).
   - `getItemsQuery.storeId?: uuid` — §8.6's `inStore` is defined per store;
     without a storeId in the query the response field is meaningless.
6. **Near-duplicate threshold (§6.4):** `best.score ≥ 0.90` uses the **full
   §8.6 score** (matchQuality + signals) of the best candidate not already
   caught by the exact/alias steps. Consequence: frequent, recently-added
   items prompt on prefix-typed input (0.85 + 0.25 affinity + …), while
   never-added items create freely — dedupe pressure lands exactly where
   duplicates actually happen. The add-item sheet previews the same decision
   client-side via `resolveItem` (AC-A4's exact-match prompt fires before any
   network call); the server stays authoritative and replays/other clients get
   the 409. "Create new anyway" = `POST /items` (create, or 200 with the
   existing item when the norm is exact — INV-5 makes a true duplicate
   impossible) followed by a `POST /stores/:id/items` with `itemId`.
7. **Server candidate retrieval** = SQL exact/alias/prefix ∪ FTS5 quoted-phrase
   MATCH (norm-tokens and fold-tokens ≥3 codepoints) ∪ JS edit-distance tier,
   the last run over the full catalog whenever the higher tiers yield fewer
   than `limit` matches. Known bounded divergence: an affinity-boosted
   edit-only match (§8.6 signals ≥ 0.20) could outrank the limit-th weak tier
   match, so a full page of tier matches may hide such a candidate server-side
   while the client's full-scan index finds it. The add-item sheet ranks
   client-side (§4.4), so user-facing suggestions stay complete; GET /items is
   the authority for P3 management screens where the tail matters less. The
   POST-by-name add path always runs the full scan, so the §6.4 near-duplicate
   guard never misses a candidate.

Consequences: shared/** changes ride a `contract:` PR with this ADR;
`openapi.json` regenerates; `db/schema-hash.txt` is re-pinned; the board
builder gains one `item_store_stats` query (G1.2 fixture has no stats rows —
gate unaffected, re-evidenced anyway).

Alternatives rejected:
- Fuse.js locally (see 2) and Fuse.js on the server (same objections, plus a
  second fuzzy implementation to keep in sync).
- Keeping the 0001 FTS shape and querying raw columns with `case_sensitive 0`:
  impossible — the tokenizer is fixed at table creation; raw columns also lose
  diacritic-insensitive matches ('cafe' vs 'Café') that the JS tiers find.
- Skipping FTS5 entirely (pure JS scan): fastest to ship, but silently drops
  "FTS5 wiring" from the P2 card and gives up a free 20–100× prefilter.
- matchQuality-only near-duplicate threshold: would let 'oni' silently create
  a near-duplicate of a store staple, violating §6.4's prime rule.

Refs: PRD §4.4, §5.2, §5.3, §5.5, §6.1, §6.4, §7.4, §8.4, §8.6, §15.3 (P2),
§22.B; AGENTS.md §4.1, §9.5
