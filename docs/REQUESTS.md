# REQUESTS

Cross-lane asks (PRD §17.4). Format:

```md
## R-NNN — Lane: one-line ask
From: lane X
Needed by: TASK-ID
Ask: what you need
Blocking: yes/no
Status: open | accepted | done (PR #)
```

(No requests yet.)

## R-013 — QA/e2e: set DATA_DIR in the Playwright webServer env
From: lane B
Needed by: T-P3-06 (and any backup e2e)
Ask: add `DATA_DIR: path.join(process.cwd(), '.tmp')` to the `webServer.env`
block in `e2e/playwright.config.ts`. The server config defaults dataDir to
`/data` (the container volume path), so `POST /admin/backup` returns 500
(EACCES mkdir '/data') in the e2e harness. Verified the UI flow works
against a server started with a writable DATA_DIR.
Blocking: no (backup UI verified manually; blocks only committed backup specs)
Status: done — T-P3-06 added the env line; backup e2e green in the harness.

## R-014 — Backend: import category resolution ignores household-scope categories
From: QA/e2e (T-P3-06, G3.3 round-trip)
Needed by: any future import polish; not a P3 gate blocker
Ask: `ensureCategory` (server/services/importCommit.ts) matches only
`scope = 'grocery'`, so a CSV/JSON import of 'Cleaning Supplies' (a
household-scope seed category) re-creates it as a grocery-scope row. The
restored board then shows the name twice in /categories and the rows move
to a fresh category with max sort order (aisle order drifts). PRD §9.2
says category names are matched to "existing rows" with no scope
qualifier. Suggest matching by name_norm across scopes (prefer
household-owned, then seed), or an ADR if grocery-only is intended.
Blocking: no (G3.3 gate is row counts + names and passes; noted as a
known import limitation in the phase log)
Status: open

## R-015 — Platform: lane A added scripts/perf-nfr.ts (NFR harness)
From: lane A (T-P5-01)
Needed by: G5.1 (NFR-1/2/8/9/10/15 recorded numbers)
Ask: acknowledgment that `scripts/perf-nfr.ts` (measurement-only, no app
code; imports db/dist + shared/dist, spawns the built server) was added by
lane A. scripts/** is lane C territory; the operator is the same human, so
proceeding with this note instead of a blocking round-trip. Lane C owns it
from here (e.g. wiring it into CI later, if wanted). Also: the command is
documented in the phase log — no root package.json change was made (that
file is contract territory).
Blocking: no
Status: accepted (same-operator note; lane C review at T-P5-05)
