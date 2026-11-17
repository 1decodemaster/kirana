# Changelog

All notable changes to Kirana are documented here. The format follows
Keep a Changelog; versions are tagged in git.

## 1.0.0 — 2026-11-17

First stable release: a self-hosted shopping board for one household —
installable, offline-tolerant, multi-user, multilingual.

### Added

**Board (P1)**
- Per-store shopping lists grouped by aisle (category), with quantities,
  units and notes; check off, clear bought, archive.
- Add-item sheet with a three-tap flow: fuzzy duplicate guard, per-store
  dedupe (adding an item that's already on the store's list merges the
  quantity instead of creating a second row), §8.6 quick-parse of
  "milk 2 l"-style input.
- Multilingual catalog: item aliases (e.g. atta/आटा, chawal/चावल) resolved
  on add; 40-item starter catalog and 26 seeded categories.
- Catalog and management screens: items, categories (with per-store aisle
  order), stores; item merge with alias migration.
- Shop Mode: one-category-at-a-time view, auto-advance, oversized rows,
  progress header, wake lock, done-shopping action.

**Sync & households (P4)**
- Households with member profiles (name + color avatar) and a shared
  passcode; per-member sessions survive restarts.
- Live sync: changes made on one device appear on the others in under a
  second (Server-Sent Events).
- Offline mutation queue: checks and adds made offline replay when
  connectivity returns, exactly once (idempotent `clientId`).
- Installable PWA: offline app shell, manifest + icons, offline banner
  with queued-change counts.
- First-run wizard, settings (household, members, theme incl. dark mode,
  data, about), session-expiry handling.

**Data (P3)**
- CSV and JSON import with preview → confirm → commit (atomic), duplicate
  detection with merge suggestions; CSV export per store; full JSON export
  for round-trip restore.
- On-demand backups (`POST /admin/backup` + Settings → Data) with 14 daily
  + 8 weekly retention; nightly backup via host cron script.

**Platform**
- Single Docker image (Node 22), SQLite storage, ~200KB gzipped app bundle,
  cold start under a second, board p95 ~12ms at 2,000 items.
- Structured JSON logs with request ids; no telemetry, no analytics, no
  external calls; works fully offline.

### Notes

- The passcode protects against casual access on a trusted LAN — it is not
  strong authentication. See the README.
- Import treats category names as grocery-scope (R-014): a household-scope
  category in an import file is re-created as a grocery row. Known
  limitation, post-1.0.
