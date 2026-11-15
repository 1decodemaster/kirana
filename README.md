# Kirana

Self-hosted, installable web app for a single household's shopping board.
One shared list per store, grouped by aisle, with a multilingual catalog so
the second time you add "atta" it takes three taps.

**Status:** P1 — Core Board complete (Home screen is real: check, clear,
archive). See `docs/STATUS.md`.
Spec: `docs/PRD.md` (the frozen v1 specification).

## Development

Requires Node 22 and pnpm 10+.

```sh
pnpm install
pnpm verify     # typecheck + lint + build + unit tests
pnpm dev        # server on :8080, web on :5173 (proxy /api)
```

## Docker

```sh
docker compose up --build   # → http://localhost:8080
curl localhost:8080/healthz
```

## Repo map

- `shared/` — Zod contracts, domain utilities (contract territory)
- `db/` — SQLite schema, SQL migrations, seeds
- `server/` — Fastify API
- `web/` — React SPA
- `e2e/` — Playwright flows
- `docs/` — `STATUS.md` (start here), phase logs, ADRs

The passcode (once shipped) protects against casual access on a trusted LAN —
it is not strong authentication. See PRD §11.
