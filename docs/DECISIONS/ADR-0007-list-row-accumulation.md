# ADR-0007 — List rows accumulate within a store (one active row per item)

**Status:** Accepted
**Date:** 2026-11-17
**Phase:** P4 follow-up (user-reported)
**Refs:** PRD §6.4 step 6 ("Insert list_item" — read as unconditional until
now), §6.5, §6.8, §7.4, §4.7; INV-8

## Context

Adding an item that already sits as an **active** row in the same store
created a second row: "Milk 2 l" + "Milk 1 l" → two Milk rows in Costco.
The product owner wants the quantities to accumulate under one row per
item per store. The PRD's §6.4 step 6 says "Insert list_item" without
considering the already-on-the-list case — this ADR amends that rule.

## Decision

**Invariant:** at most one `active` list row per `(store, item)`.

**Merge rule** — on add, resolve the catalog item first (§6.4 unchanged),
then look for the active row `(store_id, item_id)`. When it exists:

- incoming add carries **neither qty nor unit** → the row is unchanged.
- **units equal** (null counts as its own value, null == null) →
  `qty = Σ(existing, incoming)` treating null as 0; both null stays null.
- **units differ** → replace qty+unit with the incoming values **only when
  the incoming add carries a quantity**; a unit-only change without a
  quantity is ambiguous and changes nothing.
- an explicitly provided `note` or `categoryId` replaces the row's.
- keep: id, status, sort_order, created_at, added_by.
- `updated_at = now`; `item_store_stats` still bumps (`times_added + 1`,
  `last_added_at = now`, §6.5 write-back — INV-8 untouched); change_log
  records **`update`** on the existing row (not `create`).
- response is **200** with the merged row (201 remains "created"; the
  clientId replay case is unchanged and checked first).
- `bought` and `cleared` rows never merge — re-adding after buying is a
  new need and creates a fresh active row. A different store is a
  different row.

**Import parity:** `attachListRow` (import commit) applies the same rule,
so importing onto a live board cannot mint duplicates either.

**Existing duplicates:** migration **0004** (data-only, no schema change)
consolidates history: per `(store_id, item_id)` among active rows keep the
first row by `(sort_order, created_at, id)`; when all rows share one unit
(null included) the survivor's qty becomes the sum, otherwise the
survivor's own qty/unit stand; bought/cleared rows are untouched. Per-add
history remains in change_log. No `.backup` step required — nothing is
dropped but duplicate active rows whose quantities fold into the survivor
(AGENTS §8.2 covers drop/rename columns; no column changes here).

## Consequences

- The web client's optimistic add mirrors the rule (cache merge by itemId
  when present, else name) so the optimistic view no longer flashes a
  second row.
- `POST /stores/:id/items` returning 200 now means "replay or merge" —
  response shape unchanged, openapi summary updated. No schema change, no
  contract version bump (v1.4 stands).
- Migration 0004 is claimed by this change; the alias soft-delete backlog
  item moves to 0005.
