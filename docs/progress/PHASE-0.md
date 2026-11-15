# PHASE-0 — Foundations & Contracts

Goal: a running skeleton with frozen contracts, so every later phase is additive.
Refs: PRD §3, §15.3 (P0 card). Gates: G0.1–G0.6.

## Session log

## 2026-11-15 — lane A (solo bootstrap) — T-P0-00
Built:      git repo on `main`; docs skeleton (STATUS, this log, ADR-0001,
            REQUESTS, BACKLOG); .gitignore; .env.example; README stub.
Tests:      none (no code yet).
Decisions:  Solo session runs all four lanes sequentially in dependency order
            (contracts → db → server → web → platform → e2e). Commit-per-task
            instead of branch-per-task because there is no remote; PR flow
            starts when a remote exists. Recorded as a deviation in ADR-0001.
Deviations: none beyond the above.
Learned:    Environment has Node 22.23.2 (nvm) and pnpm 12.3.4, both off the
            default non-interactive PATH; every shell command must export
            PATH. Docker 29.9.2 daemon is running.
Next:       T-P0-01 workspace root + toolchain.
