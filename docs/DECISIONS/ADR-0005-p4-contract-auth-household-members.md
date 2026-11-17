# ADR-0005 — P4 contract additions: auth roster, household create/update, members

**Status:** Accepted
**Date:** 2026-11-16
**Phase:** P4 (T-P4-01)
**Refs:** PRD §7.2 #1–3/#31, §7.6, §8.9, §8.1 (/settings), §11, §12.2

## Context

P4 introduces passcode auth, the first-run wizard, and the settings screen.
The v1.0 contract baseline carried the auth shapes (`loginRequest`,
`me`, `logout`) and `changeEventSchema` for SSE, but §7.2's endpoint table
has no endpoint for:

1. **Creating the household** — §7.6 says "the household is created by a
   first-run wizard" yet no endpoint exists for it.
2. **The pre-login member roster** — `POST /auth/login` takes
   `{passcode, displayName}`, so the login screen must show the member
   list to pick a displayName from. There is no self-registration, and
   every other read requires a session — a second family member could
   never log in.
3. **Members management** — `/settings` covers "Household, members,
   passcode, theme, about" (§8.1), but members have no write endpoints.
4. **Household rename / passcode change** — same `/settings` line; the
   household row is otherwise immutable.

## Decisions

1. **`POST /api/v1/auth/members` `{passcode}` → `{members: MemberDto[]}`.**
   Pre-session roster lookup, gated by the passcode so names are never
   disclosed without it. Same `UNAUTHORIZED` semantics and the same login
   rate limit (5/5min/IP, §11) as `/auth/login`.

2. **`POST /api/v1/household`** `{name, passcode, displayName, color,
   seedSampleData?}` → the `me` response shape. This is the wizard's
   single commit (§8.9 steps 1–4): household + first member, §14.1
   categories and §14.2 sample items when `seedSampleData` is true (the
   §8.9 default), and it **sets the `sid` cookie** — creating the
   household logs you in. `403 FORBIDDEN` when a household already exists
   (single-tenant by design, §11). The wizard's first store (step 5)
   reuses `POST /stores`; the `+` coach-mark is client-local.

3. **`PATCH /api/v1/household`** `{name?, passcode?}` → `{household}`.
   Settings rename + passcode change. Session required; the current
   passcode is **not** re-verified — the session is the proof, matching
   the casual-access model (§11, AGENTS.md §8.7).

4. **`POST /members`** `{displayName, color}`; **`PATCH /members/{id}`**
   `{displayName?, color?}`; **`DELETE /members/{id}`** →
   `{deleted: boolean}`. Delete is soft (`members.deleted_at`), so
   `checked_by`/`added_by` references survive (data ethics §8.1).
   Deleting the **last active member** is refused with `403 FORBIDDEN`
   — a zero-member household is a lockout, and no code in the §7.1
   closed set describes it better. Any session member may manage any
   member (single household, casual trust).

5. **No shape changes to existing schemas.** `changeEventSchema` already
   matches §7.5's SSE data payload; `/events` was documented at v1.0.
   Sessions, cookies and rate limits are server behaviour, not payload
   shapes.

Everything is additive: new schemas, new endpoints, two new openapi tags
(`household`, `members`). Contract version v1.3 → v1.4. No migration in
this change (the `sessions` table is T-P4-02, migration 0003).

## Consequences

- Lanes B/D can freeze web and e2e work against v1.4 immediately
  (§15.2 rule 5).
- The member picker in the login screen depends on decision 1; the
  wizard depends on decision 2; `/settings` depends on 2–4.
- `FORBIDDEN` now carries two meanings (existing household; last member)
  distinguishable by `message` — acceptable in a single-tenant app; a
  new error code would break the closed set for marginal benefit.
