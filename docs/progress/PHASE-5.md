# PHASE-5 — Hardening & Release

Goal: ship `v1.0.0` with confidence.
Refs: PRD §15.3 (P5), §10 NFR-1…15, §12.4, §12.5, §16. Gates: G5.1–G5.6.

## Task cards

- T-P5-01 — lane A: server perf verification — NFR-1, NFR-2, NFR-8, NFR-9,
  NFR-10, NFR-15, with a repeatable script and recorded numbers
- T-P5-02 — lane B: client perf + polish — NFR-3, NFR-4, NFR-5, NFR-6,
  error-state sweep (every screen), final a11y pass, device-testing checklist
- T-P5-03 — lane C: ops — restore drill (G5.2/NFR-12), backup wiring
  (NFR-11), README + operator guide (G5.5), env-var docs (§12.1)
- T-P5-04 — lane D: release notes — CHANGELOG, TODO sweep (G5.3),
  browser-support + device-test documentation (NFR-13, NFR-14)
- T-P5-05 — release (lanes C+D): merge P3+P4 to main, P5 PRs, CI green twice
  consecutively (G5.4), version bump, tag `v1.0.0` (G5.6), phase close

## Card details

### T-P5-01 — server perf (lane A)

Seed a database at the §10 scale (2,000 items / 500 list items / 2,000+
change_log rows), then measure with a repeatable script (`scripts/perf-*.ts`):
NFR-1 board p95 ≤50ms; NFR-2 any-API p95 ≤100ms; NFR-9 cold start ≤2s
(process start → first /healthz 200); NFR-10 RSS ≤256MB under that load;
NFR-8 projected size <50MB at 10 years (measured bytes/row × a stated
growth model — show the arithmetic); NFR-15 pino JSON + request id + no
PII (cite existing log shape, spot-check output). Numbers go in a table in
this file. If a number misses its budget, fix or file an ADR — no silent
misses.

### T-P5-02 — client perf + polish (lane B)

NFR-3 initial JS ≤250KB gzip (build + `gzip -c | wc -c` per initial chunk);
NFR-4 TTI ≤1.5s (Lighthouse, emulated mid-range Android on LAN — record the
number + configuration; real-device number is the manual pass in T-P5-04);
NFR-5 client search ≤30ms for 5,000 items (bench on the client index);
NFR-6 checkbox ≤16ms (optimistic update is a synchronous re-render — assert
by design + measure where honest). Error-state sweep: every screen has
empty/loading/error per AGENTS §13.6 — fix gaps. Final a11y pass (axe on
all screens, not just the G4.5 three). New UI strings go into §8.10.

### T-P5-03 — ops (lane C)

Restore drill per §12.5, executed and timed against a real backup: stop →
move DB aside → gunzip latest → start → /healthz + identical counts →
record elapsed (RTO ≤10 min, G5.2). `infra/backup.sh` reviewed + wired
(cron line in the operator guide; retention 14 daily + 8 weekly, NFR-11).
README rewritten so a stranger deploys from scratch in ≤15 minutes (G5.5):
compose file, env vars (§12.1 + the P4 test-only overrides), backup +
restore, passcode honesty (§11), reset-passcode path. No application code.

### T-P5-04 — release notes (lane D)

CHANGELOG.md — user-facing summary of P0→P5 (from the phase logs, not
invented). G5.3: grep every `src` tree for TODO/FIXME without an issue
reference — fix or reference. Document NFR-13 browser support (last 2
versions of iOS Safari, Chrome Android, Firefox, desktop Chrome/Safari) and
the manual device-test checklist (iOS Safari + Chrome Android) with what
was automated (Playwright webkit/chromium, emulated touch) vs what needs
real hardware.

### T-P5-05 — release (release lane)

Prerequisite fact: `main` currently tops out at P1.5 (Shop Mode); P3
(12 commits) and P4 (21 commits) are unmerged branches and CI has never run
on either. Release path: PR P3 → main, PR P4 → main (or one PR if P4
contains P3), then P5 work PRs; each green on CI. G5.4 = the full e2e suite
green on CI twice consecutively on the release state of main. Version bump
(root package.json → 1.0.0), annotated tag `v1.0.0` (G5.6), `phase-5-complete`
tag, STATUS.md + Handoff. Merge to main happens only with the product
owner's explicit go.

## Migration lock

None. 0004 applied; next free 0005 stays reserved for the alias soft-delete
backlog item (not P5 work).

## Open items carried in

- R-014 (lane A): import ensureCategory grocery-scope only — not a gate
  blocker; lands post-1.0 or as a drive-by if trivial.
- BACKLOG [P5] nightly backup — resolved by T-P5-03 (infra/backup.sh +
  operator guide). BACKLOG [P5?] ReorderList auto-scroll — stays optional;
  real-device pass will say if it hurts.
- Manual device testing (NFR-4/NFR-13) needs real hardware — the checklist
  is prepared here; the human pass is the product owner's.

## Gate evidence (running)

### G5.2 — restore drill (T-P5-03)

Executed 2026-11-17 against the live demo container per §12.5. Baseline
counts → WAL-safe `.backup` + gzip → `docker stop` → DB (+wal/shm) aside →
gunzip latest → `docker start` → `/healthz` 200 → counts identical
(51 items / 32 list rows / 5 stores / 252 change rows). **RTO 1.57s**
(gate: ≤10 min). Pre-drill DB kept at `data/kirana.db.pre-drill`.

### G5.1 — NFR numbers (T-P5-01 server half; T-P5-02 client half pending)

Machine: dev workstation (LAN, localhost HTTP), Node v22.23.2. NFR-1/2 have
two evidence sources: committed vitest perf tests (injected, run in CI) and
`tsx scripts/perf-nfr.ts` (real HTTP against the built server; R-015).

| NFR | Budget | Measured | Evidence |
| --- | --- | --- | --- |
| NFR-1 board p95 | ≤50ms @ 2k items/500 rows | 14.4ms injected; 11.8ms real HTTP (p50 9.5, p99 14.8, 120 samples) | `server/__tests__/board.perf.test.ts` (G1.2); scripts/perf-nfr.ts |
| NFR-2 any API p95 | ≤100ms | worst endpoint 30.7ms real HTTP (export 29.4, merge 30.7); 37.2ms injected; all 7 sampled endpoints under budget | `server/__tests__/nfr2.perf.test.ts` (new); scripts/perf-nfr.ts |
| NFR-3 initial JS | ≤250KB gzip | 202.03 kB gzip (702.56 kB raw; CSS 5.79 kB gzip) | web build output (vite gzip sizes) |
| NFR-4 TTI | ≤1.5s mid-range Android, LAN | 410–510ms warm at 4× CPU throttle (proxy; committed); cold no-cache 436–480ms | `e2e/specs/nfr-perf.spec.ts` (committed) |
| NFR-5 client search | ≤30ms @ 5,000 items | 1.0–2.2ms mean per query; resolveLocal 1.21ms mean | `web/src/lib/searchIndex.test.ts` (new bench) |
| NFR-6 checkbox feedback | ≤16ms | 3.8–4.3ms mean, max 12ms over 10 in-page toggles | `e2e/specs/nfr-perf.spec.ts` (committed) |
| NFR-7 SSE propagation | ≤1s | 333ms (P4 smoke); committed e2e asserts <1s | `e2e/specs/live-sync.spec.ts` |
| NFR-8 DB size | <50MB @ 10y | fixture 1.60MB/4,561 rows (367 B/row); model: items 10k, aliases 15k, stats 10k, list 1.5k (§6.7 purge), change_log 90k → projected 45.7MB | scripts/perf-nfr.ts (model printed; change_log dominates) |
| NFR-9 cold start | ≤2s | 803ms spawn → first /healthz 200 | scripts/perf-nfr.ts |
| NFR-10 RSS | ≤256MB | 152.8MB after the load run | scripts/perf-nfr.ts (/proc VmRSS) |
| NFR-15 logging | pino JSON, reqId, no PII beyond display names | 548/548 lines JSON, 543 carry reqId, zero passcode/sid/set-cookie occurrences (canary passcode planted) | scripts/perf-nfr.ts; `server/__tests__/app.test.ts` x-request-id cases |

NFR-8 sensitivity note: the projection's dominant term is change_log
(90k rows modeled). The model assumes the §6.7 purge runs nightly (P6
backlog — the P0 jobs stub only logs). If the purge never lands, change_log
grows unbounded and the 50MB budget is a when, not an if. Recorded as a
BACKLOG note, not a P5 blocker.

## Session log

## 2026-11-17 — lane A — T-P5-01 (server perf verification)

Built:      server/__tests__/nfr2.perf.test.ts — NFR-2 any-API p95 at the
            §10 scale (2k items/500 rows; 7-endpoint mix incl. the ADR-0007
            merge path with a fixed clientId so runs 2+ are replays). New
            scripts/perf-nfr.ts — standalone harness: seeds the temp DB at
            §10 scale, spawns server/dist/index.js, measures NFR-1/2 over
            real HTTP, cold start (NFR-9), /proc RSS (NFR-10), DB size +
            stated 10-year model (NFR-8), log shape with a canary passcode
            (NFR-15). Numbers table added to this file under G5.1.
Tests:      nfr2.perf.test.ts green (1/1); scripts/perf-nfr.ts exit 0 —
            every budget met (see G5.1 table). Existing suite untouched.
Decisions:  (1) Perf evidence lives in two forms: committed vitest tests
            (board.perf.test.ts for NFR-1 already existed; nfr2.perf.test.ts
            new) + the standalone script for what doesn't belong in unit
            tests (cold start, RSS, DB projection, live log capture).
            (2) No root package.json "perf" script — root package.json is
            contract territory; the command is documented here instead.
            (3) NFR-2 mix has no GET /stores — stores are embedded in
            /board by design (§7.2); /auth/me stands in as the small-
            endpoint sample. (4) The 10-year DB model is stated explicitly
            (see sensitivity note) — a projection, not a promise.
Deviations: Cross-lane touch — scripts/** is lane C territory; filed R-015
            (same-operator note) rather than a blocking round-trip. The
            script imports db/dist + shared/dist directly (tsx does not
            resolve @kirana/db from the root tsconfig paths).
Learned:    (a) addListItemRequestSchema requires clientId — the merge-path
            sample needs a fixed v7 UUID, which also makes runs 2+ replay
            deterministically. (b) GET /stores does not exist; /board
            carries the stores array. (c) tsx applies tsconfig paths for
            @kirana/shared but not @kirana/db — relative dist imports are
            the robust root-level route. (d) Export is the slowest read
            (29–37ms p95 at 2k rows) — still 3× under budget.
Next:       T-P5-02 — lane B: client perf (NFR-3/4/5/6), error-state sweep,
            final a11y pass, device-testing checklist.

## 2026-11-17 — lane B — T-P5-02 (client perf + polish)

Built:      NFR-3: web build measured — 202.03 kB gzip initial JS (budget
            250KB). NFR-5: web/src/lib/searchIndex.test.ts — 5,000-item
            bench for searchCatalog + resolveLocal; the first run FAILED
            (30.24ms mean > 30ms): searchCatalog rebuilt each item's search
            candidate on every query. Fix: buildIndex precomputes the
            §8.6 candidate once per item (behaviour-preserving — the
            candidate depends only on item fields); search now runs 1.0–2.2ms
            mean at 5k items. NFR-6: e2e/specs/nfr-perf.spec.ts — an in-page
            probe (synthetic click + MutationObserver on aria-checked) so
            the number is the app's optimistic path, not Playwright
            overhead: 3.8–4.3ms mean, max 12ms (budget 16ms). NFR-4:
            same spec, 4× CPU throttle (CDP) warm reload → Home content:
            410–510ms (budget 1.5s); cold no-cache recorded ungated.
            Error-state sweep: all 11 routes checked for loading + error +
            empty (Home/Catalog/Categories/Stores/ItemDetail/ShopMode/
            Settings via isPending·isError·length===0; Login/Welcome/
            Data via per-action pending + inline deck-copy errors + 321
            board.isError; ShopMode's §8.7 empty state is e2e-verified) —
            no gaps found. Final a11y pass: a11y.spec.ts extended from 3 to
            9 screens (Stores, Categories, Item detail, Data, Settings,
            Login unauthed) — zero critical AND serious everywhere.
Tests:      `pnpm verify` 437 green (shared 104, db 45, web 66 (+3 bench),
            server 222 (+1 NFR-2)); a11y + nfr-perf specs 12/12 on
            mobile-chrome (375×667); pixel-7 runs in the full suite.
Decisions:  (1) The searchIndex precompute is a code fix, not a fixture
            fudge — the bench failed honestly first (30.24ms), the fix
            landed, the bench passes with 15× headroom. (2) NFR-4's
            committed number is a documented proxy (4× CPU throttle,
            localhost ≈ LAN); the real mid-range Android number belongs to
            the manual device pass. (3) NFR-6 asserted on the MEAN of 10
            in-page toggles (max recorded, not gated) — a single GC pause
            is not a product defect. (4) Lane note: nfr-perf.spec.ts and
            the a11y extension live in e2e/** (lane D territory) —
            cross-lane touch logged here per §10.2; lane D reviews at
            T-P5-04.
Deviations: None to the PRD. No new dependency. No contract change; no
            migration.
Learned:    (a) noUncheckedIndexedAccess applies to test fixtures too —
            indexed picks need helpers, `!` is banned. (b) The single
            biggest perf lever in the client index was O(n) candidate
            rebuilds per keystroke; measure before assuming the linear
            scan is fine. (c) An in-page MutationObserver probe cleanly
            separates app latency from test-harness latency.
Next:       T-P5-03 — lane C: restore drill (G5.2), backup wiring, README
            + operator guide (G5.5), env-var docs.

## 2026-11-17 — lane C — T-P5-03 (restore drill + README/operator guide)

Built:      Restore drill executed per §12.5 against the live demo
            container (kirana:local-node, ./data mounted): baseline DB
            counts → host-side WAL-safe .backup (the same SQLite API the
            server's POST /admin/backup uses) + gzip → docker stop → DB
            (+wal/shm) moved aside → gunzip latest → docker start →
            /healthz 200 → counts compared. RTO **1.57s** (gate ≤10 min);
            counts identical (51 items / 32 list rows / 5 stores / 252
            change rows). Container healthy after; the pre-drill copy is
            kept at data/kirana.db.pre-drill until the owner deletes it.
            README rewritten as the operator guide (G5.5): ~10-minute
            deploy from scratch (compose + .env + openssl secret), HTTPS/
            APP_ORIGIN note, full env table (§12.1 incl. the P4 harness
            overrides marked as such), update flow, backups (cron line +
            infra/backup.sh + Settings→Data on-demand; retention 14+8),
            the restore drill steps with the measured RTO, lockout reset
            (verified against the runtime image layout:
            /app/node_modules/@kirana/db/dist/cli.js), privacy + browser
            support (NFR-13).
Tests:      Drill evidence above; `docker exec` verified the runtime
            layout used by the lockout instructions; container healthy
            post-restore (only logged error is the drill's own 401 probe —
            no secrets in logs, corroboration for NFR-15 in prod shape).
Decisions:  (1) The drill ran host-side (same SQLite backup API as the
            server) because the running board's passcode is the owner's —
            no auth-free assumptions were made about their data. (2)
            infra/backup.sh requires the sqlite3 CLI — NOT present on this
            host; documented as a stated prerequisite in the README rather
            than adding a db-CLI backup command (scope). (3) The pre-drill
            DB copy is left in place — data-preservation over tidiness.
Deviations: None to the PRD. No application code touched (lane C clean).
Learned:    (a) The container's restart policy (unless-stopped) makes
            docker stop/start the right drill primitive — the phase-log
            warning about the demo server respawning applies to killing
            the process inside, not stopping the container. (b) Move the
            -wal/-shm files aside with the db or the restored snapshot can
            be corrupted by a stale WAL. (c) A restore drill that has
            never been run is a backup strategy that has never been tested.
Next:       T-P5-04 — lane D: CHANGELOG, TODO sweep (G5.3), device/browser
            checklist (NFR-13/14).

## 2026-11-17 — lane D — T-P5-04 (CHANGELOG + TODO sweep + device checklist)

Built:      CHANGELOG.md — user-facing P0→P5 summary drawn from the phase
            logs (board, sync/households/PWA, data, platform; notes on the
            passcode model and R-014). G5.3 sweep: grep for
            TODO/FIXME/XXX/HACK across server, web/src, shared/src, db/src
            + migrations, e2e, scripts, infra — zero markers (the only
            'hacker' hits are unknown-key-stripping test fixtures).
            docs/DEVICE-CHECKLIST.md — the manual iOS Safari + Chrome
            Android pass (install, sync, offline queue, add flow, shop
            mode, keyboard, safe areas, update) with slots for the
            real-device NFR-4 numbers. README already carries the
            browser-support (NFR-13) and privacy/uptime stance (NFR-14).
Tests:      Sweep evidence above (grep exit with only fixture matches).
Decisions:  (1) The device checklist is a docs file, not an issue — the
            owner runs it and records one line per device in the phase
            log. (2) CHANGELOG notes R-014 openly rather than burying it.
Deviations: None. No code touched (lane D clean).
Learned:    G5.3 was already satisfied by discipline — zero TODO markers
            after five phases; the sweep took one grep.
Next:       T-P5-05 — release: merge P3+P4 to main (owner's go), P5 PR,
            CI green twice (G5.4), version bump, tag v1.0.0 (G5.6).

## 2026-11-17 — release — T-P5-05 (merge to main, CI ×2, v1.0.0)

Built:      Owner-approved release path executed. P5 work committed on
            chore/p5/hardening (5 commits: T-P5-01 harness, T-P5-02 client
            perf + a11y, T-P5-03 operator guide, T-P5-04 docs close,
            version bump). PR #3 (feat/p4/contract-v14 → main) — CI green
            (verify + e2e + docker; first CI contact with the P3/P4 code)
            — fast-forward-merged (SHAs preserved, tags stay on main's
            history). PR #4 (chore/p5/hardening → main) — CI green, then
            the workflow re-run green again = **two consecutive green
            runs on the release state (G5.4)** — ff-merged. Tags
            `phase-5-complete` + `v1.0.0` (annotated) on 03fc830, pushed.
Tests:      Local before push: `pnpm verify` 437 green; `pnpm e2e` 140/140
            (124 + 16 new) across both viewports. CI: PR #3 all green;
            PR #4 run 1 green + rerun green (G5.4 evidence:
            actions/runs/44131094670 + its rerun).
Decisions:  (1) Fast-forward merges over squash — preserves the 33+5
            commit narrative on main and keeps phase tags meaningful
            (owner-selected). (2) G5.4's "twice consecutively" = the PR
            run + `gh run rerun` of the same workflow (independent
            runners, fresh environments) on the exact release SHA.
            (3) Version bump is its own `chore(release)` commit; root
            package.json is contract territory (§17.5) — bump only, no
            dependency change, noted in the commit.
Deviations: None. (CI annotation: actions now warn they target Node 20 —
            cosmetic, runner forces Node 24; noted for a future chore.)
Learned:    A manual ff-push after a green PR keeps both the PR record
            (GitHub auto-marks it merged when main contains the head) and
            the SHA-exact history — no rebase, no force.
Next:       Owner: run docs/DEVICE-CHECKLIST.md on real hardware and
            record one line per device in PHASE-5.md. Post-1.0: P6 per
            §13, only after the checklist.

## Handoff (P5 complete — v1.0.0 shipped)

Done:        T-P5-01…T-P5-05. Gates: G5.1 numbers table (this file); G5.2
             drill RTO 1.57s; G5.3 zero TODO markers; G5.4 CI green twice
             on the release state; G5.5 README operator guide; G5.6 tags
             phase-5-complete + v1.0.0 pushed to origin.
Tests:       437 unit/integration (`pnpm verify`) + 140 e2e (`pnpm e2e`)
             green locally; CI verify + e2e + docker green ×2.
Contract:    shared/contracts.ts @ v1.4; openapi.json current; schema hash
             0003; migrations 0001–0004 applied.
Branch/tag:  main @ 03fc830 (release); tags phase-5-complete, v1.0.0.
Owner items: run docs/DEVICE-CHECKLIST.md (real-device NFR-4/13 numbers →
             PHASE-5.md); delete data/kirana.db.pre-drill when satisfied;
             the demo container was restore-drilled and is healthy.
Open items:  R-014 (import grocery-scope categories); BACKLOG (alias
             soft-delete needs migration 0005, §6.7 nightly purge is a P6
             job, JSON import loses row status, code-split when bundle
             matters, CI actions Node-20 deprecation warning).
Next:        P6 — Intelligence per §13, only after the device checklist
             and only as five independent increments.
