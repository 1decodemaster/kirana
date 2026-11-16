# ADR-0004: the import preview response carries the commit token

Date: 2026-11-15 · Phase: P3 (T-P3-02) · Contract: v1.2 → v1.3, additive

## Context

PRD §9.3 (import preview → commit):

1. `POST /import/preview` parses, validates, and computes a diff
   `{ new, duplicate, conflict, invalid, rows }`.
3. The preview is stored in an in-memory map keyed by a **signed token** with a
   10-minute TTL.
4. `POST /import/commit` takes `{ token, decisions[] }`.

The drafted `importPreviewResponseSchema` (contract #28) has fields
`new/duplicate/conflict/invalid/rows` — but **no field that carries the token
the commit step requires**. §9.3 step 4 makes the token mandatory input; the
preview response is the only place the server ever hands it to the client.

## Decision

Add `token: string (min 10, max 512)` to `importPreviewResponseSchema` — the
same bounds as `importCommitRequestSchema.token`. Purely additive: existing
consumers of the other five fields are unaffected; no existing client breaks.

The alternative — a response header (`X-Import-Token`) — was rejected: every
other request/response datum in this API travels in JSON bodies, and the
commit request already references the token from a body field.

## Consequences

- `openapi.json` regenerated; `pnpm contracts:check` pins it.
- In-memory preview store keeps `ImportRowDto` rows plus a server-only
  `error` marker (invalid rows are visible in the diff but not importable);
  that internal shape is not part of the contract.

Refs: PRD §9.3, §7.2 #28–29.
