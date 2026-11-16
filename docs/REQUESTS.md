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
Status: open
