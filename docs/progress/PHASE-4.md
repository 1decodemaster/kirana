# PHASE-4 — Household, Sync, PWA

Goal: it's a shared app the family installs on their phones.
Refs: PRD §15.3 (P4), §4.7, §7.1–7.6, §8.7–8.10, §10 NFR-7, §11, §12.1–12.2,
§19. Gates: G4.1–G4.7.

## Task cards

- T-P4-01 — contract v1.3 → v1.4: auth, household create, members, SSE (lane A, contract; ADR-0005) — **everything below depends on this**
- T-P4-02 — backend: sessions table (migration 0003), scrypt auth, rate limit, auth enforcement (G4.6)
- T-P4-03 — backend: household create + members APIs + GET /events SSE (G4.1 server half, NFR-7)
- T-P4-04 — web: first-run wizard (§8.9), login/session screens, /settings (household, members, theme, about)
- T-P4-05 — web: SSE client, offline mutation queue (§4.7), offline banner (§8.7)
- T-P4-06 — web: service worker, manifest + icons, installability (G4.4), axe findings fixed (G4.5)
- T-P4-07 — e2e: first-run, auth, live-sync (G4.1), offline-queue (G4.2/G4.3), a11y (G4.5) + phase close

## Card details

### T-P4-01 — contract v1.4 (contract territory)

§7.2 #1–3 (auth), #31 (/events) have request/response schemas to add.
The wizard needs household creation and the settings screen needs members
management — neither endpoint exists in §7.2. Additions (ADR-0005, additive
only): POST /household (wizard commit), POST/PATCH/DELETE /members.
Deliverable: shared/contracts.ts v1.4, openapi.json regenerated,
`pnpm contracts:check` green. No migration in this card.

### T-P4-02 — sessions + auth (server, db)

Migration **0003 claimed** (see lock below): `sessions` table per §7.6
(survives restart → G4.6). scrypt per §12.2 (N=16384, r=8, p=1, keylen=64,
`scrypt$N$r$p$salt$hash`, timingSafeEqual). `sid` cookie HttpOnly,
SameSite=Lax, Secure when https, Path=/, Max-Age=2592000; SESSION_SECRET
required (§12.1). Login rate limit 5/5min/IP (§11). Replace the
resolveActor pre-auth stub with session resolution; every route 401
UNAUTHORIZED without a session except /auth/login, POST /household,
/healthz, static.

### T-P4-03 — household create, members, SSE (server)

POST /household (single request: name, passcode, displayName, color,
seedCategories? → §14.1 categories + §14.2 sample items when opted in;
first store reuses POST /stores). Members CRUD for /settings. SSE per
§7.5: change_log tail, heartbeat 20s, Last-Event-ID, ≤20 connections per
session (§11), propagation ≤1s (NFR-7). Audit that every mutating service
appends change_log rows (catalog/categories/listItems/stores do; verify).

### T-P4-04…T-P4-06 — web cards

Lane B; see card lines above. Copy from §8.10 verbatim; new strings go
into §8.10 in the same PR (session-expired, wizard, members, offline queue
counts if missing).

### T-P4-07 — e2e + close (lane D)

New specs: first-run, auth, live-sync (two contexts, add on A → B ≤1s),
offline-queue (3 offline checks → reconnect → persist, no duplicates;
same clientId replayed twice → one row), axe a11y on Home/add sheet/
Catalog. Gates G4.1–G4.7 evidenced; tag phase-4-complete.

## Migration lock

**0003 claimed by T-P4-02** (sessions). The BACKLOG item "alias soft-delete
needs migration 0003" is renumbered: it now claims **0004**.

## Open items carried in

- R-014 (lane A): import ensureCategory grocery-scope only — household-scope
  categories re-created as grocery rows on import. Not a gate blocker.
- BACKLOG: alias soft-delete (now 0004), PUT /stores/:id/category-order
  (#27) unimplemented by design, JSON import restores rows as active,
  store icons reset to 🏬 on import.

## Session log

(empty — first session writes below)
